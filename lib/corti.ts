import { createHash } from "node:crypto";
import { type Corti, CortiClient, CortiEnvironment } from "@corti/sdk";

function cfg() {
  const {
    CORTI_TENANT_NAME: tenant,
    CORTI_CLIENT_ID: clientId,
    CORTI_CLIENT_SECRET: clientSecret,
    CORTI_ENVIRONMENT: environment,
  } = process.env;
  if (!tenant || !clientId || !clientSecret || !environment) {
    throw new Error("Missing CORTI_* env vars — see .env");
  }
  return { tenant, clientId, clientSecret, environment };
}

let client: CortiClient | null = null;

export function corti() {
  if (client) return client;
  const { tenant, clientId, clientSecret, environment } = cfg();
  client = new CortiClient({
    tenantName: tenant,
    environment: environment === "us" ? CortiEnvironment.Us : CortiEnvironment.Eu,
    auth: { clientId, clientSecret },
  });
  return client;
}

export async function extractFacts(text: string) {
  const { facts } = await corti().facts.extract({
    context: [{ type: "text", text }],
    outputLanguage: "en",
  });
  return facts;
}

export type Fact = Corti.FactsExtractResponseFactsItem;
export type Code = Corti.CodesGeneralReadResponse;

export async function predictCodes(text: string) {
  const { codes } = await corti().codes.predict({
    system: ["icd10int-inpatient", "snomedctdk"],
    context: [{ type: "text", text }],
  });
  return codes;
}

// Ambient streaming attaches to an interaction; dictation does not. The
// identifier has to be unique across the tenant — Corti 409s on a repeat.
export async function createInteraction(identifier: string, title: string) {
  const { interactionId } = await corti().interactions.create({
    encounter: { identifier, title, status: "in-progress", type: "consultation" },
  });
  return interactionId;
}

async function issueToken() {
  const { tenant, clientId, clientSecret } = cfg();
  return corti().auth.token(tenant, {
    clientId,
    clientSecret,
    grantType: "client_credentials",
  });
}

// Every browser handoff gets a fresh token — they leave the server and have to
// outlive the session they're handed to. Only our own calls reuse one.
let cached: { token: string; expiresAt: number } | null = null;

async function accessToken() {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const { accessToken, expiresIn } = await issueToken();
  // A minute of slack, so a token can't expire between here and the request.
  cached = { token: accessToken, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
  return accessToken;
}

export async function browserCredentials() {
  const { tenant, environment } = cfg();
  const { accessToken, expiresIn } = await issueToken();
  return { token: accessToken, expiresIn, tenantName: tenant, environment };
}

/**
 * The embedded assistant is the one Corti surface our service account cannot
 * open. Measured, not guessed: client_credentials comes back with
 * refreshExpiresIn 0 and no refreshToken, and auth() then rejects the token
 * outright — "access_token is missing required claims: email". A service
 * account has no email because it is nobody.
 *
 * So the assistant needs a real person's token, which means a browser login —
 * the practitioner signs in to Corti and their password never reaches us. The
 * rest of the app keeps the service account; only this one surface signs in.
 */
const REALM = () => `https://auth.${cfg().environment}.corti.app/realms/${cfg().tenant}`;

// Keycloak's own casing. The embed hands this response through verbatim, so it
// is the shape everything here converges on.
export type UserToken = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in?: number;
  id_token?: string;
  scope?: string;
  session_state?: string;
};

/**
 * Where to send the practitioner to sign in. PKCE is not strictly required of a
 * confidential client, but the verifier costs one hash and closes the window
 * where a leaked code alone is enough.
 *
 * offline_access is what makes the refresh token appear, and email is the claim
 * the embed rejected us for missing. Both are load-bearing.
 */
export function authorizeUrl(redirectUri: string, verifier: string, state: string) {
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: cfg().clientId,
    response_type: "code",
    scope: "openid email profile offline_access",
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${REALM()}/protocol/openid-connect/auth?${params}`;
}

// The SDK's auth.token() speaks camelCase both ways, and every consumer of this
// wants Keycloak's own shape, so these two go straight to the token endpoint.
async function tokenEndpoint(body: Record<string, string>): Promise<UserToken> {
  const { clientId, clientSecret } = cfg();
  const res = await fetch(`${REALM()}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...body }),
  });
  if (!res.ok) throw new Error(`Corti login failed — ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export const exchangeCode = (code: string, redirectUri: string, verifier: string) =>
  tokenEndpoint({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });

/**
 * An access token lasts 300s and the assistant can be open for longer than that,
 * so the cookie holds the refresh token and every load trades it for a fresh
 * one. Nothing durable is stored on our side but the right to ask again.
 */
export const refreshUserToken = (refreshToken: string) =>
  tokenEndpoint({ grant_type: "refresh_token", refresh_token: refreshToken });

// Corti Models is OpenAI-compatible and lives on its own host; the SDK has no
// client for it, so this one stays a raw fetch.

/**
 * corti-s1 is the largest model the tenant offers — there is nothing bigger to
 * reach for. What there is, is a non-reasoning "instant" variant of the same
 * family, and on this workload it is the whole difference.
 *
 * Measured on the demo dictation, corti-s1 against corti-s1-instant:
 *
 *   classifySteps      21.8s / 39.5s   →  2.2s / 1.9s    identical verdicts
 *   readHandoffIntent         6.7s     →  1.5s           identical
 *   checkClosure (deferred)  39.9s     →  1.7s           correctly refuses to close
 *   checkClosure (done)      13.6s     →  1.8s           correctly closes
 *   draftSbar                 7.7s     →  2.5s           corti-s1 writes it better
 *
 * So the split is by what the answer is, not by how much it matters. Every
 * structured judgement — a verdict, a name match, met or not met — comes back
 * the same and roughly fifteen times faster. The one place the small model
 * shows is prose: it filed a discharge plan under Assessment, and the four
 * parts landing in the right places is most of what an SBAR is for.
 */
export const CHAT_MODELS = {
  /** A verdict, a match, a met-or-not. Same answers, a fraction of the wait. */
  fast: "corti-s1-instant",
  /** Sentences a clinician reads. Worth the seconds. */
  prose: "corti-s1",
} as const;

// Forces every call onto one model, for timing the family against itself
// without editing code.
const FORCED_MODEL = process.env.CORTI_CHAT_MODEL;

// The prose model took 37s once and 77s the next on an identical prompt — and
// that 77s was 45s of waiting, an abort, and a retry that then succeeded in 30s.
// A limit inside the spread of what the call actually costs protects nothing; it
// just guarantees we throw away most of a good answer and pay for it twice.
//
// So this is a limit for a call that is genuinely never coming back, not a
// budget for a slow one. Progress is reported per step on screen, which is what
// makes a long wait legible.
const CHAT_TIMEOUT_MS = 120_000;

// Three goes, with a pause between them. An immediate retry after a 500 asks the
// same overloaded thing the same question a millisecond later, which is how a
// transient failure gets mistaken for a permanent one — measured 56s of two
// back-to-back attempts both returning 500 with an empty body.
const ATTEMPTS = 3;
const backoff = (attempt: number) => new Promise((r) => setTimeout(r, attempt * 1500));

export async function chat<T>(
  prompt: string,
  model: string = CHAT_MODELS.fast,
  attempt = 0,
): Promise<T> {
  const { tenant, environment } = cfg();
  const last = attempt >= ATTEMPTS - 1;
  let res: Response;
  try {
    res = await fetch(`https://ai.${environment}.corti.app/v1/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "Tenant-Name": tenant,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: FORCED_MODEL ?? model,
        // Same conversation must produce the same board twice running.
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (error) {
    if (last) throw new Error(`Corti chat gave up after ${CHAT_TIMEOUT_MS / 1000}s: ${error}`);
    await backoff(attempt + 1);
    return chat<T>(prompt, model, attempt + 1);
  }

  // This call is the demo. It 500s occasionally and the identical prompt then
  // succeeds, so back off and ask again rather than a dead board on stage.
  if (res.status >= 500 && !last) {
    await backoff(attempt + 1);
    return chat<T>(prompt, model, attempt + 1);
  }
  if (!res.ok) {
    // A 500 from this endpoint usually carries no body at all, so the status
    // text is the only thing distinguishing it from our own bugs.
    const body = (await res.text()).slice(0, 300).trim();
    throw new Error(
      `Corti text generation failed — ${res.status} ${res.statusText}${body ? `: ${body}` : " (no detail returned)"}`,
    );
  }

  // A 200 can still carry no answer: content comes back null when the model
  // stops early, and JSON.parse(null) is null, not a throw. Every caller reads
  // fields off this, so it either hands back an object or it fails here.
  const { choices } = await res.json();
  const content = choices?.[0]?.message?.content;
  const parsed = typeof content === "string" ? tryParse(content) : null;
  if (parsed) return parsed as T;
  if (last) throw new Error(`Corti chat returned no usable JSON: ${String(content).slice(0, 200)}`);
  await backoff(attempt + 1);
  return chat<T>(prompt, model, attempt + 1);
}

function tryParse(text: string) {
  try {
    const value = JSON.parse(text);
    return typeof value === "object" && value !== null ? value : null;
  } catch {
    return null;
  }
}


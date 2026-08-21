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

// Corti Models is OpenAI-compatible and lives on its own host; the SDK has no
// client for it, so this one stays a raw fetch.
// Measured at 3–20s for these prompts. Past that it is not slow, it is stuck —
// and a request with no deadline is a board that never paints, with nothing on
// screen to say so. Long enough to survive a bad minute, short enough to retry
// inside a demo beat.
const CHAT_TIMEOUT_MS = 45_000;

// Three goes, with a pause between them. An immediate retry after a 500 asks the
// same overloaded thing the same question a millisecond later, which is how a
// transient failure gets mistaken for a permanent one — measured 56s of two
// back-to-back attempts both returning 500 with an empty body.
const ATTEMPTS = 3;
const backoff = (attempt: number) => new Promise((r) => setTimeout(r, attempt * 1500));

export async function chat<T>(prompt: string, attempt = 0): Promise<T> {
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
        model: "corti-s1",
        // Same conversation must produce the same board twice running.
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (error) {
    if (last) throw new Error(`Corti chat gave up after ${CHAT_TIMEOUT_MS / 1000}s: ${error}`);
    await backoff(attempt + 1);
    return chat<T>(prompt, attempt + 1);
  }

  // This call is the demo. It 500s occasionally and the identical prompt then
  // succeeds, so back off and ask again rather than a dead board on stage.
  if (res.status >= 500 && !last) {
    await backoff(attempt + 1);
    return chat<T>(prompt, attempt + 1);
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
  return chat<T>(prompt, attempt + 1);
}

function tryParse(text: string) {
  try {
    const value = JSON.parse(text);
    return typeof value === "object" && value !== null ? value : null;
  } catch {
    return null;
  }
}


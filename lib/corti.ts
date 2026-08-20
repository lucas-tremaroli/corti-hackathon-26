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

// Ambient streaming attaches to an interaction; dictation does not. The task id
// becomes the encounter identifier so a stream is traceable back to the work.
export async function createInteraction(identifier: string, title: string) {
  const { interactionId } = await corti().interactions.create({
    encounter: { identifier, title, status: "in-progress", type: "consultation" },
  });
  return interactionId;
}

// ponytail: no cache — the SDK caches tokens for its own calls, and this is only
// hit by the chat passthrough and the websocket route. Memoize if it gets hot.
async function issueToken() {
  const { tenant, clientId, clientSecret } = cfg();
  return corti().auth.token(tenant, {
    clientId,
    clientSecret,
    grantType: "client_credentials",
  });
}

const accessToken = async () => (await issueToken()).accessToken;

export async function browserCredentials() {
  const { tenant, environment } = cfg();
  const { accessToken, expiresIn } = await issueToken();
  return { token: accessToken, expiresIn, tenantName: tenant, environment };
}

// Corti Models is OpenAI-compatible and lives on its own host; the SDK has no
// client for it, so this one stays a raw fetch.
export async function chat<T>(prompt: string, attempt = 0): Promise<T> {
  const { tenant, environment } = cfg();
  const res = await fetch(`https://ai.${environment}.corti.app/v1/chat/completions`, {
    method: "POST",
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
  // This call is the demo. It 500s occasionally and the identical prompt then
  // succeeds, so one retry rather than a dead board on stage.
  if (res.status >= 500 && attempt === 0) return chat<T>(prompt, 1);
  if (!res.ok) throw new Error(`Corti chat ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const { choices } = await res.json();
  return JSON.parse(choices[0].message.content);
}


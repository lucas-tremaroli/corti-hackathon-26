import { CortiClient, CortiEnvironment } from "@corti/sdk";
import type { SopStep } from "./sop";

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

export async function predictCodes(text: string) {
  const { codes } = await corti().codes.predict({
    system: ["icd10int-inpatient", "snomedctdk"],
    context: [{ type: "text", text }],
  });
  return codes;
}

// ponytail: no cache — the SDK caches tokens for its own calls, and this is only
// hit by the chat passthrough and the websocket route. Memoize if it gets hot.
async function accessToken() {
  const { tenant, clientId, clientSecret } = cfg();
  const { accessToken } = await corti().auth.token(tenant, {
    clientId,
    clientSecret,
    grantType: "client_credentials",
  });
  return accessToken;
}

export async function browserCredentials() {
  const { tenant, environment } = cfg();
  return { token: await accessToken(), tenantName: tenant, environment };
}

// Corti Models is OpenAI-compatible and lives on its own host; the SDK has no
// client for it, so this one stays a raw fetch.
async function chat<T>(prompt: string): Promise<T> {
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
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Corti chat ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const { choices } = await res.json();
  return JSON.parse(choices[0].message.content);
}

export type StepVerdict = { id: string; status: "covered" | "gap"; evidence: string };

export async function classifySteps(
  steps: SopStep[],
  facts: { text: string }[],
): Promise<StepVerdict[]> {
  const raw = await chat<{ steps?: { id?: string; status?: string; evidence?: string }[] }>(
    `You are checking whether a discharge conversation covered each step of a care protocol.

Protocol steps:
${JSON.stringify(steps.map(({ id, title, trigger }) => ({ id, title, trigger })), null, 2)}

Facts extracted from the conversation:
${JSON.stringify(facts.map((f) => f.text))}

For each step return "covered" if the facts show it was done, arranged or explicitly discussed, otherwise "gap". Quote the supporting fact verbatim as evidence for covered steps, and use an empty string for gaps.
Return JSON: {"steps":[{"id","status","evidence"}]}`,
  );

  // Anything the model omits or garbles falls back to "gap": a false gap is a
  // redundant task, a false "covered" silently drops care.
  return steps.map((step) => {
    const verdict = raw.steps?.find((s) => s.id === step.id);
    return {
      id: step.id,
      status: verdict?.status === "covered" ? "covered" : "gap",
      evidence: typeof verdict?.evidence === "string" ? verdict.evidence : "",
    };
  });
}

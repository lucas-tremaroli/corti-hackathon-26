import { chat } from "./corti";

export type Sbar = { s: string; b: string; a: string; r: string };

export const SBAR_PARTS = [
  { key: "s", label: "Situation" },
  { key: "b", label: "Background" },
  { key: "a", label: "Assessment" },
  { key: "r", label: "Recommendation" },
] as const;

// A paragraph can only be judged as a whole. Four fixed parts can each be
// checked, so a handoff missing its R is visibly incomplete before it is sent.
export const missingParts = (sbar: Sbar) =>
  SBAR_PARTS.filter(({ key }) => sbar[key].trim() === "").map(({ label }) => label);

export async function draftSbar(input: {
  patientName: string;
  title: string;
  facts: { text: string }[];
  gaps: string[];
}): Promise<Sbar> {
  const raw = await chat<Partial<Sbar>>(
    `You are drafting a clinical handoff in SBAR form, for one clinician to send to another.

Patient: ${input.patientName}
Episode: ${input.title}

Facts from the conversation:
${JSON.stringify(input.facts.map((f) => f.text), null, 2)}

Care the protocol expects that nobody arranged in the conversation:
${JSON.stringify(input.gaps, null, 2)}

Write four parts, each one or two sentences, in the plain language a clinician would say out loud:
- "s" Situation: who this patient is and why they are being handed over, now.
- "b" Background: the history the receiving clinician needs to make sense of it.
- "a" Assessment: what it adds up to, including what is still unresolved.
- "r" Recommendation: what you are asking the receiving clinician to do, specifically.

Use only what the facts support. Do not invent findings, measurements or dates. If the unarranged care above matters to the receiving clinician, the Recommendation is where it belongs.

Return JSON: {"s","b","a","r"}`,
  );

  const part = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  // An empty part is left empty on purpose — the composer shows it as missing
  // rather than sending a handoff with a hole the clinician never saw.
  return { s: part(raw.s), b: part(raw.b), a: part(raw.a), r: part(raw.r) };
}

import { chat } from "./corti";
import type { Clinician } from "./model";

export type Sbar = { s: string; b: string; a: string; r: string };

/** What was asked for out loud, on top of whatever the protocol expects. */
export type Request = { title: string; dueInDays: number };
export type Intent = { recipientId: string | null; quote: string; requests: Request[] };

// A fortnight, when the dictation names no deadline. Long enough not to be a
// false alarm by Friday, short enough that nobody forgets it exists.
const DEFAULT_DUE_DAYS = 14;

/**
 * Two readings of one dictation: who it is being handed to, and what was
 * explicitly asked for. Together in a single call because a second round trip on
 * this tenant costs as much as the work does.
 *
 * The recipient has to be an id from the roster we hand it. A handoff addressed
 * to a clinician who does not exist is worse than one addressed to nobody.
 */
export async function readHandoffIntent(
  transcript: string,
  clinicians: Clinician[],
): Promise<Intent> {
  const raw = await chat<{
    recipientId?: unknown;
    quote?: unknown;
    requests?: { title?: unknown; dueInDays?: unknown }[];
  }>(
    `You are reading a clinical handoff that one clinician dictated, to work out who it is addressed to and what it asks for.

The clinicians on the system:
${JSON.stringify(clinicians.map(({ id, name, role, org }) => ({ id, name, role, org })), null, 2)}

The dictation:
${JSON.stringify(transcript)}

"recipientId": the id of the clinician this is being handed to. Match on the name, the role, or the organisation — "her GP", "primary care" and "Dr Vasquez" can all be the same person. Use null if the dictation does not address anyone in particular. Never return an id that is not in the list above, and never invent a clinician.

"quote": the words you decided that on, verbatim from the dictation. Empty string when recipientId is null.

"requests": the things the speaker explicitly asked the receiving clinician to do — "please check her potassium", "get an echo before the follow-up". Give each a short imperative "title" naming the action, and "dueInDays" as a whole number if a timeframe was actually said. Omit dueInDays when none was. Do not include background, findings, or anything the speaker says they did themselves — only what they are asking someone else to do. Return an empty array if they asked for nothing.

Return JSON: {"recipientId","quote","requests":[{"title","dueInDays"}]}`,
  );

  const known = new Set(clinicians.map((c) => c.id));
  const recipientId =
    typeof raw.recipientId === "string" && known.has(raw.recipientId) ? raw.recipientId : null;

  return {
    recipientId,
    quote: recipientId && typeof raw.quote === "string" ? raw.quote : "",
    requests: (Array.isArray(raw.requests) ? raw.requests : [])
      .map((r) => ({
        title: typeof r.title === "string" ? r.title.trim() : "",
        dueInDays:
          typeof r.dueInDays === "number" && r.dueInDays > 0
            ? Math.round(r.dueInDays)
            : DEFAULT_DUE_DAYS,
      }))
      .filter((r) => r.title !== ""),
  };
}

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

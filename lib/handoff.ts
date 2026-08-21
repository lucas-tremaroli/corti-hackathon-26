import { chat, CHAT_MODELS } from "./corti";
import type { Clinician, Patient } from "./model";

export type Sbar = { s: string; b: string; a: string; r: string };

/** What was asked for out loud, on top of whatever the protocol expects. */
export type Request = { title: string; dueInDays: number };
export type Intent = {
  recipientId: string | null;
  patientId: string | null;
  /** The name as the dictation says it, matched or not — what a new record gets called. */
  patientName: string;
  quote: string;
  requests: Request[];
};

// A fortnight, when the dictation names no deadline. Long enough not to be a
// false alarm by Friday, short enough that nobody forgets it exists.
const DEFAULT_DUE_DAYS = 14;

/**
 * Three readings of one dictation: who it is about, who it is being handed to,
 * and what it asks for. Together in a single call because a second round trip on
 * this tenant costs as much as the work does.
 *
 * Both ids have to come from the rosters we hand it. A handoff addressed to a
 * clinician who does not exist is worse than one addressed to nobody, and a
 * handoff filed against the wrong patient is worse than both.
 *
 * The speaker is deliberately absent from `clinicians`: who is dictating comes
 * from the signed-in profile, so nothing in the words needs to name them and
 * nobody can be handed their own handoff.
 */
export async function readHandoffIntent(
  transcript: string,
  clinicians: Clinician[],
  patients: Patient[],
): Promise<Intent> {
  const raw = await chat<{
    recipientId?: unknown;
    patientId?: unknown;
    patientName?: unknown;
    quote?: unknown;
    requests?: { title?: unknown; dueInDays?: unknown }[];
  }>(
    `You are reading a clinical handoff that one clinician dictated, to work out who it is about, who it is addressed to, and what it asks for.

The patients on the system:
${JSON.stringify(patients.map(({ id, name }) => ({ id, name })), null, 2)}

The clinicians it could be addressed to:
${JSON.stringify(clinicians.map(({ id, name, role, org }) => ({ id, name, role, org })), null, 2)}

The dictation:
${JSON.stringify(transcript)}

"patientId": the id of the patient this handoff is about. Match on the name however it is spoken — a surname alone, "Mrs Smith", a first name, or the full name can all be the same person on the list. The patient is usually the person being spoken to or spoken about throughout, not somebody mentioned in passing: a relative who takes a medicine, or another patient given as a comparison, is not the subject. Use null if nobody on the list is clearly the subject. Never return an id that is not in the list above, and never invent a patient.

"patientName": the subject's name exactly as the dictation says it — "Mrs Smith", "Robert Okafor". Fill this in whether or not you matched somebody on the list, so a patient nobody has a record for can still be named back to the clinician. Empty string only if no name is spoken at all.

"recipientId": the id of the clinician this is being handed to. Match on the name, the role, or the organisation — "her GP", "primary care" and "Dr Vasquez" can all be the same person. The person dictating is not on that list and is never the answer. Use null if the dictation does not address anyone in particular. Never return an id that is not in the list above, and never invent a clinician.

"quote": the words you decided the recipient on, verbatim from the dictation. Empty string when recipientId is null.

"requests": the things the speaker explicitly asked the receiving clinician to do — "please check her potassium", "get an echo before the follow-up". Give each a short imperative "title" naming the action, and "dueInDays" as a whole number if a timeframe was actually said. Omit dueInDays when none was. Do not include background, findings, or anything the speaker says they did themselves — only what they are asking someone else to do. Return an empty array if they asked for nothing.

Return JSON: {"patientId","patientName","recipientId","quote","requests":[{"title","dueInDays"}]}`,
  );

  const pick = (value: unknown, roster: { id: string }[]) =>
    typeof value === "string" && roster.some((row) => row.id === value) ? value : null;

  const recipientId = pick(raw.recipientId, clinicians);

  return {
    recipientId,
    patientId: pick(raw.patientId, patients),
    // Never an id, only what was said. Minting a record is a decision somebody
    // makes on screen, not something a reading is allowed to do on its own.
    patientName:
      typeof raw.patientName === "string" ? raw.patientName.replace(/\s+/g, " ").trim() : "",
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
    // The one call whose answer is read as sentences rather than acted on as a
    // verdict, and the one place the instant model visibly slips.
    CHAT_MODELS.prose,
  );

  const part = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  // An empty part is left empty on purpose — the composer shows it as missing
  // rather than sending a handoff with a hole the clinician never saw.
  return { s: part(raw.s), b: part(raw.b), a: part(raw.a), r: part(raw.r) };
}

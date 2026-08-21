"use server";

import { readFile } from "node:fs/promises";
import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { PROFILE_COOKIE } from "@/lib/profile";
import { askAgent } from "@/lib/agent";
import { createInteraction, extractFacts, predictCodes } from "@/lib/corti";
import { draftSbar, readHandoffIntent, type Request, type Sbar } from "@/lib/handoff";
import type { NoteKind } from "@/lib/model";
import { activeClinician } from "@/lib/profile";
import { clinicians, notesFor, patientById, patients, taskWithNotes } from "@/lib/queries";
import {
  checkClosure,
  classifySteps,
  type Closure,
  type Role,
  sopForCodes,
  sopStep,
  type StepVerdict,
} from "@/lib/sop";
import * as write from "@/lib/writes";

// ---- the console's pipeline ---------------------------------------------
//
// One action per step, so the screen can report each one as it lands and stop
// between any two. None of them write: the graph is untouched until commit,
// which is what makes an interrupted run leave nothing behind.

// Every export of a "use server" file has to be a declared async function —
// an arrow const returning a promise is not recognised as an action.

/**
 * The dictation on file, for when the room is too loud to dictate in.
 *
 * A clinician talking to a colleague, not a doctor talking to a patient: this
 * screen is dictation, and demo/discharge.txt is the consultation an ambient
 * scribe would hear. Feeding that in tested a flow this screen does not have.
 */
export async function loadDemoTranscript() {
  return readFile("demo/dictated-handoff.txt", "utf8");
}

export async function readFacts(transcript: string) {
  return extractFacts(transcript);
}

/** Coding picks the protocol, and the protocol names the episode. */
export async function readCodes(transcript: string) {
  const codes = await predictCodes(transcript);
  const sop = sopForCodes(codes.map((c) => c.code));
  return { codes, protocol: sop ? { id: sop.id, name: sop.name } : null };
}

export async function readSteps(codes: string[], facts: { text: string }[]) {
  const sop = sopForCodes(codes);
  if (!sop) throw new Error("No protocol matches the codes for this conversation");
  return classifySteps(sop.steps, facts);
}

/** Who it is about, who it is addressed to, and what it asks for. */
export async function readIntent(transcript: string) {
  const [me, roster, people] = await Promise.all([activeClinician(), clinicians(), patients()]);
  // The speaker is the signed-in profile, never the dictation — so they are not
  // a candidate recipient, and nobody can be handed their own handoff.
  return readHandoffIntent(
    transcript,
    roster.filter((c) => c.id !== me?.id),
    people,
  );
}

/**
 * A record for somebody the dictation named who has none.
 *
 * Deliberately its own action rather than a side effect of approving: creating a
 * chart is a decision, and the screen shows the near-matches before you take it.
 * The id is a uuid like everything else the app creates — the readable ones in
 * the graph are seeded fixtures, and slugging a name would collide the moment
 * two people share one.
 */
export async function createPatient(name: string) {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean === "") throw new Error("A patient needs a name");

  const patient = { id: crypto.randomUUID(), name: clean };
  await write.savePatient(patient);
  refresh();
  return patient;
}

/** Who the console can file a handoff against, refreshed after one is added. */
export async function listPatients() {
  return patients();
}

export async function draftHandoff(input: {
  patientId: string | null;
  codes: string[];
  facts: { text: string }[];
  gapStepIds: string[];
}) {
  const sop = sopForCodes(input.codes);
  if (!sop) throw new Error("No protocol matches the codes for this conversation");

  // Drafts without a patient rather than refusing to: the four parts come out of
  // the facts, and naming the subject is the one thing a clinician can still fix
  // before approving. Approval is where a patient becomes non-negotiable.
  const patient = input.patientId ? await patientById(input.patientId) : null;

  return draftSbar({
    patientName: patient?.name ?? "the patient",
    title: sop.name,
    facts: input.facts,
    gaps: input.gapStepIds.map((id) => sopStep(id)?.title ?? id),
  });
}

/**
 * Approval, and the only write in the whole flow. Everything the console has been
 * holding lands at once: the conversation and its facts, the protocol's tasks,
 * the tasks that were asked for out loud, and the handoff itself — already sent,
 * because approving it is the sending.
 *
 * The protocol is re-derived from the codes rather than taken from the client.
 */
export async function commitHandoff(input: {
  patientId: string;
  transcript: string;
  facts: { text: string; group?: string }[];
  codes: string[];
  verdicts: StepVerdict[];
  requests: Request[];
  sbar: Sbar;
  recipientId: string;
}) {
  const [me, patient, sop] = await Promise.all([
    activeClinician(),
    patientById(input.patientId),
    Promise.resolve(sopForCodes(input.codes)),
  ]);
  if (!me) throw new Error("No clinician profile — run the seed.");
  if (!patient) throw new Error("No such patient");
  if (!sop) throw new Error("No protocol matches the codes for this conversation");

  const conversationId = crypto.randomUUID();
  await write.saveConversation({
    id: conversationId,
    patientId: input.patientId,
    patientName: patient.name,
    title: sop.name,
    transcript: input.transcript,
    facts: input.facts,
  });
  await write.saveTasks(conversationId, input.patientId, sop.steps, input.verdicts);
  await write.saveRequestedTasks(input.patientId, input.recipientId, input.requests);

  const handoffId = crypto.randomUUID();
  await write.saveHandoff({
    id: handoffId,
    patientId: input.patientId,
    fromId: me.id,
    toId: input.recipientId,
    sbar: input.sbar,
    // Carries the facts a task already accounts for. What it does not carry is
    // the point of the graph screen.
    factIds: input.verdicts
      .filter((v) => v.factIndex >= 0)
      .map((v) => write.factId(conversationId, v.factIndex)),
  });
  await write.sendHandoff(handoffId, input.sbar);

  refresh();
  return handoffId;
}

/** Nothing reaches the other side until a clinician has read the four parts. */
export async function sendHandoff(id: string, sbar: Sbar) {
  await write.sendHandoff(id, sbar);
  refresh();
}

export async function acceptHandoff(id: string) {
  await write.acceptHandoff(id);
  refresh();
}

/**
 * Sign in as the other clinician.
 *
 * The refresh is the whole thing. Setting the cookie changes what the server
 * would send, but the client router goes on serving the payload it already has
 * for this route — so the inbox keeps showing the clinician you just stopped
 * being, which looks exactly like a broken filter.
 */
export async function switchProfile(clinicianId: string) {
  const jar = await cookies();
  jar.set(PROFILE_COOKIE, clinicianId, { path: "/", httpOnly: true, sameSite: "lax" });
  refresh();
}

export async function assignFact(input: {
  factId: string;
  title: string;
  role: Role;
  dueInDays: number;
}) {
  await write.taskFromFact(input);
  refresh();
}

export type Completion = Closure & { done: boolean };

/**
 * Marking a task done is a claim that the protocol's criteria were met, and the
 * notes on the task are the only record of that. The reading already happened —
 * every note updates the closure — so this is a comparison, not a call to Corti.
 */
export async function completeTask(taskId: string): Promise<Completion> {
  const found = await taskWithNotes(taskId);
  if (!found) throw new Error("No such task");

  const step = sopStep(found.task.stepId);
  // ponytail: a task that didn't come from a protocol has no criteria to check
  // against, so it closes on the assignee's word.
  const closure: Closure = step
    ? (found.task.closure ?? (await checkClosure(step, [])))
    : { criteria: [], missing: "" };

  const done = closure.criteria.every((c) => c.met);
  if (done) {
    await write.markDone(taskId);
    refresh();
  }
  return { ...closure, done };
}

// Call before mounting <Ambient>; hand the result straight to its interactionId.
// Corti rejects a duplicate encounter identifier, and the same thing can be
// recorded more than once, so each session gets its own — `scope` (a task id, or
// just "discharge") goes first so the identifier stays traceable.
export async function startAmbient(scope: string, title: string) {
  return createInteraction(`${scope}:${crypto.randomUUID()}`, title);
}

export async function addUpdate(input: {
  taskId: string;
  kind: NoteKind;
  text: string;
  authorRole: Role;
  interactionId?: string;
}) {
  const [found, threads] = await Promise.all([
    taskWithNotes(input.taskId),
    notesFor([input.taskId]),
  ]);
  const step = sopStep(found?.task.stepId ?? null);
  const comments = [...(threads.get(input.taskId) ?? []).map((n) => n.text), input.text];

  // Read this note against the protocol now, while the composer is still showing
  // "Saving…" — that is what makes Mark done a comparison later instead of a
  // wait. A Corti failure leaves the note saved and the previous verdict standing.
  const closure = step ? await checkClosure(step, comments).catch(() => null) : null;

  await write.addNote({ ...input, closure });
  refresh();
}

// ---- the ward assistant --------------------------------------------------

/**
 * A question about the board, answered by a Corti agent rather than a raw chat
 * call. The difference matters: the agent is a named, persistent thing on the
 * tenant with its own system prompt, so the answer comes back the same shape
 * whoever asks and whatever page they ask from.
 */
export async function askWardAgent(question: string) {
  const trimmed = question.trim();
  if (!trimmed) throw new Error("Ask a question first.");
  return askAgent(trimmed);
}

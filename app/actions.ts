"use server";

import { readFile } from "node:fs/promises";
import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { PROFILE_COOKIE } from "@/lib/profile";
import { createInteraction, extractFacts, predictCodes } from "@/lib/corti";
import { draftSbar, type Sbar } from "@/lib/handoff";
import type { NoteKind } from "@/lib/model";
import { notesFor, taskWithNotes } from "@/lib/queries";
import { checkClosure, classifySteps, type Closure, type Role, sopForCodes, sopStep } from "@/lib/sop";
import * as write from "@/lib/writes";

/**
 * Conversation in, handoff out. Everything lands in the graph in one pass: the
 * facts that were said, the protocol's tasks hanging off the facts that justify
 * them, and an SBAR draft that nobody has sent yet.
 */
export async function ingestTranscript(input: {
  patientId: string;
  patientName: string;
  title: string;
  transcript: string;
  fromId: string;
  toId: string;
}) {
  const [facts, codes] = await Promise.all([
    extractFacts(input.transcript),
    predictCodes(input.transcript),
  ]);

  const sop = sopForCodes(codes.map((c) => c.code));
  if (!sop) throw new Error("No protocol matches the codes for this conversation");

  const verdicts = await classifySteps(sop.steps, facts);
  const conversationId = crypto.randomUUID();

  await write.saveConversation({ ...input, id: conversationId, facts });
  await write.saveTasks(conversationId, input.patientId, sop.steps, verdicts);

  const sbar = await draftSbar({
    patientName: input.patientName,
    title: input.title,
    facts,
    gaps: verdicts
      .filter((v) => v.status === "gap")
      .map((v) => sop.steps.find((s) => s.id === v.id)?.title ?? v.id),
  });

  // Carries the facts a task already accounts for. What it does not carry is the
  // point of the graph screen.
  const handoffId = crypto.randomUUID();
  await write.saveHandoff({
    id: handoffId,
    patientId: input.patientId,
    fromId: input.fromId,
    toId: input.toId,
    sbar,
    factIds: verdicts
      .filter((v) => v.factIndex >= 0)
      .map((v) => write.factId(conversationId, v.factIndex)),
  });

  refresh();
  return handoffId;
}

/**
 * Beat one, without a microphone. The live ambient path produces the same
 * transcript; this is the one that survives a bad room.
 */
export async function ingestDemoDischarge() {
  return ingestTranscript({
    patientId: "jane-smith",
    patientName: "Jane Smith",
    title: "New-onset atrial fibrillation",
    transcript: await readFile("demo/discharge.txt", "utf8"),
    fromId: "cardiology",
    toId: "gp",
  });
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
 * Sign in as the other clinician. Setting a cookie in a server action re-renders
 * the tree on its own, so every screen follows the switch without a navigation.
 */
export async function switchProfile(clinicianId: string) {
  const jar = await cookies();
  jar.set(PROFILE_COOKIE, clinicianId, { path: "/", httpOnly: true, sameSite: "lax" });
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
// Corti rejects a duplicate encounter identifier, and one task can be recorded
// more than once, so each session gets its own — task id first to stay traceable.
export async function startAmbient(taskId: string, taskTitle: string) {
  return createInteraction(`${taskId}:${crypto.randomUUID()}`, taskTitle);
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

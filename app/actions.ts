"use server";

import { eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { createInteraction, extractFacts, predictCodes } from "@/lib/corti";
import { db } from "@/lib/db";
import { episodes, type UpdateKind, taskUpdates, tasks } from "@/lib/schema";
import { classifySteps, type Role, sopForCodes } from "@/lib/sop";

const addDays = (from: Date, days: number) => new Date(from.getTime() + days * 86_400_000);

// The whole pipeline: conversation in, protocol-grounded tasks out. Every task
// starts "proposed" — nothing reaches an inbox until a human approves it.
export async function ingestTranscript(input: {
  patientName: string;
  title: string;
  transcript: string;
}) {
  const [facts, codes] = await Promise.all([
    extractFacts(input.transcript),
    predictCodes(input.transcript),
  ]);

  const sop = sopForCodes(codes.map((c) => c.code));
  if (!sop) throw new Error("No protocol matches the codes for this conversation");

  const verdicts = await classifySteps(sop.steps, facts);

  const [episode] = await db
    .insert(episodes)
    .values({ ...input, codes, sopId: sop.id })
    .returning();

  await db.insert(tasks).values(
    sop.steps.map((step) => ({
      episodeId: episode.id,
      title: step.title,
      assigneeRole: step.role,
      dueAt: addDays(episode.dischargedAt, step.dueInDays),
      evidence: verdicts.find((v) => v.id === step.id)?.evidence ?? "",
      sopStepId: step.id,
      source: "sop" as const,
    })),
  );

  refresh();
  return episode.id;
}

// Rejected tasks are left "proposed" rather than deleted: they stay out of every
// inbox, and the episode still records what the protocol asked for.
export async function approveTasks(taskIds: string[]) {
  if (taskIds.length === 0) return;
  await db.update(tasks).set({ status: "open" }).where(inArray(tasks.id, taskIds));
  refresh();
}

export async function completeTask(taskId: string) {
  await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, taskId));
  refresh();
}

// Call before mounting <Ambient>; hand the result straight to its interactionId.
export async function startAmbient(taskId: string, taskTitle: string) {
  return createInteraction(taskId, taskTitle);
}

export async function addUpdate(input: {
  taskId: string;
  kind: UpdateKind;
  text: string;
  authorRole: Role;
  interactionId?: string;
}) {
  // ponytail: a two-word "done" has no facts worth extracting and costs a
  // roundtrip. Drop the threshold if the demo needs facts on every update.
  const facts = input.text.length > 60 ? await extractFacts(input.text) : null;
  await db.insert(taskUpdates).values({ ...input, facts });
  refresh();
}

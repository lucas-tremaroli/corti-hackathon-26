import type { Closure, Role } from "./sop";

// (Clinician)-[:HANDED]->(Handoff)-[:TO]->(Clinician)
// (Handoff)-[:ABOUT]->(Patient)
// (Handoff)-[:CARRIES]->(Fact)
// (Fact)-[:SAID_IN]->(Conversation)-[:ABOUT]->(Patient)
// (Task)-[:OWNED_BY]->(Clinician)
// (Task)-[:BECAUSE_OF]->(Fact)
// (Note)-[:ON]->(Task)
//
// Note is the one addition to the plan's model: closing a task against the
// protocol reads what was written on it, so those have to be nodes too.

export type Patient = { id: string; name: string };
export type Clinician = { id: string; name: string; role: Role; org: string };
export type Fact = { id: string; text: string; group: string };

export type Conversation = { id: string; title: string; transcript: string; at: string };

export type Task = {
  id: string;
  title: string;
  dueAt: string;
  status: "open" | "done";
  stepId: string | null;
  // The fact behind this task, quoted. Empty when the protocol asked for it and
  // the conversation never did.
  evidence: string;
  closure: Closure | null;
};

export type Handoff = {
  id: string;
  s: string;
  b: string;
  a: string;
  r: string;
  at: string;
  sent: boolean;
  accepted: boolean;
};

export type Note = {
  id: string;
  text: string;
  kind: NoteKind;
  at: string;
  author: Role;
  // Set when the note was spoken into a room: the Corti recording it came from.
  interactionId: string | null;
};
export type NoteKind = "typed" | "dictation" | "ambient";

// Neo4j properties are primitives, so a closure verdict travels as JSON text.
export const packClosure = (closure: Closure) => JSON.stringify(closure);
export const unpackClosure = (raw: unknown): Closure | null =>
  typeof raw === "string" ? (JSON.parse(raw) as Closure) : null;

// A protocol step nothing in the conversation supported: the thing the whole
// product exists to surface.
export const isGap = (task: Task) => task.stepId !== null && task.evidence === "";
export const isOverdue = (task: Task) => task.status !== "done" && new Date(task.dueAt) < new Date();

import { rows } from "./graph";
import type { Sbar } from "./handoff";
import { type NoteKind, packClosure } from "./model";
import type { Closure, Role, StepVerdict } from "./sop";

const now = () => new Date().toISOString();
export const addDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString();

/** Facts keep the index they were extracted in, so a task can point back at one. */
export const factId = (conversationId: string, index: number) => `${conversationId}:${index}`;

export async function saveConversation(input: {
  id: string;
  patientId: string;
  patientName: string;
  title: string;
  transcript: string;
  // The Corti recording this came out of, when it was spoken rather than read
  // off disk. Null keeps the property present so the shape never varies.
  interactionId?: string;
  facts: { text: string; group?: string }[];
}) {
  await rows(
    `MERGE (p:Patient {id: $patientId}) SET p.name = $patientName
     CREATE (c:Conversation {id: $id, title: $title, transcript: $transcript, at: $at,
                             interactionId: $interactionId})
     CREATE (c)-[:ABOUT]->(p)
     WITH c
     UNWIND $facts AS row
     CREATE (f:Fact {id: row.id, text: row.text, group: row.group})
     CREATE (f)-[:SAID_IN]->(c)`,
    {
      ...input,
      at: now(),
      interactionId: input.interactionId ?? null,
      facts: input.facts.map((f, index) => ({
        id: factId(input.id, index),
        text: f.text,
        group: f.group ?? "",
      })),
    },
  );
}

/**
 * A patient somebody named out loud who had no record.
 *
 * CREATE rather than the MERGE saveConversation uses: a MERGE on a colliding id
 * would quietly rename an existing chart to whatever was just dictated. Here the
 * uniqueness constraint should throw instead.
 */
export const savePatient = (input: { id: string; name: string }) =>
  rows("CREATE (p:Patient {id: $id, name: $name})", input);

/**
 * The protocol's tasks. A covered step hangs off the fact that covered it; a gap
 * gets a task with no fact behind it, and leaves the fact it should have come
 * from with nothing pointing at it.
 *
 * FOR is what ties a task to its patient, and every task gets one. BECAUSE_OF is
 * only the justification — a gap task has none, so reaching the patient through
 * the fact would make exactly the tasks we care about invisible.
 *
 * Fact ids are built in TypeScript rather than Cypher: a JS number crosses the
 * driver as a Float, and toString(4.0) is "4.0", which matches nothing.
 */
export async function saveTasks(
  conversationId: string,
  patientId: string,
  steps: { id: string; title: string; role: Role; dueInDays: number }[],
  verdicts: StepVerdict[],
) {
  await rows(
    `MATCH (p:Patient {id: $patientId})
     UNWIND $tasks AS row
     MATCH (owner:Clinician {role: row.role})
     CREATE (t:Task {id: row.id, title: row.title, dueAt: row.dueAt, status: 'open',
                     stepId: row.stepId, evidence: row.evidence, closure: null})
     CREATE (t)-[:OWNED_BY]->(owner)
     CREATE (t)-[:FOR]->(p)
     WITH t, row WHERE row.factId IS NOT NULL
     MATCH (f:Fact {id: row.factId})
     CREATE (t)-[:BECAUSE_OF]->(f)`,
    {
      patientId,
      tasks: steps.map((step) => {
        const verdict = verdicts.find((v) => v.id === step.id);
        const index = verdict?.factIndex ?? -1;
        return {
          id: crypto.randomUUID(),
          title: step.title,
          dueAt: addDays(step.dueInDays),
          stepId: step.id,
          role: step.role,
          evidence: verdict?.evidence ?? "",
          factId: index >= 0 ? factId(conversationId, index) : null,
        };
      }),
    },
  );
}

/**
 * Tasks somebody asked for out loud, as opposed to ones the protocol expects.
 * No stepId, because there are no closing criteria to check them against — a
 * spoken instruction is its own justification, and no BECAUSE_OF edge with it.
 */
export async function saveRequestedTasks(
  patientId: string,
  ownerId: string,
  requests: { title: string; dueInDays: number }[],
) {
  if (requests.length === 0) return;
  await rows(
    `MATCH (p:Patient {id: $patientId}), (owner:Clinician {id: $ownerId})
     UNWIND $tasks AS row
     CREATE (t:Task {id: row.id, title: row.title, dueAt: row.dueAt, status: 'open',
                     stepId: null, evidence: row.title, closure: null})
     CREATE (t)-[:OWNED_BY]->(owner)
     CREATE (t)-[:FOR]->(p)`,
    {
      patientId,
      ownerId,
      tasks: requests.map((request) => ({
        id: crypto.randomUUID(),
        title: request.title,
        dueAt: addDays(request.dueInDays),
      })),
    },
  );
}

/** Created unsent: nothing reaches the other side until a clinician sends it. */
export async function saveHandoff(input: {
  id: string;
  patientId: string;
  fromId: string;
  toId: string;
  sbar: Sbar;
  factIds: string[];
}) {
  await rows(
    `MATCH (p:Patient {id: $patientId}), (from:Clinician {id: $fromId}), (to:Clinician {id: $toId})
     CREATE (h:Handoff {id: $id, s: $sbar.s, b: $sbar.b, a: $sbar.a, r: $sbar.r,
                        at: $at, sent: false, accepted: false})
     CREATE (from)-[:HANDED]->(h)
     CREATE (h)-[:TO]->(to)
     CREATE (h)-[:ABOUT]->(p)
     WITH h
     UNWIND $factIds AS id
     MATCH (f:Fact {id: id})
     CREATE (h)-[:CARRIES]->(f)`,
    { ...input, at: now() },
  );
}

export async function sendHandoff(id: string, sbar: Sbar) {
  await rows(
    `MATCH (h:Handoff {id: $id})
     SET h.s = $sbar.s, h.b = $sbar.b, h.a = $sbar.a, h.r = $sbar.r, h.sent = true, h.at = $at`,
    { id, sbar, at: now() },
  );
}

/** The receiving side picking it up — the edge that answers "did anyone?". */
export const acceptHandoff = (id: string) =>
  rows("MATCH (h:Handoff {id: $id}) SET h.accepted = true", { id });

/**
 * An orphan fact gets an owner and a deadline. One click, and the fact stops
 * being an orphan because this edge now exists.
 */
export async function taskFromFact(input: {
  factId: string;
  title: string;
  role: Role;
  dueInDays: number;
}) {
  await rows(
    `MATCH (f:Fact {id: $factId})-[:SAID_IN]->(:Conversation)-[:ABOUT]->(p:Patient)
     MATCH (owner:Clinician {role: $role})
     CREATE (t:Task {id: $id, title: $title, dueAt: $dueAt, status: 'open',
                     stepId: null, evidence: f.text, closure: null})
     CREATE (t)-[:OWNED_BY]->(owner)
     CREATE (t)-[:FOR]->(p)
     CREATE (t)-[:BECAUSE_OF]->(f)`,
    { ...input, id: crypto.randomUUID(), dueAt: addDays(input.dueInDays) },
  );
}

export async function addNote(input: {
  taskId: string;
  text: string;
  kind: NoteKind;
  authorRole: Role;
  interactionId?: string;
  closure: Closure | null;
}) {
  await rows(
    `MATCH (t:Task {id: $taskId})
     CREATE (n:Note {id: $id, text: $text, kind: $kind, at: $at, author: $authorRole,
                     interactionId: $interactionId})
     CREATE (n)-[:ON]->(t)
     SET t.closure = coalesce($closure, t.closure)`,
    {
      ...input,
      id: crypto.randomUUID(),
      at: now(),
      interactionId: input.interactionId ?? null,
      closure: input.closure ? packClosure(input.closure) : null,
    },
  );
}

export const markDone = (taskId: string) =>
  rows("MATCH (t:Task {id: $taskId}) SET t.status = 'done'", { taskId });

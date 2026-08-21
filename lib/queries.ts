import { rows } from "./graph";
import {
  type Clinician,
  type Conversation,
  type Fact,
  type Handoff,
  type Note,
  type Patient,
  type Task,
  unpackClosure,
} from "./model";

// Returning a node hands back a Node object, not the thing we asked for, so
// every query returns properties(). collect() drops the nulls an OPTIONAL MATCH
// leaves behind, which is why the collected lists need no filtering.
//
// Tasks come back with closure still packed; every read goes through this.
type RawTask = Omit<Task, "closure"> & { closure: string | null };
const unpackTask = (task: RawTask): Task => ({ ...task, closure: unpackClosure(task.closure) });

export const clinicians = () =>
  rows<Clinician>(`
    MATCH (c:Clinician)
    RETURN c.id AS id, c.name AS name, c.role AS role, c.org AS org
    ORDER BY c.name`);

/** The handoffs sent to one clinician, newest first, with what they carry. */
export const inboxFor = (clinicianId: string) =>
  rows<{ handoff: Handoff; patient: Patient; from: Clinician; facts: Fact[] }>(
    `MATCH (from:Clinician)-[:HANDED]->(h:Handoff)-[:TO]->(:Clinician {id: $clinicianId})
     MATCH (h)-[:ABOUT]->(p:Patient)
     WHERE h.sent
     OPTIONAL MATCH (h)-[:CARRIES]->(f:Fact)
     RETURN properties(h) AS handoff, properties(p) AS patient, properties(from) AS from,
            collect(DISTINCT properties(f)) AS facts
     ORDER BY handoff.at DESC`,
    { clinicianId },
  );

/**
 * The work this clinician owns, whoever handed it to them and whether anyone did.
 * Reached through FOR, so gap tasks — which have no fact behind them — are in here
 * too. They are the ones that matter.
 */
export async function tasksOwnedBy(clinicianId: string) {
  const found = await rows<{ task: RawTask; patient: Patient }>(
    `MATCH (t:Task)-[:OWNED_BY]->(:Clinician {id: $clinicianId})
     MATCH (t)-[:FOR]->(p:Patient)
     WHERE t.status <> 'done'
     RETURN properties(t) AS task, properties(p) AS patient
     ORDER BY t.dueAt`,
    { clinicianId },
  );
  return found.map((row) => ({ ...row, task: unpackTask(row.task) }));
}

/** Open work per clinician, for the counts beside each inbox in the rail. */
export async function openCounts() {
  const found = await rows<{ id: string; open: number }>(`
    MATCH (t:Task)-[:OWNED_BY]->(c:Clinician)
    WHERE t.status <> 'done'
    RETURN c.id AS id, count(t) AS open`);
  // Counts arrive as Neo4j Integers.
  return new Map(found.map((r) => [r.id, Number(r.open)]));
}

// The query the product exists for: a fact said in a conversation that reached
// no task and no handoff. The dizziness that never got to the GP. Exported
// because the graph screen puts it on the wall — it is the argument.
// A draft carries nothing — nobody has read it. Only a handoff that was
// actually sent counts as having passed the fact on.
export const ORPHAN_FACTS = `
MATCH (f:Fact)-[:SAID_IN]->(c:Conversation)-[:ABOUT]->(p:Patient)
WHERE NOT (f)<-[:BECAUSE_OF]-(:Task) AND NOT (f)<-[:CARRIES]-(:Handoff {sent: true})
RETURN properties(p) AS patient, properties(f) AS fact, c.title AS conversation
ORDER BY p.name, f.text
`;

export const orphanFacts = () =>
  rows<{ patient: Patient; fact: Fact; conversation: string }>(ORPHAN_FACTS);

/** The latest conversation and everything that came out of it. */
export async function latestConversation() {
  const [found] = await rows<
    Conversation & { patient: Patient; facts: Fact[]; handoff: Handoff | null }
  >(`
    MATCH (c:Conversation)-[:ABOUT]->(p:Patient)
    OPTIONAL MATCH (f:Fact)-[:SAID_IN]->(c)
    OPTIONAL MATCH (h:Handoff)-[:ABOUT]->(p)
    RETURN c.id AS id, c.title AS title, c.transcript AS transcript, c.at AS at,
           properties(p) AS patient,
           collect(DISTINCT properties(f)) AS facts,
           head(collect(DISTINCT properties(h))) AS handoff
    ORDER BY c.at DESC
    LIMIT 1`);
  return found ?? null;
}

/** Notes for a whole list of tasks in one round trip, oldest first. */
export async function notesFor(taskIds: string[]) {
  const threads = new Map<string, Note[]>();
  if (taskIds.length === 0) return threads;

  const found = await rows<{ taskId: string; note: Note }>(
    `MATCH (n:Note)-[:ON]->(t:Task)
     WHERE t.id IN $taskIds
     RETURN t.id AS taskId, properties(n) AS note
     ORDER BY n.at`,
    { taskIds },
  );

  for (const { taskId, note } of found) {
    threads.set(taskId, [...(threads.get(taskId) ?? []), note]);
  }
  return threads;
}

export async function taskWithNotes(id: string) {
  const [found] = await rows<{ task: RawTask; notes: string[] }>(
    `MATCH (t:Task {id: $id})
     OPTIONAL MATCH (n:Note)-[:ON]->(t)
     WITH t, n ORDER BY n.at
     RETURN properties(t) AS task, collect(n.text) AS notes`,
    { id },
  );
  return found ? { task: unpackTask(found.task), notes: found.notes } : null;
}

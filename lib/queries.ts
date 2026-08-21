import neo4j from "neo4j-driver";
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

/** Everyone on the books, for choosing whose conversation this is. */
export const patients = () =>
  rows<Patient>("MATCH (p:Patient) RETURN p.id AS id, p.name AS name ORDER BY p.name");

export async function patientById(id: string) {
  const [found] = await rows<Patient>(
    "MATCH (p:Patient {id: $id}) RETURN p.id AS id, p.name AS name",
    { id },
  );
  return found ?? null;
}

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

/**
 * The predicate the product exists for: a fact said in a conversation that
 * reached no task and no handoff. The dizziness that never got to the GP.
 *
 * A draft carries nothing — nobody has read it. Only a handoff that was actually
 * sent counts as having passed the fact on.
 *
 * Takes the Cypher variable to bind against, because the list and the graph
 * reach a fact under different names. One source of truth: if these two ever
 * disagree, the picture and the list underneath it disagree.
 */
export const unclaimed = (v: string) =>
  `NOT (${v})<-[:BECAUSE_OF]-(:Task) AND NOT (${v})<-[:CARRIES]-(:Handoff {sent: true})`;

// Exported because the graph screen puts it on the wall — it is the argument.
export const ORPHAN_FACTS = `
MATCH (f:Fact)-[:SAID_IN]->(c:Conversation)-[:ABOUT]->(p:Patient)
WHERE ${unclaimed("f")}
RETURN properties(p) AS patient, properties(f) AS fact, c.title AS conversation
ORDER BY p.name, f.text
`;

export const orphanFacts = () =>
  rows<{ patient: Patient; fact: Fact; conversation: string }>(ORPHAN_FACTS);

/** Every node and every relationship, in one round trip, for the graph view. */
export type GraphRow = {
  id: string;
  kind: string;
  props: Record<string, unknown>;
  unclaimed: boolean;
  out: { to: string; type: string }[];
};

/**
 * Every node type carries an `id` property, which is what makes one sweep
 * possible. collect() drops the nulls an OPTIONAL MATCH leaves behind, so a fact
 * nothing came of arrives here with an empty `out` — the absence is the data.
 *
 * ORDER BY is not cosmetic: d3 seeds its initial placement from node index, so a
 * stable order is what makes the layout the same picture on every load.
 */
export const graphShape = (limit = 300) =>
  rows<GraphRow>(
    `MATCH (n) WHERE n.id IS NOT NULL
     OPTIONAL MATCH (n)-[r]->(m) WHERE m.id IS NOT NULL
     WITH n, collect(CASE WHEN m IS NULL THEN null ELSE {to: m.id, type: type(r)} END) AS out
     RETURN n.id AS id, labels(n)[0] AS kind, properties(n) AS props, out,
            (n:Fact AND ${unclaimed("n")}) AS unclaimed
     ORDER BY kind, id
     LIMIT $limit`,
    { limit: neo4j.int(limit) },
  );

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

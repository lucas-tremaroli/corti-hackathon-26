import assert from "node:assert";
import { boardState } from "../lib/agent";
import { close, rows } from "../lib/graph";

// The board the agent answers from is one Cypher query, and a wrong traversal in
// it fails silently: every patient comes back "Facts: none recorded" and the
// agent dutifully reports an empty ward. That is the failure this catches — it
// looks like a correct answer, which is what makes it worth a check.
//
// A seeded graph has patients and clinicians but no facts until somebody runs a
// dictation, so this builds one handoff's worth of graph, reads it back, and
// takes it out again.

const CHECK = "check-agent-scratch";

await rows(
  `CREATE (p:Patient {id: $p, name: "Scratch Patient"})
   CREATE (from:Clinician {id: $p + "-from", name: "Dr Scratch Sender", role: "GP", org: "X"})
   CREATE (to:Clinician {id: $p + "-to", name: "Dr Scratch Taker", role: "GP", org: "X"})
   CREATE (c:Conversation {id: $p + "-conv", title: "t", transcript: "t", at: "2026-08-21"})
   CREATE (f:Fact {id: $p + "-fact", text: "on apixaban", group: "medication"})
   CREATE (t:Task {id: $p + "-task", title: "Check INR", dueAt: "2026-08-22", status: "open"})
   CREATE (h:Handoff {id: $p + "-handoff", at: "2026-08-21", sent: true})
   CREATE (f)-[:SAID_IN]->(c)-[:ABOUT]->(p)
   CREATE (t)-[:FOR]->(p)
   CREATE (t)-[:OWNED_BY]->(to)
   CREATE (from)-[:HANDED]->(h)-[:ABOUT]->(p)
   CREATE (h)-[:TO]->(to)`,
  { p: CHECK },
);

try {
  const board = await boardState();
  const section = board.split("## ").find((s) => s.startsWith("Scratch Patient"));
  assert.ok(section, "the patient reaches the board at all");

  // One assertion per traversal, so a broken relationship names itself.
  assert.match(section, /medication: on apixaban/, "Fact -[:SAID_IN]-> Conversation -[:ABOUT]-> Patient");
  assert.match(section, /Check INR \[open, due 2026-08-22, owner Dr Scratch Taker\]/, "Task -[:FOR]-> Patient, with its owner");
  assert.match(section, /from Dr Scratch Sender to Dr Scratch Taker/, "Handoff carries both ends");

  // A patient nobody has said anything about must not silently vanish from the
  // board — an agent that cannot see them cannot report them as unattended.
  const untouched = await rows<{ name: string }>(
    `MATCH (p:Patient) WHERE NOT (p)<-[:ABOUT]-() RETURN p.name AS name LIMIT 1`,
  );
  if (untouched[0]) {
    assert.ok(board.includes(`## ${untouched[0].name}`), "patients with no facts still appear");
  }

  console.log("check-agent: board state reads every edge the agent needs");
} finally {
  await rows(`MATCH (n) WHERE n.id STARTS WITH $p DETACH DELETE n`, { p: CHECK });
  await close();
}

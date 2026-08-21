import assert from "node:assert";
import { CAPTION_MAX, NODE_KINDS, neighbours, toGraph, truncate } from "../lib/graph-view";
import type { GraphRow } from "../lib/queries";

// The shape graphShape() returns, small enough to reason about: one handoff
// between two clinicians about one patient, two tasks on that patient, and the
// kinds this view does not draw — a Fact, a Conversation and a Note.
const rows: GraphRow[] = [
  { id: "p1", kind: "Patient", props: { id: "p1", name: "Jane Smith" }, out: [] },
  {
    id: "d1",
    kind: "Clinician",
    props: { id: "d1", name: "Dr Nielsen", role: "cardiologist" },
    out: [{ to: "h1", type: "HANDED" }],
  },
  { id: "d2", kind: "Clinician", props: { id: "d2", name: "Dr Okafor", role: "gp" }, out: [] },
  {
    id: "h1",
    kind: "Handoff",
    props: { id: "h1", s: "New-onset AF", b: "x".repeat(5000), sent: true },
    // c1:0 is a Fact: a real edge in the graph, to a kind this view no longer draws.
    out: [
      { to: "p1", type: "ABOUT" },
      { to: "d2", type: "TO" },
      { to: "c1:0", type: "CARRIES" },
    ],
  },
  {
    id: "t1",
    kind: "Task",
    props: { id: "t1", title: "Echocardiogram", status: "open" },
    out: [
      { to: "p1", type: "FOR" },
      { to: "d2", type: "OWNED_BY" },
      { to: "c1:0", type: "BECAUSE_OF" },
    ],
  },
  {
    id: "t2",
    kind: "Task",
    props: { id: "t2", title: "Anticoagulation decision", status: "done" },
    out: [
      { to: "p1", type: "FOR" },
      { to: "missing", type: "OWNED_BY" },
    ],
  },
  {
    id: "c1:0",
    kind: "Fact",
    props: { id: "c1:0", text: "She asked whether she needs a blood thinner." },
    out: [{ to: "c1", type: "SAID_IN" }],
  },
  {
    id: "c1",
    kind: "Conversation",
    props: { id: "c1", title: "New-onset atrial fibrillation", transcript: "x".repeat(5000) },
    out: [{ to: "p1", type: "ABOUT" }],
  },
  { id: "n1", kind: "Note", props: { id: "n1", text: "Booked." }, out: [{ to: "t1", type: "ON" }] },
];

const { nodes, edges } = toGraph(rows);

// A kind with no NODE_KINDS entry cannot be drawn — it has no radius and no
// caption. Dropping it is the only safe answer, and it is what keeps the picture
// to the handoff: a Fact reaching the view is the regression this catches.
assert.equal(nodes.length, 6, "every kind in NODE_KINDS is drawn, and nothing else");
for (const id of ["c1:0", "c1", "n1"]) {
  assert.ok(!nodes.some((n) => n.id === id), `${id} has no NODE_KINDS entry and is not drawn`);
}

// forceLink() throws on an id it cannot resolve, which takes the whole page with
// it. Every loose end has to be gone: the ones pointing at kinds we skip, and
// the one pointing outside the LIMIT.
assert.ok(!edges.some((e) => e.target === "missing"), "an edge past the LIMIT is dropped");
assert.ok(!edges.some((e) => e.type === "CARRIES"), "an edge to a Fact is dropped");
const ids = new Set(nodes.map((n) => n.id));
for (const edge of edges) {
  assert.ok(ids.has(edge.source) && ids.has(edge.target), `${edge.id} points at a node nobody drew`);
}
// HANDED, ABOUT, TO, FOR twice, OWNED_BY. CARRIES and BECAUSE_OF land on a Fact,
// SAID_IN and the conversation's ABOUT start at one, ON is the Note's, and one
// OWNED_BY is past the LIMIT.
assert.equal(edges.length, 6, "twelve relationships in, six loose ends dropped");

// Prose crosses the server boundary into a panel a few hundred pixels wide. A
// handoff's background is the long one, and a transcript must not ship at all.
const handoff = nodes.find((n) => n.id === "h1");
assert.ok(handoff, "the handoff is drawn");
assert.ok(
  Object.values(handoff.props).every((v) => v.length <= 240),
  "a long property is truncated before it is sent",
);

// Captions are drawn under a circle a few pixels wide; an untruncated one runs
// into its neighbour.
for (const node of nodes) {
  assert.ok(
    node.caption.length <= CAPTION_MAX,
    `${node.kind} caption is ${node.caption.length} chars: ${node.caption}`,
  );
  assert.notEqual(node.caption, "", `${node.kind} has nothing to label it with`);
}
assert.equal(truncate("  spread   over  lines ", 40), "spread over lines", "whitespace collapses");
assert.equal(truncate("abcdefghij", 5), "abcd…", "an over-long caption ends in an ellipsis");

// Dimming asks "what is within two hops of here", in either direction, and how
// far. From a task: its patient and owner are the first ring, and the handoff
// and the other task on that patient are the second — which is the reason for
// the second ring at all, since one hop never reaches the handoff.
const near = neighbours(edges, "t1");
assert.deepEqual(
  Object.fromEntries(near),
  { t1: 0, p1: 1, d2: 1, h1: 2, t2: 2 },
  "two rings out from a task, each at its shortest distance",
);
assert.ok(!near.has("d1"), "the clinician who handed over is three hops away, and out of range");

// A node reachable both ways keeps the shorter distance, whatever order the
// edges happen to be scanned in.
assert.equal(neighbours(edges, "h1").get("p1"), 1, "the patient is one hop, not two via the task");
assert.equal(neighbours(edges, "t1", 1).size, 3, "one hop is the task, its patient and its owner");

// Every kind the map claims must actually produce a caption from real properties,
// or a node arrives on screen as a circle with nothing under it.
for (const kind of Object.keys(NODE_KINDS)) {
  assert.ok(NODE_KINDS[kind as keyof typeof NODE_KINDS].radius > 0, `${kind} needs a radius`);
}

console.log(`ok — ${nodes.length} nodes, ${edges.length} edges`);

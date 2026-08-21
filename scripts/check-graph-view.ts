import assert from "node:assert";
import { CAPTION_MAX, NODE_KINDS, neighbours, toGraph, truncate } from "../lib/graph-view";
import type { GraphRow } from "../lib/queries";

// The shape graphShape() returns, small enough to reason about: one patient, one
// conversation, two facts of which one reached a task, and a Note nobody draws.
const rows: GraphRow[] = [
  { id: "p1", kind: "Patient", props: { id: "p1", name: "Jane Smith" }, unclaimed: false, out: [] },
  {
    id: "c1",
    kind: "Conversation",
    props: { id: "c1", title: "New-onset atrial fibrillation", transcript: "x".repeat(5000) },
    unclaimed: false,
    out: [{ to: "p1", type: "ABOUT" }],
  },
  {
    id: "c1:0",
    kind: "Fact",
    props: { id: "c1:0", text: "Order echocardiogram.", group: "plan" },
    unclaimed: false,
    out: [{ to: "c1", type: "SAID_IN" }],
  },
  {
    id: "c1:1",
    kind: "Fact",
    props: { id: "c1:1", text: "She asked whether she needs a blood thinner for this.", group: "" },
    unclaimed: true,
    out: [{ to: "c1", type: "SAID_IN" }],
  },
  {
    id: "t1",
    kind: "Task",
    props: { id: "t1", title: "Echocardiogram", status: "open" },
    unclaimed: false,
    // n1 is a Note: a real edge in the graph, to a kind this view does not draw.
    out: [
      { to: "c1:0", type: "BECAUSE_OF" },
      { to: "p1", type: "FOR" },
      { to: "missing", type: "OWNED_BY" },
    ],
  },
  { id: "n1", kind: "Note", props: { id: "n1", text: "Booked." }, unclaimed: false, out: [{ to: "t1", type: "ON" }] },
];

const { nodes, edges } = toGraph(rows);

// A kind with no NODE_KINDS entry cannot be drawn — it has no radius and no
// caption. Dropping it is the only safe answer, and Note is the live case.
assert.equal(nodes.length, 5, "every kind in NODE_KINDS is drawn, and nothing else");
assert.ok(!nodes.some((n) => n.id === "n1"), "a Note has no NODE_KINDS entry and is not drawn");

// forceLink() throws on an id it cannot resolve, which takes the whole page with
// it. Both loose ends have to be gone: the one pointing at a kind we skip, and
// the one pointing outside the LIMIT.
assert.ok(!edges.some((e) => e.target === "missing"), "an edge past the LIMIT is dropped");
assert.ok(!edges.some((e) => e.source === "n1" || e.target === "n1"), "an edge to a Note is dropped");
const ids = new Set(nodes.map((n) => n.id));
for (const edge of edges) {
  assert.ok(ids.has(edge.source) && ids.has(edge.target), `${edge.id} points at a node nobody drew`);
}
// ABOUT, SAID_IN twice, BECAUSE_OF, FOR. The OWNED_BY past the LIMIT and the
// Note's ON are the two that go.
assert.equal(edges.length, 5, "seven relationships in, two loose ends dropped");

// The transcript is thousands of characters and the panel shows properties. It
// must not cross the server boundary at all.
const conversation = nodes.find((n) => n.id === "c1");
assert.ok(conversation, "the conversation is drawn");
assert.ok(!("transcript" in conversation.props), "a transcript never ships to the client");
assert.ok(
  Object.values(conversation.props).every((v) => v.length <= 240),
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

// The one bit the picture exists to show.
assert.equal(nodes.find((n) => n.id === "c1:1")?.unclaimed, true, "the blood thinner reached nobody");
assert.equal(nodes.find((n) => n.id === "c1:0")?.unclaimed, false, "the echo reached a task");

// Dimming asks "what is one hop from here", in either direction.
const near = neighbours(edges, "c1:0");
assert.deepEqual([...near].sort(), ["c1", "c1:0", "t1"], "the fact, its conversation and its task");

// Every kind the map claims must actually produce a caption from real properties,
// or a node arrives on screen as a circle with nothing under it.
for (const kind of Object.keys(NODE_KINDS)) {
  assert.ok(NODE_KINDS[kind as keyof typeof NODE_KINDS].radius > 0, `${kind} needs a radius`);
}

console.log(`ok — ${nodes.length} nodes, ${edges.length} edges`);

import type { GraphRow } from "./queries";

/**
 * Everything the graph view knows about how the graph looks, with no React and
 * no DOM in it, so it can be checked without a browser.
 *
 * Four kinds, which is the whole of a handoff: who was involved, who it was
 * about, and what is owed. Fact, Conversation and Note are deliberately absent —
 * a sentence somebody said is not a party to the handoff, and the picture read
 * as a wall of them. What became of a fact is the Task hanging off it, and the
 * text itself is on /inbox where there is room to read it.
 *
 * Anything graphShape() returns that is missing here is silently not drawn, so
 * the map and the query have to agree. Putting a kind back is one entry — the
 * rest of the pipeline reads the map.
 */
export const NODE_KINDS = {
  Patient: { radius: 15, caption: (p: Props) => str(p.name) },
  Clinician: { radius: 13, caption: (p: Props) => str(p.name) },
  Handoff: { radius: 11, caption: () => "Handoff" },
  Task: { radius: 10, caption: (p: Props) => str(p.title) },
} as const;

export type NodeKind = keyof typeof NODE_KINDS;
export type Props = Record<string, unknown>;

export const isNodeKind = (kind: string): kind is NodeKind => kind in NODE_KINDS;

export type GraphNode = {
  id: string;
  kind: NodeKind;
  caption: string;
  props: Record<string, string>;
};

export type GraphEdge = { id: string; source: string; target: string; type: string };

/** Long enough to recognise the fact, short enough not to collide with its neighbour. */
export const CAPTION_MAX = 24;
/** A transcript is thousands of characters and no panel can show it. */
const VALUE_MAX = 240;

const str = (value: unknown) => (typeof value === "string" ? value : "");

export function truncate(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Property values for the panel. Neo4j hands back Integers and booleans rather
 * than strings, and a Conversation carries its whole transcript — which would
 * ship to the client for a panel that cannot display it.
 */
function readable(props: Props) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === "transcript" || value === null || value === undefined) continue;
    out[key] = truncate(typeof value === "string" ? value : String(value), VALUE_MAX);
  }
  return out;
}

/**
 * Rows from graphShape() into what the view draws.
 *
 * Edges pointing outside the node set are dropped rather than kept: d3's
 * forceLink throws on an id it cannot resolve, and the LIMIT makes that
 * reachable on a graph bigger than this one. Same for node kinds we do not
 * draw — an edge to a Note has nothing to land on.
 */
export function toGraph(rows: GraphRow[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];

  for (const row of rows) {
    if (!isNodeKind(row.kind)) continue;
    nodes.push({
      id: row.id,
      kind: row.kind,
      caption: truncate(NODE_KINDS[row.kind].caption(row.props), CAPTION_MAX),
      props: readable(row.props),
    });
  }

  const drawn = new Set(nodes.map((node) => node.id));
  const edges: GraphEdge[] = [];

  for (const row of rows) {
    if (!drawn.has(row.id)) continue;
    for (const { to, type } of row.out) {
      if (!drawn.has(to)) continue;
      edges.push({ id: `${row.id}|${type}|${to}`, source: row.id, target: to, type });
    }
  }

  return { nodes, edges };
}

/** The coordinate space the simulation and the viewBox agree on. */
export const CANVAS = { width: 1000, height: 620 };

/**
 * Where every node sits before the simulation has run.
 *
 * Two things need this. The server renders the graph with these, so the canvas
 * is never blank while React hydrates and the physics spins up; and the
 * simulation starts from them rather than from its own seeding, which is what
 * makes the settled layout the same picture on every load.
 *
 * A phyllotaxis spiral — the golden angle — because it fills a disc evenly at
 * any count, so nothing overlaps before the forces take over.
 */
export function seedPositions(nodes: GraphNode[]) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const seeded: Record<string, { x: number; y: number }> = {};

  nodes.forEach((node, index) => {
    const radius = 30 * Math.sqrt(0.5 + index);
    const angle = index * golden;
    seeded[node.id] = {
      x: CANVAS.width / 2 + radius * Math.cos(angle),
      y: CANVAS.height / 2 + radius * Math.sin(angle),
    };
  });

  return seeded;
}

/**
 * How far every node within `hops` sits from this one, either direction, as
 * id → distance. Drives the dimming.
 *
 * Two hops rather than one because one hop stops short of the point: from a task
 * you reach its patient and its owner, but not the handoff that should have
 * carried it. The second ring is where the answer usually is.
 *
 * Distance rather than a plain set, so the two rings can be drawn differently —
 * on a graph this small, flattening both to "lit" lights up nearly everything
 * and says nothing. A node is only ever reached at its shortest distance: each
 * pass expands the ring at exactly `hop - 1`, so an earlier, closer answer is
 * never overwritten by a longer way round.
 */
export function neighbours(edges: GraphEdge[], id: string, hops = 2) {
  const near = new Map<string, number>([[id, 0]]);
  for (let hop = 1; hop <= hops; hop++) {
    for (const edge of edges) {
      if (near.get(edge.source) === hop - 1 && !near.has(edge.target)) near.set(edge.target, hop);
      if (near.get(edge.target) === hop - 1 && !near.has(edge.source)) near.set(edge.source, hop);
    }
  }
  return near;
}

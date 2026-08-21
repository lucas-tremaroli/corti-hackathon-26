import type { GraphRow } from "./queries";

/**
 * Everything the graph view knows about how the graph looks, with no React and
 * no DOM in it, so it can be checked without a browser.
 *
 * Note is deliberately absent: it is commentary on a task rather than a link in
 * the chain from something being said to somebody owing work. Putting it back is
 * one entry in NODE_KINDS — the rest of the pipeline reads the map.
 */
export const NODE_KINDS = {
  Patient: { radius: 15, caption: (p: Props) => str(p.name) },
  Clinician: { radius: 13, caption: (p: Props) => str(p.name) },
  Conversation: { radius: 13, caption: (p: Props) => str(p.title) },
  Handoff: { radius: 11, caption: () => "Handoff" },
  Task: { radius: 10, caption: (p: Props) => str(p.title) },
  Fact: { radius: 8, caption: (p: Props) => str(p.text) },
} as const;

export type NodeKind = keyof typeof NODE_KINDS;
export type Props = Record<string, unknown>;

export const isNodeKind = (kind: string): kind is NodeKind => kind in NODE_KINDS;

export type GraphNode = {
  id: string;
  kind: NodeKind;
  caption: string;
  /** True only for a Fact nothing came of — see unclaimed() in queries.ts. */
  unclaimed: boolean;
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
      unclaimed: row.unclaimed === true,
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

/** Node ids one hop from this one, either direction. Drives the dimming. */
export function neighbours(edges: GraphEdge[], id: string) {
  const near = new Set<string>([id]);
  for (const edge of edges) {
    if (edge.source === id) near.add(edge.target);
    if (edge.target === id) near.add(edge.source);
  }
  return near;
}

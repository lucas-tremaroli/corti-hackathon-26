"use client";

import { Button, Text } from "@radix-ui/themes";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CANVAS,
  type GraphEdge,
  type GraphNode,
  NODE_KINDS,
  neighbours,
  seedPositions,
} from "@/lib/graph-view";
import styles from "./graph-view.module.css";

/** Neo4j Browser labels every relationship. Here that is fourteen stacked
    SAID_INs, so they show for what you are pointing at instead. Flip to true for
    Browser's behaviour. */
const SHOW_ALL_REL_LABELS = false;

const { width: WIDTH, height: HEIGHT } = CANVAS;
const ZOOM_RANGE = [0.3, 3] as const;

// d3 writes x/y/vx/vy onto whatever objects it is handed, so the simulation gets
// its own copies and the props React rendered from stay untouched.
type SimNode = SimulationNodeDatum & { id: string; radius: number };
type SimEdge = SimulationLinkDatum<SimNode> & { id: string };

type Placed = { x: number; y: number };
type View = { x: number; y: number; k: number };

export function GraphView({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  // Seeded rather than empty, so the server renders a real graph and the canvas
  // is never blank while the physics starts up.
  const [placed, setPlaced] = useState<Record<string, Placed>>(() => seedPositions(nodes));
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });

  const svg = useRef<SVGSVGElement>(null);
  const sim = useRef<Simulation<SimNode, SimEdge> | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    // Started from the same seed the server drew, so the settled layout is
    // reproducible rather than whatever d3's own seeding happened to produce.
    const seed = seedPositions(nodes);
    const simNodes: SimNode[] = nodes.map((node) => ({
      id: node.id,
      radius: NODE_KINDS[node.kind].radius,
      ...seed[node.id],
    }));
    const simEdges: SimEdge[] = edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    }));

    const publish = () => {
      const next: Record<string, Placed> = {};
      for (const node of simNodes) next[node.id] = { x: node.x ?? 0, y: node.y ?? 0 };
      setPlaced(next);
    };

    const engine = forceSimulation(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimEdge>(simEdges)
          .id((node) => node.id)
          .distance(95),
      )
      .force("charge", forceManyBody().strength(-420))
      .force("center", forceCenter(WIDTH / 2, HEIGHT / 2))
      // The caption sits under the circle, so nodes need clearance for text.
      .force("collide", forceCollide<SimNode>((node) => node.radius + 26));

    // Watching it settle is the nicest part of a force layout and exactly what
    // someone who asked for less motion does not want. matchMedia rather than a
    // CSS query: this decides whether the simulation animates at all.
    const still =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (still) {
      engine.stop();
      engine.tick(300);
      publish();
    } else {
      // One publish per frame — the simulation ticks faster than React should render.
      engine.on("tick", () => {
        if (frame.current !== null) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = null;
          publish();
        });
      });
    }

    sim.current = engine;
    return () => {
      engine.stop();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      sim.current = null;
    };
  }, [nodes, edges]);

  /** Screen pixels to the coordinate space the simulation works in. */
  const toGraphSpace = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const box = svg.current?.getBoundingClientRect();
      if (!box) return { x: 0, y: 0 };
      const scale = WIDTH / box.width;
      return {
        x: ((event.clientX - box.left) * scale - view.x) / view.k,
        y: ((event.clientY - box.top) * scale - view.y) / view.k,
      };
    },
    [view],
  );

  const drag = useCallback(
    (id: string) => (event: React.PointerEvent<SVGGElement>) => {
      const engine = sim.current;
      const node = engine?.nodes().find((candidate) => candidate.id === id);
      if (!engine || !node) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      let moved = false;
      const start = toGraphSpace(event);
      node.fx = start.x;
      node.fy = start.y;
      engine.alphaTarget(0.3).restart();

      const move = (next: PointerEvent) => {
        moved = true;
        const at = toGraphSpace(next);
        node.fx = at.x;
        node.fy = at.y;
      };
      const drop = () => {
        engine.alphaTarget(0);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", drop);
        // Left pinned where it was dropped. Reset layout is how you undo that.
        if (!moved) setSelected((current) => (current === id ? null : id));
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", drop);
    },
    [toGraphSpace],
  );

  const pan = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return;
    const from = { x: event.clientX, y: event.clientY };
    let moved = false;

    const move = (next: PointerEvent) => {
      moved = true;
      const box = svg.current?.getBoundingClientRect();
      const scale = box ? WIDTH / box.width : 1;
      setView((current) => ({
        ...current,
        x: current.x + (next.clientX - from.x) * scale,
        y: current.y + (next.clientY - from.y) * scale,
      }));
      from.x = next.clientX;
      from.y = next.clientY;
    };
    const drop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      if (!moved) setSelected(null);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
  }, []);

  // Zoom about a screen point: whatever sits under it has to stay under it,
  // which is what makes zooming feel like it is following you rather than
  // sliding the picture away.
  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const scale = WIDTH / box.width;
    const px = (clientX - box.left) * scale;
    const py = (clientY - box.top) * scale;

    setView((current) => {
      const k = clamp(current.k * factor, ...ZOOM_RANGE);
      return {
        k,
        x: px - ((px - current.x) / current.k) * k,
        y: py - ((py - current.y) / current.k) * k,
      };
    });
  }, []);

  /** The buttons zoom about the middle — there is no cursor to follow. */
  const step = useCallback(
    (factor: number) => {
      const box = svg.current?.getBoundingClientRect();
      if (box) zoomAt(box.left + box.width / 2, box.top + box.height / 2, factor);
    },
    [zoomAt],
  );

  useEffect(() => {
    const canvas = svg.current;
    if (!canvas) return;

    // React registers wheel passively at the root, so preventDefault() inside an
    // onWheel prop is a no-op — this has to be a native non-passive listener.
    const onWheel = (event: WheelEvent) => {
      // A plain scroll belongs to the page: the unclaimed list sits below this
      // canvas, and swallowing the wheel strands you on it. ⌘/Ctrl is the zoom
      // gesture, and a trackpad pinch already arrives with ctrlKey set.
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, Math.pow(2, -event.deltaY / 200));
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  function reset() {
    const engine = sim.current;
    if (!engine) return;
    for (const node of engine.nodes()) {
      node.fx = null;
      node.fy = null;
    }
    setView({ x: 0, y: 0, k: 1 });
    engine.alpha(0.9).restart();
  }

  const focus = selected ?? hovered;
  const near = useMemo(() => (focus ? neighbours(edges, focus) : null), [edges, focus]);
  const chosen = selected ? nodes.find((node) => node.id === selected) : null;

  return (
    <div className={styles.wrap}>
      <div className={styles.canvas}>
        <svg
          ref={svg}
          className={styles.svg}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="application"
          aria-label={`Care graph: ${nodes.length} nodes, ${edges.length} relationships`}
          onPointerDown={pan}
        >
          <defs>
            <marker
              id="graph-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L8,4 L0,8 Z" className={styles.arrow} />
            </marker>
          </defs>

          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {edges.map((edge) => {
              const a = placed[edge.source];
              const b = placed[edge.target];
              if (!a || !b) return null;
              // An edge belongs to the selection when both ends do, and sits at
              // the distance of its far end — so the second ring fades with the
              // nodes it connects rather than staying as loud as the first.
              const from = near?.get(edge.source);
              const to = near?.get(edge.target);
              const depth =
                from === undefined || to === undefined ? undefined : Math.max(from, to);
              const adjacent = depth !== undefined;
              const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

              return (
                <g
                  key={edge.id}
                  className={styles.edge}
                  data-adjacent={adjacent}
                  data-depth={depth}
                  data-dimmed={near !== null && !adjacent}
                >
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    className={styles.line}
                    markerEnd="url(#graph-arrow)"
                  />
                  {/* Only the first ring is labelled: the second exists to give
                      the neighbourhood context, and naming all of it puts a wall
                      of words over the picture. */}
                  {(SHOW_ALL_REL_LABELS || depth === 1) && (
                    <text x={mid.x} y={mid.y} className={styles.relLabel}>
                      {edge.type}
                    </text>
                  )}
                </g>
              );
            })}

            {nodes.map((node) => {
              const at = placed[node.id];
              if (!at) return null;
              const radius = NODE_KINDS[node.kind].radius;

              return (
                <g
                  key={node.id}
                  className={styles.node}
                  data-kind={node.kind}
                  data-selected={selected === node.id}
                  data-depth={near?.get(node.id)}
                  data-dimmed={near !== null && !near.has(node.id)}
                  transform={`translate(${at.x},${at.y})`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${node.kind}: ${node.caption}`}
                  aria-pressed={selected === node.id}
                  onPointerDown={drag(node.id)}
                  onPointerEnter={() => setHovered(node.id)}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={() => setHovered(node.id)}
                  onBlur={() => setHovered(null)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setSelected((current) => (current === node.id ? null : node.id));
                  }}
                >
                  <circle r={radius} className={styles.dot} />
                  <text y={radius + 14} className={styles.caption}>
                    {node.caption}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Zoom is a modifier gesture, so it needs a way in that does not depend
            on knowing that. These are also the only zoom a keyboard can reach. */}
        <div className={styles.controls}>
          <Button
            type="button"
            size="1"
            variant="surface"
            color="gray"
            aria-label="Zoom out"
            onClick={() => step(1 / 1.3)}
          >
            −
          </Button>
          <Button
            type="button"
            size="1"
            variant="surface"
            color="gray"
            aria-label="Zoom in"
            onClick={() => step(1.3)}
          >
            +
          </Button>
          <Button type="button" size="1" variant="surface" color="gray" onClick={reset}>
            Reset layout
          </Button>
        </div>
      </div>

      {/* The key sits beside the picture it explains, and stays there whatever is
          selected — losing it on click is how you end up with a screen of
          coloured circles and no way to read them. */}
      <aside className={styles.key}>
        <Text size="1" weight="medium" className={styles.panelLabel}>
          Legend
        </Text>
        <ul className={styles.legend}>
          {/* The kinds on screen, not every kind we can draw — the graph is
              scoped to handoffs now, and a swatch for something absent is a key
              to a door that isn't there. */}
          {[...new Set(nodes.map((node) => node.kind))].map((kind) => (
            <li key={kind} className={styles.legendItem}>
              <span className={styles.swatch} data-kind={kind} aria-hidden />
              <Text size="1">{kind}</Text>
            </li>
          ))}
        </ul>
      </aside>

      {/* aria-live: selecting happens on a canvas a screen reader cannot follow,
          so the properties have to announce themselves. */}
      <div className={styles.detail} aria-live="polite">
        <Text size="1" weight="medium" className={styles.panelLabel}>
          {chosen ? chosen.kind : "Selected"}
        </Text>

        {chosen ? (
          <dl className={styles.props}>
            {Object.entries(chosen.props).map(([key, value]) => (
              <div key={key} className={styles.prop}>
                <dt>
                  <Text size="1" className={styles.propKey}>
                    {key}
                  </Text>
                </dt>
                <dd>
                  <Text as="p" size="2">
                    {value}
                  </Text>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <Text as="p" size="2" color="gray" className={styles.hint}>
            Click a node to see everything stored on it. Drag to reposition. Pinch to zoom, or hold
            ⌘ while scrolling.
          </Text>
        )}
      </div>
    </div>
  );
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

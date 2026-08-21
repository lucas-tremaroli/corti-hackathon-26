import { Heading, Text } from "@radix-ui/themes";
import { GraphView } from "@/components/graph-view";
import { Rail } from "@/components/rail";
import { RailProfile } from "@/components/rail-profile";
import { Shell } from "@/components/shell";
import { toGraph } from "@/lib/graph-view";
import { activeClinician } from "@/lib/profile";
import { graphShape, ORPHAN_FACTS } from "@/lib/queries";
import styles from "./graph.module.css";

// See app/page.tsx — the graph is read at request time, never prerendered.
export const dynamic = "force-dynamic";

export default async function GraphPage() {
  const [current, shape] = await Promise.all([activeClinician(), graphShape()]);
  const { nodes, edges } = toGraph(shape);
  // Counted off the drawn nodes rather than a second query: the number in the
  // header and the hollow circles under it are then the same fact.
  const unclaimed = nodes.filter((node) => node.unclaimed).length;

  return (
    <Shell rail={<Rail current="/graph" clinicianId={current?.id} />} profile={<RailProfile />}>
      <header className={styles.head}>
        <Heading as="h1" size="4" weight="medium">
          The graph
        </Heading>
        <div className={styles.counts}>
          <Text size="2" color="gray">
            {nodes.length} nodes · {edges.length} relationships
          </Text>
          {/* The one number that is an alarm rather than a measurement, in the
              one colour this app spends on alarms. */}
          <Text size="2" color={unclaimed > 0 ? "red" : "gray"}>
            {unclaimed > 0 ? `${unclaimed} said, nothing came of it` : "Nothing unclaimed"}
          </Text>
        </div>
      </header>

      <GraphView nodes={nodes} edges={edges} />

      {/* The query is the argument, so it is on the screen rather than in the
          slides: a gap is a node with no edge. This is the same unclaimed()
          predicate that draws a fact hollow above. */}
      <details className={styles.query}>
        <summary className={styles.queryHead}>
          <Text size="1" className={styles.queryLabel}>
            How a gap is found
          </Text>
        </summary>
        <pre className={styles.cypher}>{ORPHAN_FACTS.trim()}</pre>
      </details>
    </Shell>
  );
}

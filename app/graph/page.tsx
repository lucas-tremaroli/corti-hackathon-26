import { Heading, Text } from "@radix-ui/themes";
import { GraphView } from "@/components/graph-view";
import { Rail } from "@/components/rail";
import { RailProfile } from "@/components/rail-profile";
import { Shell } from "@/components/shell";
import { toGraph } from "@/lib/graph-view";
import { activeClinician } from "@/lib/profile";
import { graphShape } from "@/lib/queries";
import styles from "./graph.module.css";

// See app/page.tsx — the graph is read at request time, never prerendered.
export const dynamic = "force-dynamic";

export default async function GraphPage() {
  const [current, shape] = await Promise.all([activeClinician(), graphShape()]);
  const { nodes, edges } = toGraph(shape);

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
          <Text size="2" color="gray">
            Who handed over, about whom, and what is owed
          </Text>
        </div>
      </header>

      {/* The gaps argument moved out with the facts: no fact is drawn here now,
          so the unclaimed count and the Cypher behind it made a claim about
          circles that are not on this screen. Both live on /inbox, next to the
          sentence each one is about. */}
      <GraphView nodes={nodes} edges={edges} />
    </Shell>
  );
}

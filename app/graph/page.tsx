import { Heading, Text } from "@radix-ui/themes";
import { AssignFact } from "@/components/assign-fact";
import { Rail } from "@/components/rail";
import { RailProfile } from "@/components/rail-profile";
import { Shell } from "@/components/shell";
import { activeClinician } from "@/lib/profile";
import { orphanFacts, ORPHAN_FACTS } from "@/lib/queries";
import styles from "./graph.module.css";

// See app/page.tsx — the graph is read at request time, never prerendered.
export const dynamic = "force-dynamic";

export default async function GraphPage() {
  const [orphans, current] = await Promise.all([orphanFacts(), activeClinician()]);

  return (
    <Shell rail={<Rail current="/graph" clinicianId={current?.id} />} profile={<RailProfile />}>
      <header className={styles.head}>
        <Heading as="h1" size="4" weight="medium">
          Said, and nothing came of it
        </Heading>
        <Text size="2" color={orphans.length > 0 ? "red" : "gray"}>
          {orphans.length > 0 ? `${orphans.length} unclaimed` : "All claimed"}
        </Text>
      </header>

      {/* The query is the argument, so it is on the screen rather than in the
          slides: a gap is a node with no edge. */}
      <details className={styles.query}>
        <summary className={styles.queryHead}>
          <Text size="1" className={styles.queryLabel}>
            How this list is found
          </Text>
        </summary>
        <pre className={styles.cypher}>{ORPHAN_FACTS.trim()}</pre>
      </details>

      {orphans.length === 0 ? (
        <Text as="p" size="2" color="gray" className={styles.empty}>
          Every fact anyone said reaches a task or a handoff. Nothing is sitting on its own.
        </Text>
      ) : (
        <ol className={styles.rows}>
          {orphans.map(({ patient, fact, conversation }) => (
            <li key={fact.id} className={styles.row}>
              <div className={styles.said}>
                <Text as="p" size="3">
                  “{fact.text}”
                </Text>
                <Text size="1" color="gray">
                  {patient.name} · {conversation}
                </Text>
              </div>
              <AssignFact factId={fact.id} factText={fact.text} />
            </li>
          ))}
        </ol>
      )}
    </Shell>
  );
}

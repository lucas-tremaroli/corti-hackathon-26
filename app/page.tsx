import { Heading, Text } from "@radix-ui/themes";
import { HandoffConsole } from "@/components/handoff-console";
import { Rail } from "@/components/rail";
import { RailProfile } from "@/components/rail-profile";
import { Shell } from "@/components/shell";
import { activeClinician } from "@/lib/profile";
import { clinicians, patients } from "@/lib/queries";
import styles from "./page.module.css";

// Neo4j reads are invisible to the cache, so without this the graph is baked in
// at build time and the demo shows a board that never moves.
export const dynamic = "force-dynamic";

/**
 * Where a handoff gets made. Not a record of the last one — that lives in the
 * recipient's inbox once it is sent, and on the graph either way.
 */
export default async function HandoffPage() {
  const [current, people, everyone] = await Promise.all([
    activeClinician(),
    patients(),
    clinicians(),
  ]);

  return (
    <Shell rail={<Rail current="/" clinicianId={current?.id} />} profile={<RailProfile />}>
      <header className={styles.head}>
        <Heading as="h1" size="4" weight="medium">
          Handoff
        </Heading>
      </header>

      {current === null || people.length === 0 ? (
        <Text as="p" size="2" color="gray" className={styles.empty}>
          Nothing to hand over yet. Run the seed.
        </Text>
      ) : (
        <HandoffConsole patients={people} clinicians={everyone} me={current} />
      )}
    </Shell>
  );
}

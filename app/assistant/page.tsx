import { Heading, Text } from "@radix-ui/themes";
import { Rail } from "@/components/rail";
import { RailProfile } from "@/components/rail-profile";
import { Shell } from "@/components/shell";
import { WardAgent } from "@/components/ward-agent";
import { activeClinician } from "@/lib/profile";
import styles from "./assistant.module.css";

// See app/page.tsx — the graph is read at request time, never prerendered.
export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const current = await activeClinician();

  return (
    <Shell rail={<Rail current="/assistant" clinicianId={current?.id} />} profile={<RailProfile />}>
      <header className={styles.head}>
        <Heading as="h1" size="4" weight="medium">
          Ask the ward
        </Heading>
        {/* What it can answer from, so a thin answer reads as a thin graph
            rather than a thin agent. */}
        <Text size="2" color="gray" className={styles.about}>
          A Corti agent, reading the same graph as everything else here
        </Text>
      </header>
      <WardAgent />
    </Shell>
  );
}

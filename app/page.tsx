import { Heading, Text } from "@radix-ui/themes";
import { HandoffDraft } from "@/components/handoff-draft";
import { Ingest } from "@/components/ingest";
import { Rail } from "@/components/rail";
import { Shell } from "@/components/shell";
import { latestConversation } from "@/lib/queries";
import styles from "./page.module.css";

// Neo4j reads are invisible to the cache, so without this the graph is baked in
// at build time and the demo shows a board that never moves.
export const dynamic = "force-dynamic";

export default async function HandoffPage() {
  const conversation = await latestConversation();

  return (
    <Shell rail={<Rail current="/" />}>
      {conversation === null ? (
        <>
          <header className={styles.head}>
            <Heading as="h1" size="4" weight="medium">
              Handoff
            </Heading>
          </header>
          <div className={styles.empty}>
            <Text as="p" size="2" color="gray">
              No conversation yet. Record the discharge, or take the one on file.
            </Text>
            <Ingest />
          </div>
        </>
      ) : (
        <>
          <header className={styles.head}>
            <Heading as="h1" size="4" weight="medium">
              {conversation.patient.name}
            </Heading>
            <Text size="2" color="gray">
              {conversation.title}
            </Text>
          </header>

          {/* Evidence on expand, never dumped: the transcript and what Corti
              pulled out of it are both one disclosure away. */}
          <details className={styles.source}>
            <summary className={styles.sourceHead}>
              <Text size="1" className={styles.sourceLabel}>
                Conversation
              </Text>
              <Text size="1" color="gray">
                {conversation.facts.length} facts
              </Text>
            </summary>
            <div className={styles.sourceBody}>
              <pre className={styles.transcript}>{conversation.transcript}</pre>
              <ul className={styles.facts}>
                {conversation.facts.map((fact) => (
                  <li key={fact.id}>
                    <Text size="2">{fact.text}</Text>
                  </li>
                ))}
              </ul>
            </div>
          </details>

          {conversation.handoff ? (
            <HandoffDraft handoff={conversation.handoff} recipient="the GP" />
          ) : (
            <div className={styles.empty}>
              <Text as="p" size="2" color="gray">
                This conversation has no handoff drafted against it.
              </Text>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

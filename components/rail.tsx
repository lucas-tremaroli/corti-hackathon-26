import { Text } from "@radix-ui/themes";
import Link from "next/link";
import { clinicians, openCounts } from "@/lib/queries";
import styles from "./rail.module.css";

/**
 * Three destinations, in the order the work moves: the handoff being written,
 * the inboxes it lands in, and the facts that reached neither.
 */
export async function Rail({ current }: { current: string }) {
  const [people, counts] = await Promise.all([clinicians(), openCounts()]);

  return (
    <>
      <div className={styles.group}>
        <Link href="/" className={styles.item} aria-current={current === "/" ? "page" : undefined}>
          <Text size="2">Handoff</Text>
        </Link>
        <Link
          href="/graph"
          className={styles.item}
          aria-current={current === "/graph" ? "page" : undefined}
        >
          <Text size="2">Graph</Text>
        </Link>
      </div>

      <div className={styles.group}>
        <Text size="1" weight="medium" className={styles.label}>
          Inboxes
        </Text>
        {people.map((person) => (
          <Link
            key={person.id}
            href={`/inbox?clinician=${person.id}`}
            className={styles.item}
            aria-current={current === person.id ? "page" : undefined}
          >
            <Text size="2">{person.name}</Text>
            <Text size="1" className={styles.count}>
              {counts.get(person.id) ?? "–"}
            </Text>
          </Link>
        ))}
      </div>
    </>
  );
}

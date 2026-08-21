import { Text } from "@radix-ui/themes";
import Link from "next/link";
import { openCounts } from "@/lib/queries";
import styles from "./rail.module.css";

const DESTINATIONS = [
  { href: "/", label: "Handoff" },
  { href: "/inbox", label: "Inbox" },
  { href: "/graph", label: "Graph" },
  { href: "/assistant", label: "Ask" },
];

/**
 * Four destinations, in the order the work moves: the handoff being written, the
 * inbox it lands in, and the facts that reached neither. Whose inbox is a question
 * for the profile at the bottom of the rail, not for this list.
 *
 * Ask sits last because it is the one that answers rather than acts.
 */
export async function Rail({ current, clinicianId }: { current: string; clinicianId?: string }) {
  const counts = await openCounts();
  const open = clinicianId ? counts.get(clinicianId) : undefined;

  return (
    <div className={styles.group}>
      {DESTINATIONS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={styles.item}
          aria-current={current === href ? "page" : undefined}
        >
          <Text size="2">{label}</Text>
          {href === "/inbox" && open !== undefined && open > 0 && (
            <Text size="1" className={styles.count}>
              {open}
            </Text>
          )}
        </Link>
      ))}
    </div>
  );
}

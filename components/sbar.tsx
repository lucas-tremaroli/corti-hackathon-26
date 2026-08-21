import { Text } from "@radix-ui/themes";
import { SBAR_PARTS, type Sbar as SbarValue } from "@/lib/handoff";
import styles from "./sbar.module.css";

/**
 * The four parts, wherever they appear. The console renders one that is still
 * being drafted and the inbox renders one that was sent — same shape, so a
 * clinician approving a handoff and the clinician reading it are looking at the
 * same object. Only the word for an empty part differs.
 *
 * Takes anything with s/b/a/r on it, which a stored Handoff satisfies.
 */
export function Sbar({ sbar, missing }: { sbar: SbarValue; missing: string }) {
  return (
    <dl className={styles.sbar}>
      {SBAR_PARTS.map(({ key, label }) => (
        <div key={key} className={styles.part}>
          <dt>
            <Text size="1" weight="medium" className={styles.label}>
              {label}
            </Text>
          </dt>
          <dd>
            <Text as="p" size="2">
              {sbar[key] || <span className={styles.missing}>{missing}</span>}
            </Text>
          </dd>
        </div>
      ))}
    </dl>
  );
}

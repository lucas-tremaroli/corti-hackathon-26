"use client";

import { Button, Text, TextArea } from "@radix-ui/themes";
import { useState, useTransition } from "react";
import { sendHandoff } from "@/app/actions";
import { missingParts, SBAR_PARTS, type Sbar } from "@/lib/handoff";
import type { Handoff } from "@/lib/model";
import { toast } from "./toast";
import styles from "./handoff-draft.module.css";

/**
 * The four parts, editable. Corti drafts them; the clinician owns them. A part
 * left empty is shown as missing rather than quietly sent as a hole.
 */
export function HandoffDraft({ handoff, recipient }: { handoff: Handoff; recipient: string }) {
  const [sbar, setSbar] = useState<Sbar>({
    s: handoff.s,
    b: handoff.b,
    a: handoff.a,
    r: handoff.r,
  });
  const [sent, setSent] = useState(handoff.sent);
  const [pending, run] = useTransition();

  const missing = missingParts(sbar);

  return (
    <section className={styles.draft}>
      <div className={styles.label}>
        <Text size="1" weight="medium" className={styles.labelText}>
          {sent ? "Sent" : "Draft"}
        </Text>
        <Text size="1" color={missing.length > 0 ? "red" : "gray"}>
          {missing.length > 0 ? `${missing.join(" and ")} missing` : "Four parts"}
        </Text>
      </div>

      <dl className={styles.parts}>
        {SBAR_PARTS.map(({ key, label }) => (
          <div key={key} className={styles.part}>
            <dt>
              <Text size="1" weight="medium" className={styles.partLabel}>
                {label}
              </Text>
            </dt>
            <dd>
              {sent ? (
                <Text as="p" size="2">
                  {sbar[key]}
                </Text>
              ) : (
                <TextArea
                  size="2"
                  rows={2}
                  value={sbar[key]}
                  aria-label={label}
                  placeholder={`${label} — nothing drafted`}
                  onChange={(event) => setSbar({ ...sbar, [key]: event.target.value })}
                />
              )}
            </dd>
          </div>
        ))}
      </dl>

      {!sent && (
        <div className={styles.action}>
          <Button
            type="button"
            size="2"
            variant="surface"
            color="gray"
            disabled={pending}
            onClick={() =>
              run(async () => {
                await sendHandoff(handoff.id, sbar);
                setSent(true);
                toast(`Handed to ${recipient}.`);
              })
            }
          >
            {pending ? "Sending…" : `Send to ${recipient}`}
          </Button>
        </div>
      )}
    </section>
  );
}

"use client";

import { Button, Callout, Text } from "@radix-ui/themes";
import { useState, useTransition } from "react";
import { type Closure, completeTask } from "@/app/actions";
import styles from "./complete-task.module.css";

export function CompleteTask({ taskId, criteria }: { taskId: string; criteria: string[] }) {
  const [result, setResult] = useState<Closure | null>(null);
  const [pending, run] = useTransition();

  const unmet = result?.criteria.filter((c) => !c.met).length ?? 0;

  return (
    <section className={styles.closure}>
      <Text size="1" weight="medium" className={styles.label}>
        Closes when
      </Text>

      <ul className={styles.list}>
        {criteria.map((text, index) => {
          const verdict = result?.criteria[index];
          return (
            <li key={text} className={styles.criterion}>
              {/* Same hollow-to-filled mark as the row gutter: filled means
                  something on the record backs it. */}
              <span className={`${styles.mark} ${verdict?.met ? styles.met : ""}`} aria-hidden />
              <div className={styles.criterionText}>
                <Text as="p" size="2">
                  {text}
                </Text>
                {verdict?.evidence && (
                  <Text as="p" size="1" color="gray">
                    {verdict.evidence}
                  </Text>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {result && !result.done && (
        <Callout.Root size="1" color="blue" variant="soft">
          <Callout.Text>
            {unmet === 1 ? "One criterion has" : `${unmet} criteria have`} nothing in the comments
            behind {unmet === 1 ? "it" : "them"} yet. Record what happened, then mark it done.
          </Callout.Text>
        </Callout.Root>
      )}

      <div className={styles.action}>
        <Button
          type="button"
          size="1"
          variant="surface"
          color="gray"
          disabled={pending}
          onClick={() => run(async () => setResult(await completeTask(taskId)))}
        >
          {pending ? "Checking comments…" : "Mark done"}
        </Button>
      </div>
    </section>
  );
}

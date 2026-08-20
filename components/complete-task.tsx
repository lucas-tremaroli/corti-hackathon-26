"use client";

import { Button, Text } from "@radix-ui/themes";
import { useState, useTransition } from "react";
import { type Completion, completeTask } from "@/app/actions";
import type { Closure } from "@/lib/sop";
import { toast } from "./toast";
import styles from "./complete-task.module.css";

export function CompleteTask({
  taskId,
  taskTitle,
  criteria,
  closure,
}: {
  taskId: string;
  taskTitle: string;
  criteria: string[];
  // What the last comment on this task showed. Already on the row when it
  // opens, so the marks don't wait for anyone to press the button.
  closure: Closure | null;
}) {
  const [result, setResult] = useState<Completion | null>(null);
  const [pending, run] = useTransition();
  const verdicts = result?.criteria ?? closure?.criteria;

  return (
    <section className={styles.closure}>
      <Text size="1" weight="medium" className={styles.label}>
        Closes when
      </Text>

      <ul className={styles.list}>
        {criteria.map((text, index) => {
          const verdict = verdicts?.[index];
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

      <div className={styles.action}>
        <Button
          type="button"
          size="1"
          variant="surface"
          color="gray"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const next = await completeTask(taskId);
              setResult(next);
              // The marks above already say which criteria failed, so the toast
              // says what to do about it rather than repeating them.
              if (next.done) toast(`${taskTitle} is closed and out of your inbox.`);
              else toast(`${taskTitle} stays open. ${next.missing}`, "error");
            })
          }
        >
          {pending ? "Closing…" : "Mark done"}
        </Button>
      </div>
    </section>
  );
}

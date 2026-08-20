"use client";

import { Button, Text } from "@radix-ui/themes";
import { useEffect, useState, useTransition } from "react";
import { type Closure, completeTask } from "@/app/actions";
import styles from "./complete-task.module.css";

function refusal(result: Closure) {
  const unmet = result.criteria.filter((c) => !c.met).length;
  return `${unmet === 1 ? "One criterion has" : `${unmet} criteria have`} nothing in the comments behind ${unmet === 1 ? "it" : "them"} yet. Record what happened, then mark it done.`;
}

export function CompleteTask({ taskId, criteria }: { taskId: string; criteria: string[] }) {
  const [result, setResult] = useState<Closure | null>(null);
  // ponytail: one toast per task row, because only one Mark done can be in
  // flight. Two rows refused at once would stack on top of each other.
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
  const [pending, run] = useTransition();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

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
              // The marks above already say which criteria failed; the toast is
              // for the click that didn't do what the button promised.
              setToast(next.done ? null : { text: refusal(next), id: Date.now() });
            })
          }
        >
          {pending ? "Checking comments…" : "Mark done"}
        </Button>
      </div>

      {toast && (
        <div className={styles.toast} role="alert">
          <Text size="2">{toast.text}</Text>
          <button
            type="button"
            className={styles.dismiss}
            aria-label="Dismiss"
            onClick={() => setToast(null)}
          >
            ✕
          </button>
        </div>
      )}
    </section>
  );
}

"use client";

import { Button } from "@radix-ui/themes";
import { useState, useTransition } from "react";
import { assignFact } from "@/app/actions";
import { ROLES, type Role } from "@/lib/sop";
import { toast } from "./toast";
import styles from "./assign-fact.module.css";

// Enough to give a fact an owner and a deadline, which is the entire fix. A
// title, a person, a date — the three things a task needs to be real.
const WINDOWS = [
  { days: 7, label: "in a week" },
  { days: 14, label: "in a fortnight" },
  { days: 30, label: "in a month" },
];

export function AssignFact({ factId, factText }: { factId: string; factText: string }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>("GP");
  const [days, setDays] = useState(14);
  const [pending, run] = useTransition();

  if (!open) {
    return (
      <Button
        type="button"
        size="1"
        variant="surface"
        color="gray"
        onClick={() => setOpen(true)}
        className={styles.trigger}
      >
        Give it an owner
      </Button>
    );
  }

  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <span className={styles.hidden}>Owner</span>
        <select
          className={styles.select}
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
        >
          {Object.entries(ROLES).map(([value, { long }]) => (
            <option key={value} value={value}>
              {long}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.hidden}>Due</span>
        <select
          className={styles.select}
          value={days}
          onChange={(event) => setDays(Number(event.target.value))}
        >
          {WINDOWS.map((window) => (
            <option key={window.days} value={window.days}>
              {window.label}
            </option>
          ))}
        </select>
      </label>

      <Button
        type="button"
        size="1"
        variant="surface"
        color="gray"
        disabled={pending}
        onClick={() =>
          run(async () => {
            // The fact itself is the task: what was said is what has to be acted on.
            await assignFact({ factId, title: factText, role, dueInDays: days });
            toast(`${ROLES[role].long} owns it, ${WINDOWS.find((w) => w.days === days)?.label}.`);
          })
        }
      >
        {pending ? "…" : "Assign"}
      </Button>
    </div>
  );
}

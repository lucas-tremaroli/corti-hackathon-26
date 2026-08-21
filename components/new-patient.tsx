"use client";

import { Button, Text } from "@radix-ui/themes";
import { useState, useTransition } from "react";
import { createPatient } from "@/app/actions";
import type { Patient } from "@/lib/model";
import { similarPatients } from "@/lib/patients";
import { toast } from "./toast";
import styles from "./new-patient.module.css";

/**
 * The way out of a dictation about somebody with no record.
 *
 * The name arrives as it was spoken and stays editable — "Mrs Smith" is how a
 * colleague talks, not how a chart is filed. Anything already on the roster that
 * looks like this name is shown first and can be taken instead, because the
 * failure worth designing against is not a missing record but a second one.
 */
export function NewPatient({
  heardName,
  patients,
  onChose,
}: {
  heardName: string;
  patients: Patient[];
  onChose: (patient: Patient) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(heardName);
  const [pending, run] = useTransition();

  const clean = name.replace(/\s+/g, " ").trim();
  const similar = similarPatients(clean, patients);

  if (!open) {
    return (
      <Button
        type="button"
        size="1"
        variant="ghost"
        color="gray"
        onClick={() => setOpen(true)}
        className={styles.trigger}
      >
        {heardName === "" ? "Add a patient" : `Add “${heardName}”`}
      </Button>
    );
  }

  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <Text size="1" className={styles.label}>
          New patient
        </Text>
        <input
          className={styles.input}
          value={name}
          autoFocus
          placeholder="Full name"
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      {similar.length > 0 && (
        <div className={styles.warning}>
          <Text as="p" size="1">
            {similar.length === 1 ? "This may already be" : "This may already be one of"}:
          </Text>
          <div className={styles.matches}>
            {similar.map((patient) => (
              <Button
                key={patient.id}
                type="button"
                size="1"
                variant="surface"
                color="gray"
                onClick={() => onChose(patient)}
              >
                Use {patient.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <Button
          type="button"
          size="1"
          variant="ghost"
          color="gray"
          onClick={() => {
            setOpen(false);
            setName(heardName);
          }}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="1"
          variant="surface"
          color="gray"
          disabled={pending || clean === ""}
          onClick={() =>
            run(async () => {
              try {
                const patient = await createPatient(clean);
                onChose(patient);
                setOpen(false);
                toast(`${patient.name} has a record.`);
              } catch (error) {
                toast((error as Error).message, "error");
              }
            })
          }
        >
          {pending ? "…" : similar.length > 0 ? "Create anyway" : "Create"}
        </Button>
      </div>
    </div>
  );
}

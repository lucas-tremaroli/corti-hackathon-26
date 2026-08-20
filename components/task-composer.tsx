"use client";

import { Button, Text, TextArea } from "@radix-ui/themes";
import { useState, useTransition } from "react";
import { addUpdate, startAmbient } from "@/app/actions";
import type { Role } from "@/lib/sop";
import type { UpdateKind } from "@/lib/schema";
import { Ambient } from "./ambient";
import { Dictation } from "./dictation";
import styles from "./task-composer.module.css";

export function TaskComposer({
  taskId,
  taskTitle,
  authorRole,
}: {
  taskId: string;
  taskTitle: string;
  authorRole: Role;
}) {
  const [text, setText] = useState("");
  // Whichever input last contributed words decides how the update is filed.
  const [kind, setKind] = useState<UpdateKind>("typed");
  const [interactionId, setInteractionId] = useState<string>();
  const [pending, run] = useTransition();

  const append = (next: UpdateKind) => (chunk: string) => {
    setKind(next);
    setText((prev) => (prev ? `${prev} ${chunk}` : chunk));
  };

  return (
    <div className={styles.composer}>
      <TextArea
        size="2"
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Add an update, or dictate one."
      />

      <div className={styles.controls}>
        {/* ponytail: one dictation element per row, each minting its own token on
            upgrade. Fine at a screenful; mount it on <details> toggle if the list
            ever grows past that. */}
        <Dictation onTranscript={append("dictation")} />

        {interactionId ? (
          <Ambient interactionId={interactionId} onTranscript={append("ambient")} />
        ) : (
          <Button
            type="button"
            size="1"
            variant="ghost"
            color="gray"
            disabled={pending}
            onClick={() =>
              run(async () => setInteractionId(await startAmbient(taskId, taskTitle)))
            }
          >
            Record a conversation
          </Button>
        )}

        <span className={styles.spacer} />

        <Button
          type="button"
          size="1"
          variant="surface"
          color="gray"
          disabled={pending || text.trim() === ""}
          onClick={() =>
            run(async () => {
              await addUpdate({ taskId, kind, text: text.trim(), authorRole, interactionId });
              setText("");
              setKind("typed");
            })
          }
        >
          {pending ? "Saving…" : "Add update"}
        </Button>
      </div>

      {interactionId && (
        <Text size="1" color="gray">
          Recording attaches to this task. Stop when the conversation ends, then add the update.
        </Text>
      )}
    </div>
  );
}

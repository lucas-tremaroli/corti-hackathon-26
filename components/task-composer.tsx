"use client";

import { Button, SegmentedControl, Text, TextArea } from "@radix-ui/themes";
import { useState, useTransition } from "react";
import { addUpdate, startAmbient } from "@/app/actions";
import type { Role } from "@/lib/sop";
import type { UpdateKind } from "@/lib/schema";
import { Ambient } from "./ambient";
import { Dictation } from "./dictation";
import styles from "./task-composer.module.css";

type Mode = "note" | "conversation";

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
  const [mode, setMode] = useState<Mode>("note");
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
        {/* One mic, two situations. Dictation is a single speaker talking to the
            record; ambient is a room with the patient in it. */}
        <SegmentedControl.Root
          size="1"
          value={mode}
          onValueChange={(next) => {
            setMode(next as Mode);
            if (next === "conversation" && !interactionId) {
              run(async () => setInteractionId(await startAmbient(taskId, taskTitle)));
            }
          }}
        >
          <SegmentedControl.Item value="note">Note</SegmentedControl.Item>
          <SegmentedControl.Item value="conversation">Conversation</SegmentedControl.Item>
        </SegmentedControl.Root>

        {/* ponytail: one speech element per row, each minting its own token on
            upgrade. Fine at a screenful; mount it on <details> toggle if the list
            ever grows past that. */}
        {mode === "note" ? (
          <Dictation onTranscript={append("dictation")} />
        ) : (
          interactionId && (
            <Ambient interactionId={interactionId} onTranscript={append("ambient")} />
          )
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

      {mode === "conversation" && (
        <Text size="1" color="gray">
          {interactionId
            ? "Everyone in the room is transcribed, and the recording attaches to this task."
            : "Preparing the recording…"}
        </Text>
      )}
    </div>
  );
}

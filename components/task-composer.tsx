"use client";

import { Button, Callout, SegmentedControl, TextArea } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { addUpdate, startAmbient } from "@/app/actions";
import type { NoteKind } from "@/lib/model";
import type { Role } from "@/lib/sop";
import { Ambient } from "./ambient";
import { Dictation } from "./dictation";
import styles from "./task-composer.module.css";

type Mode = "note" | "conversation";

// Says what the mic is about to do, because the two modes record different
// things and the difference matters once a patient is in the room.
function explain(mode: Mode, interactionId?: string) {
  if (mode === "note") {
    return "One speaker. Dictate the comment and it lands in the box above — nothing is saved until you add it.";
  }
  return interactionId
    ? "Everyone in the room is transcribed, split by speaker, and the recording attaches to this task."
    : "Preparing the recording…";
}

export function TaskComposer({
  taskId,
  taskTitle,
  authorRole,
}: {
  taskId: string;
  taskTitle: string;
  authorRole: Role;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  // Whichever input last contributed words decides how the update is filed.
  const [kind, setKind] = useState<NoteKind>("typed");
  const [mode, setMode] = useState<Mode>("note");
  const [interactionId, setInteractionId] = useState<string>();
  const [pending, run] = useTransition();

  const append = (next: NoteKind) => (chunk: string) => {
    setKind(next);
    setText((prev) => (prev ? `${prev} ${chunk}` : chunk));
  };

  // Minting the interaction is a round trip to Corti, so do it while the user is
  // still reading the row rather than after they ask to record. Guarded by a ref
  // so a re-render can't fire off a second one.
  const starting = useRef(false);
  const ensureInteraction = useCallback(() => {
    if (starting.current) return;
    starting.current = true;
    startAmbient(taskId, taskTitle)
      .then(setInteractionId)
      .catch(() => {
        starting.current = false;
      });
  }, [taskId, taskTitle]);

  useEffect(() => {
    if (!open) return;
    // Warm the element definition too — otherwise the mic paints a chunk-load
    // after the toggle instead of with it.
    void import("@corti/ambient-web");
    ensureInteraction();
  }, [open, ensureInteraction]);

  // Closed until asked for, which also keeps the speech elements — and the
  // access token each one mints on upgrade — off every unopened row.
  if (!open) {
    return (
      <Button
        type="button"
        size="1"
        variant="ghost"
        color="gray"
        className={styles.add}
        onClick={() => setOpen(true)}
      >
        + Add comment
      </Button>
    );
  }

  return (
    <div className={styles.composer}>
      {/* Read-only on purpose: everything on this record is spoken. If the words
          came out wrong, clear them and say it again rather than quietly typing
          over what the microphone actually heard. */}
      <TextArea
        size="2"
        rows={3}
        value={text}
        readOnly
        placeholder="Say what happened. Nothing is saved until you add it."
      />

      <div className={styles.controls}>
        {/* One mic, two situations. Dictation is a single speaker talking to the
            record; ambient is a room with the patient in it. */}
        <SegmentedControl.Root
          size="1"
          value={mode}
          onValueChange={(next) => {
            setMode(next as Mode);
            // Normally already done on open; this only matters if that failed.
            if (next === "conversation" && !interactionId) ensureInteraction();
          }}
        >
          <SegmentedControl.Item value="note">Note</SegmentedControl.Item>
          <SegmentedControl.Item value="conversation">Conversation</SegmentedControl.Item>
        </SegmentedControl.Root>

        {mode === "note" ? (
          <Dictation onTranscript={append("dictation")} />
        ) : (
          interactionId && (
            <Ambient interactionId={interactionId} onTranscript={append("ambient")} />
          )
        )}

        <span className={styles.spacer} />

        {/* The only way back from a bad transcription, now that the box cannot
            be typed into. */}
        <Button
          type="button"
          size="1"
          variant="ghost"
          color="gray"
          disabled={pending || text === ""}
          onClick={() => {
            setText("");
            setKind("typed");
          }}
        >
          Clear
        </Button>

        <Button
          type="button"
          size="1"
          variant="ghost"
          color="gray"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>

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
              setMode("note");
              setOpen(false);
            })
          }
        >
          {pending ? "Saving…" : "Add comment"}
        </Button>
      </div>

      <Callout.Root size="1" color="blue" variant="soft">
        <Callout.Text>{explain(mode, interactionId)}</Callout.Text>
      </Callout.Root>
    </div>
  );
}

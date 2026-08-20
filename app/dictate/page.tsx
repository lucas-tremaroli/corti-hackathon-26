"use client";

import { useState, useTransition } from "react";
import type { Corti } from "@corti/sdk";
import { startAmbient } from "@/app/actions";
import { Ambient } from "@/components/ambient";
import { Dictation } from "@/components/dictation";

const box = { width: "100%", marginTop: "1rem" } as const;

export default function VoiceHarnessPage() {
  const [dictated, setDictated] = useState("");
  const [heard, setHeard] = useState("");
  const [facts, setFacts] = useState<Corti.StreamFact[]>([]);
  const [interactionId, setInteractionId] = useState<string>();
  const [starting, start] = useTransition();

  return (
    <main style={{ maxWidth: "40rem", margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Voice harness</h1>
      <p>Scratch page for FORK-29 and FORK-30. Folds into the task detail thread once that exists.</p>

      <h2>Dictation</h2>
      <Dictation onTranscript={(t) => setDictated((prev) => `${prev}${t} `)} />
      <textarea
        value={dictated}
        onChange={(e) => setDictated(e.target.value)}
        rows={6}
        style={box}
        placeholder="Dictated text appears here…"
      />

      <h2>Ambient</h2>
      {interactionId ? (
        <Ambient
          interactionId={interactionId}
          onTranscript={(t) => setHeard((prev) => `${prev}${t} `)}
          onFacts={setFacts}
        />
      ) : (
        <button
          type="button"
          disabled={starting}
          onClick={() => start(async () => setInteractionId(await startAmbient("harness", "Voice harness")))}
        >
          {starting ? "Creating interaction…" : "Start ambient session"}
        </button>
      )}
      <textarea value={heard} readOnly rows={6} style={box} placeholder="Conversation appears here…" />
      <ul>
        {facts.map((f) => (
          <li key={f.id}>
            <strong>{f.group}</strong> {f.text}
          </li>
        ))}
      </ul>
    </main>
  );
}

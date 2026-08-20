"use client";

import { useEffect, useRef } from "react";
import type { CortiAmbient } from "@corti/ambient-web";
import type { Corti } from "@corti/sdk";
import { refreshAccessToken } from "./corti-auth";

export function Ambient({
  interactionId,
  onTranscript,
  onFacts,
}: {
  interactionId: string;
  onTranscript: (text: string) => void;
  onFacts?: (facts: Corti.StreamFact[]) => void;
}) {
  const ref = useRef<CortiAmbient>(null);
  const callbacks = useRef({ onTranscript, onFacts });

  useEffect(() => {
    callbacks.current = { onTranscript, onFacts };
  });

  useEffect(() => {
    import("@corti/ambient-web");
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ready = () => {
      el.authConfig = { refreshAccessToken };
    };
    const transcript = (event: Event) => {
      const { data } = (event as CustomEvent<Corti.StreamTranscriptMessage>).detail;
      // Multi-speaker, so a message can carry several segments. Interim ones are
      // replaced as the stream firms up — only finals are worth keeping.
      const text = data
        .filter((s) => s.final)
        .map((s) => s.transcript)
        .join(" ");
      if (text) callbacks.current.onTranscript(text);
    };
    const facts = (event: Event) => {
      const { fact } = (event as CustomEvent<Corti.StreamFactsMessage>).detail;
      callbacks.current.onFacts?.(fact.filter((f) => !f.isDiscarded));
    };

    // Lit keeps properties set before upgrade, so doing both covers the element
    // being already upgraded and it upgrading later.
    ready();
    el.addEventListener("ready", ready);
    el.addEventListener("transcript", transcript);
    el.addEventListener("facts", facts);
    return () => {
      el.removeEventListener("ready", ready);
      el.removeEventListener("transcript", transcript);
      el.removeEventListener("facts", facts);
    };
  }, []);

  // Default config is already what we want: facts mode, diarization on.
  return <corti-ambient ref={ref} interactionId={interactionId} />;
}

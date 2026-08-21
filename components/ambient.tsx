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
  // speakerId is -1 when diarization is off. Callers that only want the words
  // can ignore it; the ones building a two-voice transcript cannot.
  onTranscript: (text: string, speakerId: number) => void;
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
      // Multi-speaker, so a message can carry several segments, and they can be
      // different people. Handing them over one at a time keeps the diarization
      // Corti did for us — flattening them into one string throws away who spoke,
      // and who spoke is what makes a deflected question legible as one.
      // Interim segments are replaced as the stream firms up; only finals count.
      for (const segment of data) {
        if (segment.final && segment.transcript) {
          callbacks.current.onTranscript(segment.transcript, segment.speakerId);
        }
      }
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

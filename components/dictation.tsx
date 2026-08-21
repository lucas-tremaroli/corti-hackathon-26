"use client";

import { useEffect, useRef } from "react";
import type {
  CortiDictation,
  RecordingState,
  RecordingStateChangedEventDetail,
} from "@corti/dictation-web";
import { refreshAccessToken } from "./corti-auth";

/**
 * The microphone, and the two things it knows: what was said, and whether it is
 * listening.
 *
 * The recording state was already being dispatched and thrown away, so the only
 * way to tell the mic was open was that a word had come back from it — which is
 * a report on the past, not on the microphone.
 */
export function Dictation({
  onTranscript,
  onState,
}: {
  onTranscript: (text: string) => void;
  onState?: (state: RecordingState) => void;
}) {
  const ref = useRef<CortiDictation>(null);
  const callbacks = useRef({ onTranscript, onState });

  useEffect(() => {
    callbacks.current = { onTranscript, onState };
  });

  useEffect(() => {
    import("@corti/dictation-web");
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ready = () => {
      el.authConfig = { refreshAccessToken };
    };
    const transcript = (event: Event) => {
      const { data } = (event as CustomEvent).detail;
      if (data.isFinal) callbacks.current.onTranscript(data.text);
    };
    const state = (event: Event) => {
      const { state } = (event as CustomEvent<RecordingStateChangedEventDetail>).detail;
      callbacks.current.onState?.(state);
    };
    // Lit keeps properties set before upgrade, so doing both covers the element
    // being already upgraded and it upgrading later.
    ready();
    el.addEventListener("ready", ready);
    el.addEventListener("transcript", transcript);
    el.addEventListener("recording-state-changed", state);
    return () => {
      el.removeEventListener("ready", ready);
      el.removeEventListener("transcript", transcript);
      el.removeEventListener("recording-state-changed", state);
    };
  }, []);

  return <corti-dictation ref={ref} />;
}

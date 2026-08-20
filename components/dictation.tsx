"use client";

import { useEffect, useRef } from "react";
import type { CortiDictation } from "@corti/dictation-web";
import { refreshAccessToken } from "./corti-auth";

export function Dictation({ onTranscript }: { onTranscript: (text: string) => void }) {
  const ref = useRef<CortiDictation>(null);
  const callback = useRef(onTranscript);

  useEffect(() => {
    callback.current = onTranscript;
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
      if (data.isFinal) callback.current(data.text);
    };

    // Lit keeps properties set before upgrade, so doing both covers the element
    // being already upgraded and it upgrading later.
    ready();
    el.addEventListener("ready", ready);
    el.addEventListener("transcript", transcript);
    return () => {
      el.removeEventListener("ready", ready);
      el.removeEventListener("transcript", transcript);
    };
  }, []);

  return <corti-dictation ref={ref} />;
}

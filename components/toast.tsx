"use client";

import { Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import styles from "./toast.module.css";

type Toast = {
  id: number;
  tone: "neutral" | "error";
  text: string;
  // What the message is about, listed, and what to do next.
  items?: string[];
  hint?: string;
};

// Fired from anywhere, rendered once in the shell: a task that closes leaves
// the board, so its row unmounts before it could say anything.
export function toast(message: Omit<Toast, "id">) {
  window.dispatchEvent(
    new CustomEvent("careos:toast", { detail: { ...message, id: Date.now() } }),
  );
}

export function Toasts() {
  const [items, setItems] = useState<Toast[]>([]);
  const dismiss = (id: number) => setItems((prev) => prev.filter((t) => t.id !== id));

  useEffect(() => {
    const onToast = (event: Event) => {
      const item = (event as CustomEvent<Toast>).detail;
      setItems((prev) => [...prev, item]);
      setTimeout(() => dismiss(item.id), 8000);
    };
    window.addEventListener("careos:toast", onToast);
    return () => window.removeEventListener("careos:toast", onToast);
  }, []);

  if (items.length === 0) return null;

  return (
    <div className={styles.stack}>
      {items.map((item) => (
        <div
          key={item.id}
          className={`${styles.toast} ${item.tone === "error" ? styles.error : ""}`}
          role={item.tone === "error" ? "alert" : "status"}
        >
          <div className={styles.content}>
            <Text as="p" size="2">
              {item.text}
            </Text>

            {item.items && (
              <ul className={styles.items}>
                {item.items.map((line) => (
                  <li key={line}>
                    <Text size="2">{line}</Text>
                  </li>
                ))}
              </ul>
            )}

            {item.hint && (
              <Text as="p" size="2" className={styles.hint}>
                {item.hint}
              </Text>
            )}
          </div>
          <button
            type="button"
            className={styles.dismiss}
            aria-label="Dismiss"
            onClick={() => dismiss(item.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

"use client";

import { Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import styles from "./toast.module.css";

type Toast = { id: number; text: string; tone: "neutral" | "error" };

// Fired from anywhere, rendered once in the shell: a task that closes leaves
// the board, so its row unmounts before it could say anything.
export function toast(text: string, tone: Toast["tone"] = "neutral") {
  window.dispatchEvent(
    new CustomEvent("careos:toast", { detail: { id: Date.now(), text, tone } }),
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
          <Text size="2">{item.text}</Text>
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

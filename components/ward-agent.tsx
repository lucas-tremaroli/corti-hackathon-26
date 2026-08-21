"use client";

import { Button, Text } from "@radix-ui/themes";
import { useState, useTransition } from "react";
import { askWardAgent } from "@/app/actions";
import styles from "./ward-agent.module.css";

// Three questions worth one click, because a blank box is the hardest thing to
// answer. They are also the three the board can always speak to.
const OPENERS = [
  "What is unattended right now?",
  "Which tasks are overdue, and who owns them?",
  "Is anyone on an anticoagulant?",
];

/**
 * The agent writes in paragraphs and dashed lists — the handoff summaries come
 * back that way every time — so both survive to the screen. Anything else is a
 * paragraph, which is the safe reading of a line we do not recognise.
 */
function blocks(answer: string) {
  return answer.split(/\n{2,}/).map((block) => {
    const lines = block.split("\n").map((line) => line.trim());
    const bullets = lines.filter((line) => /^[-*•]\s+/.test(line));
    return bullets.length === lines.length
      ? { kind: "list" as const, lines: bullets.map((line) => line.replace(/^[-*•]\s+/, "")) }
      : { kind: "text" as const, text: lines.join(" ") };
  });
}

/**
 * It also emits **bold** to head its bullets — "**Overdue:** Neuro obs hourly" —
 * and asterisks on screen read as a bug in the app rather than emphasis from the
 * writer. This is the whole of the markdown we honour: what the agent actually
 * sends, not a parser for what it might.
 */
function emphasise(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, index) =>
    // Odd indices are what sat inside the asterisks — String.split with one
    // capture group alternates plain, captured, plain.
    index % 2 === 1 ? (
      // biome-ignore lint: position in a split string is the only identity here
      <strong key={index}>{part}</strong>
    ) : (
      part
    ),
  );
}

export function WardAgent() {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [pending, run] = useTransition();

  const ask = (text: string) => {
    if (!text.trim() || pending) return;
    // The question moves out of the box and above the answer the moment it is
    // sent, so a slow reply never leaves you wondering what you asked.
    setAsked(text);
    setQuestion("");
    setAnswer("");
    setError("");
    run(async () => {
      try {
        setAnswer(await askWardAgent(text));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  };

  return (
    <div className={styles.panel}>
      <form
        className={styles.ask}
        onSubmit={(event) => {
          event.preventDefault();
          ask(question);
        }}
      >
        <textarea
          className={styles.field}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about the board…"
          rows={3}
          disabled={pending}
          aria-label="Your question about the board"
          // Enter sends: this is a question box, not a document.
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              ask(question);
            }
          }}
        />
        <div className={styles.actions}>
          <Text size="1" className={styles.hint}>
            Enter to ask · Shift-Enter for a new line
          </Text>
          <Button type="submit" size="2" disabled={pending || !question.trim()}>
            {pending ? "Asking…" : "Ask"}
          </Button>
        </div>
      </form>

      <div className={styles.openers}>
        <Text size="1" className={styles.openersLabel}>
          Or start here
        </Text>
        <div className={styles.openerRow}>
          {OPENERS.map((opener) => (
            <button
              key={opener}
              type="button"
              className={styles.opener}
              disabled={pending}
              onClick={() => ask(opener)}
            >
              {opener}
            </button>
          ))}
        </div>
      </div>

      {asked && (
        <div className={styles.exchange}>
          <div className={styles.asked}>
            <Text size="1" className={styles.askedLabel}>
              Asked
            </Text>
            <Text as="p" size="2" className={styles.question}>
              {asked}
            </Text>
          </div>

          {pending && (
            <div className={styles.working}>
              <span className={styles.dot} aria-hidden />
              <Text size="1" className={styles.workingLabel}>
                Reading the board
              </Text>
            </div>
          )}

          {error && (
            <Text as="p" size="2" className={styles.error}>
              {error}
            </Text>
          )}

          {answer && (
            <div className={styles.answer} aria-live="polite">
              {blocks(answer).map((block, index) =>
                block.kind === "list" ? (
                  // biome-ignore lint: an answer is read top to bottom, position is identity
                  <ul key={index}>
                    {block.lines.map((line) => (
                      <li key={line}>
                        <Text size="2">{emphasise(line)}</Text>
                      </li>
                    ))}
                  </ul>
                ) : (
                  // biome-ignore lint: same
                  <Text as="p" size="2" key={index}>
                    {emphasise(block.text)}
                  </Text>
                ),
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { Button, Text } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import {
  commitHandoff,
  draftHandoff,
  loadDemoTranscript,
  readCodes,
  readFacts,
  readIntent,
  readSteps,
} from "@/app/actions";
import type { Request, Sbar as SbarValue } from "@/lib/handoff";
import type { Clinician, Patient } from "@/lib/model";
import type { StepVerdict } from "@/lib/sop";
import { Dictation } from "./dictation";
import { Sbar } from "./sbar";
import { toast } from "./toast";
import styles from "./handoff-console.module.css";

type Fact = { text: string; group?: string };

type Entry = {
  id: string;
  label: string;
  detail?: string;
  items?: string[];
  state: "running" | "done";
};

/** What the run has gathered so far. Nothing here is in the graph yet. */
type Draft = {
  facts: Fact[];
  codes: string[];
  verdicts: StepVerdict[];
  requests: Request[];
  sbar: SbarValue;
  recipientId: string | null;
};

/**
 * Each step's answer, kept as it lands. Corti fails often enough that losing four
 * good steps because the fifth 500s is not acceptable — a retry picks up where it
 * stopped rather than spending another half minute redoing work that worked.
 */
type Progress = {
  facts?: Fact[];
  codes?: string[];
  verdicts?: StepVerdict[];
  intent?: { recipientId: string | null; quote: string; requests: Request[] };
};

export function HandoffConsole({
  patients,
  clinicians,
  me,
}: {
  patients: Patient[];
  clinicians: Clinician[];
  me: Clinician;
}) {
  const [patientId, setPatientId] = useState(patients[0]?.id ?? "");
  const [transcript, setTranscript] = useState("");
  const [dictating, setDictating] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const [recipientId, setRecipientId] = useState("");
  const [busy, setBusy] = useState(false);

  // Set when Stop is pressed. Checked after every await, so the sequence halts
  // between steps — the Corti call already in flight cannot be recalled, but its
  // answer is thrown away and nothing after it runs.
  const cancelled = useRef(false);
  const foot = useRef<HTMLDivElement>(null);

  // The feed grows downward, so the newest thing is always what you are looking at.
  useEffect(() => {
    foot.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  const others = clinicians.filter((c) => c.id !== me.id);
  const patient = patients.find((p) => p.id === patientId);
  const words = transcript.trim() === "" ? 0 : transcript.trim().split(/\s+/).length;

  function begin(label: string) {
    const id = crypto.randomUUID();
    setEntries((prev) => [...prev, { id, label, state: "running" }]);
    return (detail?: string, items?: string[]) =>
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, detail, items, state: "done" } : e)),
      );
  }

  function note(label: string, detail?: string) {
    setEntries((prev) => [...prev, { id: crypto.randomUUID(), label, detail, state: "done" }]);
  }

  function reset() {
    setEntries([]);
    setTranscript("");
    setDraft(null);
    setProgress({});
    setRecipientId("");
    cancelled.current = false;
  }

  async function analyse() {
    cancelled.current = false;
    setBusy(true);
    const stop = () => cancelled.current;
    const stopped = () => note("Stopped", "Nothing was written.");

    // Anything already answered is carried in rather than asked again.
    let { facts, codes, verdicts, intent } = progress;

    try {
      if (!facts) {
        const done = begin("Extracting facts");
        facts = await readFacts(transcript);
        if (stop()) return stopped();
        done(`${facts.length} facts`, facts.map((f) => f.text));
        setProgress((p) => ({ ...p, facts }));
      }

      if (!codes) {
        const done = begin("Medical coding");
        const result = await readCodes(transcript);
        if (stop()) return stopped();
        if (!result.protocol) throw new Error("No protocol matches the codes for this conversation.");
        done(
          result.protocol.name,
          result.codes.map((c) => `${c.system} · ${c.code} · ${c.display}`),
        );
        codes = result.codes.map((c) => c.code);
        setProgress((p) => ({ ...p, codes }));
      }

      if (!verdicts) {
        const done = begin("Checking the protocol");
        verdicts = await readSteps(codes, facts);
        if (stop()) return stopped();
        const gapCount = verdicts.filter((v) => v.status === "gap").length;
        done(
          `${verdicts.length - gapCount} covered, ${gapCount} not arranged`,
          verdicts.map((v) => `${v.status === "gap" ? "○" : "●"} ${v.id}`),
        );
        setProgress((p) => ({ ...p, verdicts }));
      }

      if (!intent) {
        const done = begin("Reading who this is for");
        intent = await readIntent(transcript);
        if (stop()) return stopped();
        const to = clinicians.find((c) => c.id === intent?.recipientId);
        done(to ? `${to.name} · ${to.org}` : "Nobody named — choose a recipient below", [
          ...(intent.quote ? [`“${intent.quote}”`] : []),
          ...intent.requests.map((r) => `asked for: ${r.title} (${r.dueInDays} days)`),
        ]);
        setProgress((p) => ({ ...p, intent }));
      }

      const done = begin("Drafting the handoff");
      const sbar = await draftHandoff({
        patientId,
        codes,
        facts,
        gapStepIds: verdicts.filter((v) => v.status === "gap").map((v) => v.id),
      });
      if (stop()) return stopped();
      done("SBAR ready to approve");

      setDraft({
        facts,
        codes,
        verdicts,
        requests: intent.requests,
        sbar,
        recipientId: intent.recipientId,
      });
      setRecipientId(intent.recipientId ?? "");
    } catch (error) {
      const message = (error as Error).message;
      note("Failed", `${message} — Retry picks up from here.`);
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!draft || recipientId === "") return;
    setBusy(true);
    try {
      await commitHandoff({
        patientId,
        transcript,
        facts: draft.facts,
        codes: draft.codes,
        verdicts: draft.verdicts,
        requests: draft.requests,
        sbar: draft.sbar,
        recipientId,
      });
      const to = clinicians.find((c) => c.id === recipientId);
      toast(`Handed to ${to?.name ?? "them"}.`);
      reset();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const idle = entries.length === 0 && transcript === "";

  return (
    <div className={styles.console}>
      <div className={styles.stage} data-idle={idle}>
        <label className={styles.patient}>
          <Text size="1" className={styles.patientLabel}>
            Patient
          </Text>
          <select
            className={styles.select}
            value={patientId}
            disabled={busy || dictating || entries.length > 0}
            onChange={(event) => setPatientId(event.target.value)}
          >
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <div className={styles.mic} data-live={dictating}>
          <Dictation
            onTranscript={(text) => {
              setDictating(true);
              setTranscript((prev) => (prev ? `${prev} ${text}` : text));
            }}
          />
        </div>

        <Text size="2" color="gray" className={styles.hint}>
          {idle
            ? `Dictate the handoff for ${patient?.name ?? "this patient"}.`
            : `${words} words dictated.`}
        </Text>

        {idle && (
          <Button
            type="button"
            size="1"
            variant="ghost"
            color="gray"
            disabled={busy}
            onClick={() =>
              loadDemoTranscript()
                .then((text) => {
                  setTranscript(text);
                  note("Loaded the conversation on file", `${text.trim().split(/\s+/).length} words`);
                })
                .catch((error: Error) => toast(error.message, "error"))
            }
          >
            or use the conversation on file
          </Button>
        )}
      </div>

      {/* The feed. Newest at the bottom, and it only ever grows until a handoff
          is sent — at which point the whole thing goes and the next one starts
          from an empty screen. */}
      {!idle && (
        <ol className={styles.feed}>
          {transcript !== "" && (
            <li className={styles.entry}>
              <div className={styles.entryHead}>
                <span className={styles.dot} data-state="done" aria-hidden />
                <Text size="2" weight="medium">
                  Dictated
                </Text>
                <Text size="1" color="gray">
                  {words} words
                </Text>
              </div>
              <pre className={styles.transcript}>{transcript}</pre>
            </li>
          )}

          {entries.map((entry) => (
            <li key={entry.id} className={styles.entry}>
              <div className={styles.entryHead}>
                <span className={styles.dot} data-state={entry.state} aria-hidden />
                <Text size="2" weight="medium">
                  {entry.label}
                </Text>
                {entry.detail && (
                  <Text size="1" color="gray">
                    {entry.detail}
                  </Text>
                )}
              </div>
              {entry.items && entry.items.length > 0 && (
                <ul className={styles.items}>
                  {entry.items.map((item) => (
                    <li key={item}>
                      <Text size="1" color="gray">
                        {item}
                      </Text>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}

          {draft && (
            <li className={styles.draft}>
              <Sbar sbar={draft.sbar} missing="Nothing drafted" />
            </li>
          )}

          <div ref={foot} />
        </ol>
      )}

      {!idle && (
        <div className={styles.actions}>
          {busy ? (
            <Button
              type="button"
              size="2"
              variant="surface"
              color="gray"
              onClick={() => {
                cancelled.current = true;
              }}
            >
              Stop
            </Button>
          ) : draft ? (
            <>
              <label className={styles.recipient}>
                <Text size="1" className={styles.patientLabel}>
                  Hand to
                </Text>
                <select
                  className={styles.select}
                  value={recipientId}
                  onChange={(event) => setRecipientId(event.target.value)}
                >
                  <option value="">Choose a clinician…</option>
                  {others.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.org}
                    </option>
                  ))}
                </select>
              </label>
              <span className={styles.spacer} />
              <Button type="button" size="2" variant="ghost" color="gray" onClick={reset}>
                Discard
              </Button>
              <Button
                type="button"
                size="2"
                variant="surface"
                color="gray"
                disabled={recipientId === ""}
                onClick={approve}
              >
                Approve and send
              </Button>
            </>
          ) : (
            <>
              <span className={styles.spacer} />
              <Button type="button" size="2" variant="ghost" color="gray" onClick={reset}>
                Discard
              </Button>
              <Button
                type="button"
                size="2"
                variant="surface"
                color="gray"
                disabled={transcript.trim() === ""}
                onClick={analyse}
              >
                {/* Retry resumes; it does not start over. */}
                {Object.keys(progress).length > 0 ? "Retry" : "Analyse"}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

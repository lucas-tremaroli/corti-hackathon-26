"use client";

import { Button, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  commitHandoff,
  draftHandoff,
  loadDemoTranscript,
  readCodes,
  readFacts,
  readIntent,
  readSteps,
} from "@/app/actions";
import type { Intent, Request, Sbar as SbarValue } from "@/lib/handoff";
import type { Clinician, Patient } from "@/lib/model";
import type { StepVerdict } from "@/lib/sop";
import { Dictation } from "./dictation";
import { NewPatient } from "./new-patient";
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
  /** Corti can take a minute on one step. A counter is the difference between
      waiting and assuming it has died. */
  startedAt: number;
  tookMs?: number;
};

/**
 * The run, in the order analyse() performs it. Drawn in full from the moment
 * there is anything to analyse, so what is still to come is on screen next to
 * what has already landed — a run that stops at step three then reads as three
 * of five rather than as three things that happened.
 *
 * The label is the join: begin() writes it onto the entry, and the row finds its
 * entry by matching it. Anything not on this list — Failed, Stopped — is not a
 * step and is drawn after them.
 */
const STEPS = [
  "Extracting facts",
  "Medical coding",
  "Checking the protocol",
  "Reading who this is about",
  "Drafting the handoff",
] as const;

/**
 * The wall clock in whole seconds, ticking only while something is in flight so
 * an idle console is not repainting once a second for nothing.
 *
 * useSyncExternalStore rather than state and an effect: the clock is an external
 * source, and this is the API for reading one without calling Date.now() during
 * render. Flooring to seconds keeps the snapshot stable between ticks, which is
 * what stops React from re-rendering in a loop.
 */
function useClock(active: boolean) {
  const subscribe = useCallback(
    (onTick: () => void) => {
      if (!active) return () => {};
      const id = setInterval(onTick, 1000);
      return () => clearInterval(id);
    },
    [active],
  );

  return useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / 1000),
    () => 0,
  );
}

/** What the run has gathered so far. Nothing here is in the graph yet. */
type Draft = {
  facts: Fact[];
  codes: string[];
  verdicts: StepVerdict[];
  requests: Request[];
  sbar: SbarValue;
  recipientId: string | null;
  /** As dictated. What a new record gets called when nobody on the roster matched. */
  patientName: string;
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
  intent?: Intent;
};

export function HandoffConsole({
  patients: seeded,
  clinicians,
  me,
}: {
  patients: Patient[];
  clinicians: Clinician[];
  me: Clinician;
}) {
  // The roster grows on this screen. A patient created mid-run has to be
  // selectable straight away, and the server component that supplied the list
  // will not re-render underneath us.
  const [added, setAdded] = useState<Patient[]>([]);
  const patients = [...seeded, ...added].sort((a, b) => a.name.localeCompare(b.name));
  // Empty until the dictation says who this is about. Nobody picks a patient
  // before speaking — you say the name, the way you would to a colleague.
  const [patientId, setPatientId] = useState("");
  const [transcript, setTranscript] = useState("");
  // Spoken, or read off disk for the demo. It labels the transcript rather than
  // being announced in the feed: how the words arrived is a property of them.
  const [source, setSource] = useState<"spoken" | "file">("spoken");
  const [recording, setRecording] = useState(false);
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

  // The feed grows downward, so the newest thing is always what you are looking
  // at. Keyed to what has landed rather than to mount: the point is to follow
  // the run, and a run takes half a minute.
  useEffect(() => {
    if (entries.length === 0) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    foot.current?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "end" });
  }, [entries.length, draft]);

  const running = entries.some((entry) => entry.state === "running");
  const nowSeconds = useClock(running);

  const others = clinicians.filter((c) => c.id !== me.id);
  const words = transcript.trim() === "" ? 0 : transcript.trim().split(/\s+/).length;

  // The clock is read inside the updaters rather than in the body: these run
  // during React's state processing, where reading it is honest, instead of
  // during render, where it is not.
  function begin(label: string) {
    const id = crypto.randomUUID();
    setEntries((prev) => [...prev, { id, label, state: "running", startedAt: Date.now() }]);
    return (detail?: string, items?: string[]) =>
      setEntries((prev) =>
        prev.map((e) =>
          e.id === id
            ? { ...e, detail, items, state: "done", tookMs: Date.now() - e.startedAt }
            : e,
        ),
      );
  }

  function note(label: string, detail?: string) {
    setEntries((prev) => [
      ...prev,
      { id: crypto.randomUUID(), label, detail, state: "done", startedAt: Date.now() },
    ]);
  }

  function reset() {
    setEntries([]);
    setTranscript("");
    setSource("spoken");
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
        const done = begin("Reading who this is about");
        intent = await readIntent(transcript);
        if (stop()) return stopped();
        const to = clinicians.find((c) => c.id === intent?.recipientId);
        const about = patients.find((p) => p.id === intent?.patientId);
        const named = intent.patientName;
        done(
          about
            ? about.name
            : named !== ""
              ? `“${named}” — nobody on the roster, add them below`
              : "No patient named — choose one below",
          [
            to ? `handed to ${to.name} · ${to.org}` : "nobody named — choose a recipient below",
            ...(intent.quote ? [`“${intent.quote}”`] : []),
            ...intent.requests.map((r) => `asked for: ${r.title} (${r.dueInDays} days)`),
          ],
        );
        setProgress((p) => ({ ...p, intent }));
        // Only on a fresh reading: a correction made by hand survives Retry.
        setPatientId(intent.patientId ?? "");
      }

      const done = begin("Drafting the handoff");
      const sbar = await draftHandoff({
        // The reading, not the state — setPatientId above has not flushed yet.
        patientId: intent.patientId,
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
        patientName: intent.patientName,
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
      {/* The mic never moves off the centre axis. Idle it is the whole screen;
          once there is a run it shrinks and pins to the top, so another sentence
          is always one press away however far the feed has scrolled. */}
      <div className={styles.stage} data-idle={idle}>
        <div className={styles.mic} data-live={recording}>
          <Dictation
            onTranscript={(text) => setTranscript((prev) => (prev ? `${prev} ${text}` : text))}
            onState={(state) => {
              setRecording(state === "recording");
              if (state === "recording") setSource("spoken");
            }}
          />
        </div>

        {/* One line under the mic, whichever line is true. An open microphone
            outranks everything else it could say. */}
        {recording ? (
          <Text size="1" className={styles.status}>
            Listening
          </Text>
        ) : idle ? (
          <Text size="2" color="gray" className={styles.hint}>
            Dictate the handoff. Say who it is about.
          </Text>
        ) : (
          <Text size="1" className={styles.status}>
            {words} words
          </Text>
        )}

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
                  setSource("file");
                })
                .catch((error: Error) => toast(error.message, "error"))
            }
          >
            or use the dictation on file
          </Button>
        )}
      </div>

      {/* The feed. The dictation at the top, the five steps under it whether or
          not they have run yet, then whatever the run had to say for itself. It
          only ever grows until a handoff is sent — at which point the whole
          thing goes and the next one starts from an empty screen. */}
      {!idle && (
        <div className={styles.feed}>
          {transcript !== "" && (
            <section className={styles.said}>
              <Text size="1" className={styles.saidLabel}>
                {source === "file" ? "On file" : "Dictated"} · {words} words
              </Text>
              <pre className={styles.transcript}>{transcript}</pre>
            </section>
          )}

          <ol className={styles.steps}>
            {STEPS.map((label) => {
              // Last wins: Drafting runs again on every retry, and the newest
              // answer is the one on screen.
              const entry = entries.findLast((e) => e.label === label);
              const state = entry?.state ?? "pending";

              return (
                <li key={label} className={styles.step} data-state={state}>
                  <span className={styles.dot} data-state={state} aria-hidden />
                  <Text size="1" className={styles.stepLabel}>
                    {label}
                  </Text>
                  {/* Counts up while it runs, then settles on what it cost. */}
                  <Text size="1" className={styles.elapsed}>
                    {state === "running"
                      ? `${Math.max(0, nowSeconds - Math.floor(entry!.startedAt / 1000))}s`
                      : entry?.tookMs !== undefined
                        ? `${Math.round(entry.tookMs / 1000)}s`
                        : ""}
                  </Text>
                  {entry?.detail && (
                    <Text size="2" className={styles.detail}>
                      {entry.detail}
                    </Text>
                  )}
                  {entry?.items && entry.items.length > 0 && (
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
              );
            })}
          </ol>

          {/* Not steps: how the run ended, when it did not end in a draft. */}
          {entries
            .filter((entry) => !STEPS.includes(entry.label as (typeof STEPS)[number]))
            .map((entry) => (
              <p key={entry.id} className={styles.note}>
                <Text size="2" weight="medium">
                  {entry.label}
                </Text>{" "}
                <Text size="2" color="gray">
                  {entry.detail}
                </Text>
              </p>
            ))}

          {draft && (
            <div className={styles.draft}>
              <Sbar sbar={draft.sbar} missing="Nothing drafted" />

              {/* Both read out of the dictation, both correctable, and neither
                  optional — a handoff filed against the wrong patient is worse
                  than one that was never sent. They sit with the draft they
                  route, not down in the button bar. */}
              <div className={styles.routing}>
                <label className={styles.field}>
                  <Text size="1" className={styles.fieldLabel}>
                    About
                  </Text>
                  <select
                    className={styles.select}
                    value={patientId}
                    onChange={(event) => setPatientId(event.target.value)}
                  >
                    <option value="">Choose a patient…</option>
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.field}>
                  <Text size="1" className={styles.fieldLabel}>
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

                {/* Only when the reading matched nobody. With a patient already
                    settled there is nothing to create, and offering it anyway is
                    how duplicate charts get made. */}
                {patientId === "" && (
                  <NewPatient
                    heardName={draft.patientName}
                    patients={patients}
                    onChose={(patient) => {
                      setAdded((prev) =>
                        prev.some((p) => p.id === patient.id) ? prev : [...prev, patient],
                      );
                      setPatientId(patient.id);
                    }}
                  />
                )}
              </div>
            </div>
          )}

          <div ref={foot} />
        </div>
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
              <span className={styles.spacer} />
              <Button type="button" size="2" variant="ghost" color="gray" onClick={reset}>
                Discard
              </Button>
              <Button
                type="button"
                size="2"
                variant="surface"
                color="gray"
                disabled={recipientId === "" || patientId === ""}
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

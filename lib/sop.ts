import { chat } from "./corti";

export type Role = "Cardiology" | "GP" | "Imaging";

export const ROLES: Record<Role, { short: string; long: string }> = {
  Cardiology: { short: "Cardiology", long: "Cardiology" },
  GP: { short: "GP", long: "Primary care" },
  Imaging: { short: "Imaging", long: "Imaging" },
};

export type SopStep = {
  id: string;
  title: string;
  role: Role;
  dueInDays: number;
  trigger: string;
  // What has to be true before the step can be closed. Written so someone
  // reading the comments on the task can tell whether it happened.
  closes: string[];
};

// Illustrative, not a validated clinical guideline. Say so on stage.
//
// The steps describe the edges that should exist after this discharge: which
// kind of fact ought to reach which role, and by when. Reality is the edges that
// do exist, and the diff is the product.
export const NEW_AF_DISCHARGE = {
  id: "new-af-discharge",
  name: "New-onset atrial fibrillation, discharge",
  // Matched against every system Corti codes in, not just ICD-10. On this
  // conversation ICD-10 lands on I49.9, "arrhythmia, unspecified", while SNOMED
  // names atrial fibrillation outright — so the specific code is the one that
  // picks the protocol, whichever system it came from.
  selectedBy: ["I48", "49436004"],
  steps: [
    {
      id: "anticoagulation-decision",
      title: "Anticoagulation decision",
      role: "Cardiology",
      dueInDays: 7,
      trigger:
        "Confirmed atrial fibrillation with a stroke risk score that warrants anticoagulation, or an anticoagulation decision left open.",
      closes: [
        "A decision is recorded: an anticoagulant was started, or a reason not to start it was written down.",
        "If it was started, the drug and dose are named. If it was not, the date it will be revisited is named.",
      ],
    },
    {
      id: "bleeding-risk-bloods",
      title: "Baseline bloods before anticoagulation",
      role: "GP",
      dueInDays: 7,
      trigger: "Anticoagulation is being considered or has been started.",
      closes: [
        "Renal function and a full blood count were taken and the results are recorded.",
        "Any result that changes the anticoagulant choice or dose has a decision against it.",
      ],
    },
    {
      id: "rate-control-review",
      title: "Rate control review",
      role: "GP",
      dueInDays: 14,
      trigger: "A rate-control medicine was started or changed at discharge.",
      closes: [
        "The heart rate was measured after discharge and the reading is recorded.",
        "The dose was continued, changed or stopped, and which one is recorded.",
      ],
    },
    {
      id: "echocardiogram",
      title: "Echocardiogram",
      role: "Imaging",
      dueInDays: 21,
      trigger: "Newly diagnosed atrial fibrillation without a recent echocardiogram.",
      closes: [
        "The scan was performed and the report is back.",
        "Someone has read it and recorded what it changes, or that it changes nothing.",
      ],
    },
    {
      id: "rhythm-monitoring",
      title: "Rhythm monitoring review",
      role: "Cardiology",
      dueInDays: 21,
      trigger: "Ambulatory rhythm monitoring was arranged or is pending.",
      closes: [
        "The monitor was worn and the recording has been reported.",
        "The burden of atrial fibrillation it showed is recorded, with what follows from it.",
      ],
    },
  ] satisfies SopStep[],
};

const PROTOCOLS = [NEW_AF_DISCHARGE];

export function sopForCodes(codes: string[]) {
  return (
    PROTOCOLS.find((sop) =>
      codes.some((code) => sop.selectedBy.some((prefix) => code.startsWith(prefix))),
    ) ?? null
  );
}

// ponytail: step ids are unique across protocols, so the id alone still finds
// one. Take the sop id too if that ever stops being true.
export const sopStep = (stepId: string | null) =>
  PROTOCOLS.flatMap((sop) => sop.steps).find((s) => s.id === stepId) ?? null;

export type ClosureCheck = { text: string; met: boolean; evidence: string };
export type Closure = { criteria: ClosureCheck[]; missing: string };

// The protocol says what closing a step means; the comments on the task are the
// only record of what was actually done. This reads one against the other.
export async function checkClosure(step: SopStep, comments: string[]): Promise<Closure> {
  // An empty thread can't satisfy anything, and asking costs a round trip.
  if (comments.length === 0) {
    return {
      criteria: step.closes.map((text) => ({ text, met: false, evidence: "" })),
      missing: "Nothing has been recorded on this task yet.",
    };
  }

  const raw = await chat<{
    criteria?: { index?: number; met?: boolean; evidence?: string }[];
    missing?: string;
  }>(
    `You are checking whether the notes recorded on a care task show that it can be closed.

Task: ${step.title}

Completion criteria:
${JSON.stringify(step.closes.map((text, index) => ({ index, text })), null, 2)}

Notes recorded on this task, oldest first:
${JSON.stringify(comments)}

A criterion is met only if a note says the thing was actually done, measured or decided. An intention, a plan to do it later, or a note that only names the problem does not meet it.

Quote the supporting note verbatim as evidence for met criteria, and use an empty string otherwise.

Also write "missing": one sentence of at most twenty words telling the clinician what to write next. Speak to the distance between what the notes already say and what actually has to have happened, in this patient's own specifics. The criteria are on screen beside your sentence, so do not restate, paraphrase, list or count them, and do not open with "Please". If every criterion is met, use an empty string.

Return JSON: {"criteria":[{"index","met","evidence"}],"missing":""}`,
  );

  const criteria = step.closes.map((text, index) => {
    const verdict = raw.criteria?.find((c) => c.index === index);
    const evidence = typeof verdict?.evidence === "string" ? verdict.evidence : "";
    // "met" with nothing to quote is the model being agreeable, and unmet is the
    // safe default: it asks for another note, where the opposite closes care
    // that never happened.
    return { text, met: verdict?.met === true && evidence !== "", evidence };
  });

  return {
    criteria,
    // Our own marks decide whether it closes; this sentence only explains it.
    missing:
      typeof raw.missing === "string" && raw.missing !== ""
        ? raw.missing
        : "The comments don't yet show this was done.",
  };
}

// factIndex is which fact covered the step, or -1 for a gap. The task hangs off
// that fact in the graph, so a fact with no task pointing at it is an orphan —
// which only works if the model names the fact rather than paraphrasing it.
export type StepVerdict = {
  id: string;
  status: "covered" | "gap";
  evidence: string;
  factIndex: number;
};

export async function classifySteps(
  steps: SopStep[],
  facts: { text: string }[],
): Promise<StepVerdict[]> {
  const raw = await chat<{
    steps?: { id?: string; status?: string; factIndex?: number }[];
  }>(
    `You are checking whether a discharge conversation covered each step of a care protocol.

Protocol steps:
${JSON.stringify(steps.map(({ id, title, trigger }) => ({ id, title, trigger })), null, 2)}

Facts extracted from the conversation:
${JSON.stringify(facts.map((text, index) => ({ index, text: text.text })), null, 2)}

A step is "covered" if a fact says it was performed, ordered, referred, booked or arranged. An order that has been placed counts, even if the date has not been set yet.

A step is a "gap" in two cases, and they are the cases that matter most:
- The conversation only named a symptom, condition or medication the step would address, without acting on it.
- The step was raised and then pushed into the future without being settled — "we'll come back to it", "let's park that", "consider it at follow-up", "reassess later". Deferring a decision is not making one, however settled it sounds.

For a covered step give "factIndex": the index of the fact that covers it. For a gap use -1.
Return JSON: {"steps":[{"id","status","factIndex"}]}`,
  );

  // Anything the model omits or garbles falls back to "gap": a false gap is a
  // redundant task, a false "covered" silently drops care.
  return steps.map((step) => {
    const verdict = raw.steps?.find((s) => s.id === step.id);
    const factIndex = verdict?.factIndex ?? -1;
    const fact = facts[factIndex];
    // "covered" pointing at no real fact is the model being agreeable. Without a
    // fact there is no edge to draw, so it is a gap.
    const covered = verdict?.status === "covered" && fact !== undefined;
    return {
      id: step.id,
      status: covered ? "covered" : "gap",
      evidence: covered ? fact.text : "",
      factIndex: covered ? factIndex : -1,
    };
  });
}

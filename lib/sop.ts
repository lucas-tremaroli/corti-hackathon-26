import { chat } from "./corti";

export type Role = "GP" | "MunicipalNursing" | "MunicipalRehab" | "Hospital";

export const ROLES: Record<Role, { short: string; long: string }> = {
  GP: { short: "GP", long: "General practice" },
  MunicipalNursing: { short: "Nursing", long: "Municipal nursing" },
  MunicipalRehab: { short: "Rehab", long: "Municipal rehab" },
  Hospital: { short: "Hospital", long: "Hospital" },
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
export const POST_FALL_DISCHARGE = {
  id: "post-fall-discharge",
  name: "Elderly post-fall discharge",
  icd10Prefixes: ["W01", "W18", "W19", "S72"],
  steps: [
    {
      id: "medication-review",
      title: "Medication review",
      role: "GP",
      dueInDays: 14,
      trigger: "Any new medication started, or existing sedating, hypotensive or anticoagulant medication.",
      closes: [
        "The full medication list was reviewed with the patient.",
        "Every sedating, hypotensive or anticoagulant medicine has a decision recorded — continued, changed or stopped.",
      ],
    },
    {
      id: "orthostatic-bp",
      title: "Lying and standing blood pressure check",
      role: "GP",
      dueInDays: 14,
      trigger: "Dizziness, lightheadedness or blackouts, especially on standing.",
      closes: [
        "Blood pressure was measured both lying and standing, and the readings are recorded.",
        "A significant drop has a plan against it, or the reading is recorded as normal.",
      ],
    },
    {
      id: "home-hazard-assessment",
      title: "Home hazard assessment",
      role: "MunicipalNursing",
      dueInDays: 7,
      trigger: "Fall occurred at home, or the patient lives alone.",
      closes: [
        "Someone visited the home and went through it for hazards.",
        "Each hazard found is either fixed or handed to a named service.",
      ],
    },
    {
      id: "strength-balance-referral",
      title: "Strength and balance programme referral",
      role: "MunicipalRehab",
      dueInDays: 30,
      trigger: "Any fall in the last twelve months.",
      closes: [
        "The referral was sent to a named strength and balance programme.",
        "The patient has a start date, or is on the waiting list and knows it.",
      ],
    },
    {
      id: "bone-health-review",
      title: "Bone health and fracture risk review",
      role: "GP",
      dueInDays: 30,
      trigger: "Fragility fracture, or osteoporosis treatment started or ongoing.",
      closes: [
        "Fracture risk was assessed, including calcium and vitamin D.",
        "A decision on bone protection treatment is recorded.",
      ],
    },
    {
      id: "falls-follow-up",
      title: "Falls follow-up consultation",
      role: "GP",
      dueInDays: 30,
      trigger: "Always applies after a fall resulting in admission.",
      closes: [
        "The consultation took place and the patient was seen.",
        "Remaining falls risk factors and the next step for each are recorded.",
      ],
    },
  ] satisfies SopStep[],
};

export function sopForCodes(codes: string[]) {
  const hit = codes.some((c) => POST_FALL_DISCHARGE.icd10Prefixes.some((p) => c.startsWith(p)));
  return hit ? POST_FALL_DISCHARGE : null;
}

// ponytail: one protocol, so the step id is enough to find it. Take the sop id
// too once a second protocol exists.
export const sopStep = (stepId: string | null) =>
  POST_FALL_DISCHARGE.steps.find((s) => s.id === stepId) ?? null;

export type ClosureCheck = { text: string; met: boolean; evidence: string };

// The protocol says what closing a step means; the comments on the task are the
// only record of what was actually done. This reads one against the other.
export async function checkClosure(
  step: SopStep,
  comments: string[],
): Promise<ClosureCheck[]> {
  // An empty thread can't satisfy anything, and asking costs a round trip.
  if (comments.length === 0) return step.closes.map((text) => ({ text, met: false, evidence: "" }));

  const raw = await chat<{ criteria?: { index?: number; met?: boolean; evidence?: string }[] }>(
    `You are checking whether the notes recorded on a care task show that it can be closed.

Task: ${step.title}

Completion criteria:
${JSON.stringify(step.closes.map((text, index) => ({ index, text })), null, 2)}

Notes recorded on this task, oldest first:
${JSON.stringify(comments)}

A criterion is met only if a note says the thing was actually done, measured or decided. An intention, a plan to do it later, or a note that only names the problem does not meet it.

Quote the supporting note verbatim as evidence for met criteria, and use an empty string otherwise.
Return JSON: {"criteria":[{"index","met","evidence"}]}`,
  );

  return step.closes.map((text, index) => {
    const verdict = raw.criteria?.find((c) => c.index === index);
    const evidence = typeof verdict?.evidence === "string" ? verdict.evidence : "";
    // "met" with nothing to quote is the model being agreeable, and unmet is the
    // safe default: it asks for another note, where the opposite closes care
    // that never happened.
    return { text, met: verdict?.met === true && evidence !== "", evidence };
  });
}

export type StepVerdict = { id: string; status: "covered" | "gap"; evidence: string };

export async function classifySteps(
  steps: SopStep[],
  facts: { text: string }[],
): Promise<StepVerdict[]> {
  const raw = await chat<{ steps?: { id?: string; status?: string; evidence?: string }[] }>(
    `You are checking whether a discharge conversation covered each step of a care protocol.

Protocol steps:
${JSON.stringify(steps.map(({ id, title, trigger }) => ({ id, title, trigger })), null, 2)}

Facts extracted from the conversation:
${JSON.stringify(facts.map((f) => f.text))}

A step is "covered" only if a fact says it was performed, arranged, referred, booked or explicitly planned. Naming a symptom, condition or medication the step would address is not enough on its own — that is a "gap", and it is the case that matters most.

Quote the supporting fact verbatim as evidence for covered steps, and use an empty string for gaps.
Return JSON: {"steps":[{"id","status","evidence"}]}`,
  );

  // Anything the model omits or garbles falls back to "gap": a false gap is a
  // redundant task, a false "covered" silently drops care.
  return steps.map((step) => {
    const verdict = raw.steps?.find((s) => s.id === step.id);
    return {
      id: step.id,
      status: verdict?.status === "covered" ? "covered" : "gap",
      evidence: typeof verdict?.evidence === "string" ? verdict.evidence : "",
    };
  });
}

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
    },
    {
      id: "orthostatic-bp",
      title: "Lying and standing blood pressure check",
      role: "GP",
      dueInDays: 14,
      trigger: "Dizziness, lightheadedness or blackouts, especially on standing.",
    },
    {
      id: "home-hazard-assessment",
      title: "Home hazard assessment",
      role: "MunicipalNursing",
      dueInDays: 7,
      trigger: "Fall occurred at home, or the patient lives alone.",
    },
    {
      id: "strength-balance-referral",
      title: "Strength and balance programme referral",
      role: "MunicipalRehab",
      dueInDays: 30,
      trigger: "Any fall in the last twelve months.",
    },
    {
      id: "bone-health-review",
      title: "Bone health and fracture risk review",
      role: "GP",
      dueInDays: 30,
      trigger: "Fragility fracture, or osteoporosis treatment started or ongoing.",
    },
    {
      id: "falls-follow-up",
      title: "Falls follow-up consultation",
      role: "GP",
      dueInDays: 30,
      trigger: "Always applies after a fall resulting in admission.",
    },
  ] satisfies SopStep[],
};

export function sopForCodes(codes: string[]) {
  const hit = codes.some((c) => POST_FALL_DISCHARGE.icd10Prefixes.some((p) => c.startsWith(p)));
  return hit ? POST_FALL_DISCHARGE : null;
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

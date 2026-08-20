export type Role = "GP" | "MunicipalNursing" | "MunicipalRehab" | "Hospital";

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

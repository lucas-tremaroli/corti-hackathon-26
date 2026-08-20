import { db } from "../lib/db";
import { episodes, type TaskStatus, tasks } from "../lib/schema";
import { POST_FALL_DISCHARGE } from "../lib/sop";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

// Two patients so the board opens with history rather than an empty state, and
// so every inbox has more than one row to group.
const patients = [
  {
    patientName: "Bent Andersen",
    title: "Hip fracture after fall at home",
    transcript:
      "Mr Andersen, 81, admitted after a fall in his kitchen. Left hip fractured and pinned. Home tomorrow with the walking frame.",
    dischargedDaysAgo: 24,
    // sop step id -> status. Anything omitted stays open.
    progress: {
      "medication-review": "done",
      "orthostatic-bp": "done",
      "bone-health-review": "done",
    } as Record<string, TaskStatus>,
    // Due seven days after discharge and nobody picked it up.
    gap: "home-hazard-assessment",
  },
  {
    patientName: "Else Kirkegaard",
    title: "Wrist fracture after fall on the stairs",
    transcript:
      "Mrs Kirkegaard, 78, fell on the stairs at home and fractured her right wrist. Cast on, discharged the same day.",
    dischargedDaysAgo: 5,
    progress: {} as Record<string, TaskStatus>,
    gap: "strength-balance-referral",
  },
];

// What the conversation said about each step, in the shape extract-facts returns:
// a short verbatim statement, not a description of the task. A step missing from
// this map is a gap — nobody raised it, so the task has nothing behind it.
const saidAtDischarge: Record<string, string> = {
  "medication-review": "GP asked to review the full medication list within two weeks.",
  "orthostatic-bp": "Lying and standing blood pressure to be checked at the GP review.",
  "home-hazard-assessment": "District nurse to look at the hallway and stairs.",
  "strength-balance-referral": "Referred to the falls prevention group at the rehab centre.",
  "bone-health-review": "Alendronate once weekly, fracture risk to be reviewed.",
  "falls-follow-up": "Follow-up with the GP booked in four weeks.",
};

await db.delete(episodes);

for (const { progress, gap, dischargedDaysAgo, ...episodeValues } of patients) {
  const [episode] = await db
    .insert(episodes)
    .values({
      ...episodeValues,
      // ponytail: no codes — these episodes are context for the board, and coding
      // them would mean a live API call in the seed. The demo episode gets real ones.
      codes: [],
      sopId: POST_FALL_DISCHARGE.id,
      dischargedAt: daysAgo(dischargedDaysAgo),
    })
    .returning();

  await db.insert(tasks).values(
    POST_FALL_DISCHARGE.steps.map((step) => ({
      episodeId: episode.id,
      title: step.title,
      assigneeRole: step.role,
      dueAt: daysAgo(dischargedDaysAgo - step.dueInDays),
      status: progress[step.id] ?? "open",
      evidence: step.id === gap ? "" : saidAtDischarge[step.id],
      sopStepId: step.id,
      source: "sop" as const,
    })),
  );

  console.log(`seeded ${episode.patientName} — ${POST_FALL_DISCHARGE.steps.length} tasks`);
}

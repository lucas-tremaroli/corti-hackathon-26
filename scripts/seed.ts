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
      evidence: step.id === gap ? "" : "Arranged at discharge.",
      sopStepId: step.id,
      source: "sop" as const,
    })),
  );

  console.log(`seeded ${episode.patientName} — ${POST_FALL_DISCHARGE.steps.length} tasks`);
}

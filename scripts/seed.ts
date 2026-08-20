import { db } from "../lib/db";
import { episodes, type TaskStatus, tasks } from "../lib/schema";
import { POST_FALL_DISCHARGE } from "../lib/sop";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

// A patient discharged three weeks ago, so the board opens with history rather
// than an empty state — and with one task already past its deadline.
const DISCHARGED_DAYS_AGO = 24;

// sop step id -> status. Anything omitted stays open.
const progress: Record<string, TaskStatus> = {
  "medication-review": "done",
  "orthostatic-bp": "done",
  "bone-health-review": "done",
};

// The one nobody picked up: due seven days after discharge, still open.
const overdue = "home-hazard-assessment";

await db.delete(episodes);

const [episode] = await db
  .insert(episodes)
  .values({
    patientName: "Bent Andersen",
    title: "Hip fracture after fall at home",
    transcript:
      "Mr Andersen, 81, admitted after a fall in his kitchen. Left hip fractured and pinned. Home tomorrow with the walking frame.",
    // ponytail: no codes — this episode is context for the board, and coding it
    // would mean a live API call in the seed. The demo episode gets real ones.
    codes: [],
    sopId: POST_FALL_DISCHARGE.id,
    dischargedAt: daysAgo(DISCHARGED_DAYS_AGO),
  })
  .returning();

await db.insert(tasks).values(
  POST_FALL_DISCHARGE.steps.map((step) => ({
    episodeId: episode.id,
    title: step.title,
    assigneeRole: step.role,
    dueAt: daysAgo(DISCHARGED_DAYS_AGO - step.dueInDays),
    status: progress[step.id] ?? "open",
    evidence: step.id === overdue ? "" : "Arranged at discharge.",
    sopStepId: step.id,
    source: "sop" as const,
  })),
);

console.log(`seeded ${episode.patientName} — ${POST_FALL_DISCHARGE.steps.length} tasks`);

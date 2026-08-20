import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "./db";
import { episodes, type TaskUpdate, taskUpdates, tasks } from "./schema";
import type { Role } from "./sop";

export async function getEpisode(episodeId: string) {
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
  if (!episode) return null;
  const rows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.episodeId, episodeId))
    .orderBy(asc(tasks.dueAt));
  return { episode, tasks: rows };
}

export async function getLatestEpisode() {
  const [episode] = await db
    .select()
    .from(episodes)
    .orderBy(desc(episodes.dischargedAt))
    .limit(1);
  return episode ? getEpisode(episode.id) : null;
}

export function getInbox(role: Role) {
  return db
    .select({ task: tasks, episode: episodes })
    .from(tasks)
    .innerJoin(episodes, eq(tasks.episodeId, episodes.id))
    .where(and(eq(tasks.assigneeRole, role), ne(tasks.status, "proposed")))
    .orderBy(asc(tasks.dueAt));
}

// Update threads for a whole list of tasks in one round trip, so the inbox can
// render them inside rows without a query per row.
export async function getUpdatesFor(taskIds: string[]) {
  const threads = new Map<string, TaskUpdate[]>();
  if (taskIds.length === 0) return threads;

  const rows = await db
    .select()
    .from(taskUpdates)
    .where(inArray(taskUpdates.taskId, taskIds))
    .orderBy(asc(taskUpdates.createdAt));

  for (const update of rows) {
    threads.set(update.taskId, [...(threads.get(update.taskId) ?? []), update]);
  }
  return threads;
}

// Outstanding work per role, for the counts beside each inbox in the rail.
export async function getRoleCounts() {
  const rows = await db
    .select({ role: tasks.assigneeRole, open: count() })
    .from(tasks)
    .where(and(ne(tasks.status, "proposed"), ne(tasks.status, "done")))
    .groupBy(tasks.assigneeRole);
  return new Map(rows.map((r) => [r.role, r.open]));
}

export async function getTask(taskId: string) {
  const [row] = await db
    .select({ task: tasks, episode: episodes })
    .from(tasks)
    .innerJoin(episodes, eq(tasks.episodeId, episodes.id))
    .where(eq(tasks.id, taskId));
  if (!row) return null;
  const updates = await db
    .select()
    .from(taskUpdates)
    .where(eq(taskUpdates.taskId, taskId))
    .orderBy(asc(taskUpdates.createdAt));
  return { ...row, updates };
}

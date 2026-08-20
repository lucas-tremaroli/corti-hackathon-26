import { and, asc, desc, eq, ne } from "drizzle-orm";
import { db } from "./db";
import { episodes, taskUpdates, tasks } from "./schema";
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

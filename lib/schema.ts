import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Code, Fact } from "./corti";
import type { Role } from "./sop";

export const episodes = pgTable("episodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientName: text("patient_name").notNull(),
  title: text("title").notNull(),
  transcript: text("transcript").notNull(),
  codes: jsonb("codes").$type<Code[]>().notNull().default([]),
  sopId: text("sop_id").notNull(),
  dischargedAt: timestamp("discharged_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  episodeId: uuid("episode_id")
    .notNull()
    .references(() => episodes.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  assigneeRole: text("assignee_role").$type<Role>().notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  status: text("status").$type<TaskStatus>().notNull().default("proposed"),
  evidence: text("evidence").notNull().default(""),
  sopStepId: text("sop_step_id"),
  source: text("source").$type<TaskSource>().notNull(),
});

export const taskUpdates = pgTable("task_updates", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  kind: text("kind").$type<UpdateKind>().notNull(),
  text: text("text").notNull(),
  facts: jsonb("facts").$type<Fact[]>(),
  interactionId: text("interaction_id"),
  authorRole: text("author_role").$type<Role>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TaskStatus = "proposed" | "open" | "done";
export type TaskSource = "sop" | "conversation";
export type UpdateKind = "typed" | "dictation" | "ambient";

export type Episode = typeof episodes.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskUpdate = typeof taskUpdates.$inferSelect;

// A task instantiated from a protocol step that nothing in the conversation
// supported: the thing the whole product exists to surface.
export const isGap = (task: Task) => task.source === "sop" && task.evidence === "";
export const isOverdue = (task: Task) => task.status !== "done" && task.dueAt < new Date();

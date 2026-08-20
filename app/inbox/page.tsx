import { Button, Heading, Text } from "@radix-ui/themes";
import Link from "next/link";
import { completeTask } from "@/app/actions";
import { Shell } from "@/components/shell";
import { TaskComposer } from "@/components/task-composer";
import { getInbox, getRoleCounts, getUpdatesFor } from "@/lib/queries";
import { type Episode, isGap, isOverdue, type Task } from "@/lib/schema";
import { ROLES, type Role } from "@/lib/sop";
import styles from "./inbox.module.css";

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

// Whole days is the right resolution here: nothing in this protocol is due by
// the hour, and "in 6 days" reads faster than a date.
function whenDue(date: Date) {
  return relative.format(Math.round((date.getTime() - Date.now()) / 86_400_000), "day");
}

// One section per patient — the question a clinician actually holds in their
// head is "what does Mrs Jensen still need", not "what is late everywhere".
// Rows arrive due-first, so insertion order puts the most urgent patient on top.
function byPatient(rows: { task: Task; episode: Episode }[]) {
  const groups = new Map<string, { episode: Episode; tasks: Task[] }>();
  for (const { task, episode } of rows) {
    const group = groups.get(episode.id) ?? { episode, tasks: [] };
    group.tasks.push(task);
    groups.set(episode.id, group);
  }
  return [...groups.values()];
}

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const { role } = await searchParams;
  const current = (typeof role === "string" && role in ROLES ? role : "MunicipalNursing") as Role;

  const [rows, counts] = await Promise.all([getInbox(current), getRoleCounts()]);
  const open = rows.filter((row) => row.task.status !== "done");
  const overdue = open.filter((row) => isOverdue(row.task)).length;
  const threads = await getUpdatesFor(open.map((row) => row.task.id));

  return (
    <Shell
      rail={
        <div className={styles.railGroup}>
          <Text size="1" weight="medium" className={styles.railLabel}>
            Inboxes
          </Text>
          {Object.entries(ROLES).map(([value, { long }]) => (
            <Link
              key={value}
              href={`/inbox?role=${value}`}
              className={styles.railItem}
              aria-current={value === current ? "page" : undefined}
            >
              <Text size="2">{long}</Text>
              <Text size="1" className={styles.railCount}>
                {counts.get(value as Role) ?? "–"}
              </Text>
            </Link>
          ))}
        </div>
      }
    >
      <header className={styles.head}>
          <Heading as="h1" size="4" weight="medium">
            {ROLES[current].long}
          </Heading>
          <Text size="2" color={overdue > 0 ? "red" : "gray"}>
            {overdue > 0 ? `${overdue} overdue` : `${open.length} open`}
          </Text>
        </header>

        {open.length === 0 ? (
          <Text as="p" size="2" color="gray" className={styles.empty}>
            Nothing outstanding. New work arrives here once a discharge is reviewed.
          </Text>
        ) : (
          byPatient(open).map(({ episode, tasks }) => (
            <section key={episode.id} className={styles.group}>
              <div className={styles.groupHead}>
                <Text size="2" weight="medium">
                  {episode.patientName}
                </Text>
                <Text size="1" color="gray">
                  {episode.title}
                </Text>
              </div>

              <ol className={styles.rows}>
                {tasks.map((task) => (
                  <li key={task.id}>
                    <details className={styles.row}>
                      <summary className={styles.summary}>
                        <span
                          className={`${styles.mark} ${isGap(task) ? styles.gap : ""}`}
                          aria-hidden
                        />
                        <Text size="2" className={styles.title}>
                          {task.title}
                        </Text>
                        <Text
                          size="1"
                          className={`${styles.due} ${isOverdue(task) ? styles.late : ""}`}
                        >
                          {whenDue(task.dueAt)}
                        </Text>
                      </summary>

                      <div className={styles.body}>
                        {isGap(task) ? (
                          <Text as="p" size="2" color="gray" className={styles.note}>
                            Never mentioned in the discharge conversation. The protocol adds
                            it for {episode.title.toLowerCase()}.
                          </Text>
                        ) : (
                          <blockquote className={styles.quote}>
                            <Text size="1" color="gray" className={styles.quoteLabel}>
                              From the discharge conversation
                            </Text>
                            <Text as="p" size="2">
                              {task.evidence}
                            </Text>
                          </blockquote>
                        )}

                        <section className={styles.updates}>
                          <Text size="1" weight="medium" className={styles.updatesLabel}>
                            Updates
                          </Text>

                          {threads.get(task.id)?.map((update) => (
                            <div key={update.id} className={styles.update}>
                              <Text size="1" color="gray">
                                {ROLES[update.authorRole].long} · {whenDue(update.createdAt)}
                                {update.kind !== "typed" && ` · ${update.kind}`}
                              </Text>
                              <Text as="p" size="2">
                                {update.text}
                              </Text>
                            </div>
                          ))}

                          <div className={styles.composerSlot}>
                            <TaskComposer
                              taskId={task.id}
                              taskTitle={task.title}
                              authorRole={current}
                            />
                          </div>
                        </section>

                        {/* The task itself, not its thread — so it sits outside the
                            updates panel and is the only bordered button here. */}
                        <form action={completeTask.bind(null, task.id)} className={styles.taskAction}>
                          <Button type="submit" size="1" variant="surface" color="gray">
                            Mark done
                          </Button>
                        </form>
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}
    </Shell>
  );
}

import { Heading, Text } from "@radix-ui/themes";
import { AcceptHandoff } from "@/components/accept-handoff";
import { CompleteTask } from "@/components/complete-task";
import { Rail } from "@/components/rail";
import { Shell } from "@/components/shell";
import { TaskComposer } from "@/components/task-composer";
import { SBAR_PARTS } from "@/lib/handoff";
import { isGap, isOverdue } from "@/lib/model";
import { clinicians, inboxFor, notesFor } from "@/lib/queries";
import { ROLES, sopStep } from "@/lib/sop";
import styles from "./inbox.module.css";

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

// Whole days is the right resolution here: nothing in this protocol is due by
// the hour, and "in 6 days" reads faster than a date.
function when(iso: string) {
  return relative.format(Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000), "day");
}

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const { clinician } = await searchParams;
  const people = await clinicians();
  const current =
    people.find((p) => p.id === clinician) ?? people.find((p) => p.role === "GP") ?? people[0];

  if (!current) {
    return (
      <Shell rail={<Rail current="" />}>
        <Text as="p" size="2" color="gray">
          No clinicians in the graph yet. Run the seed.
        </Text>
      </Shell>
    );
  }

  const handoffs = await inboxFor(current.id);
  const open = handoffs.flatMap((h) => h.tasks.filter((t) => t.status !== "done"));
  const overdue = open.filter(isOverdue).length;
  const threads = await notesFor(open.map((t) => t.id));

  return (
    <Shell rail={<Rail current={current.id} />}>
      <header className={styles.head}>
        <Heading as="h1" size="4" weight="medium">
          {current.name}
        </Heading>
        <Text size="2" color={overdue > 0 ? "red" : "gray"}>
          {overdue > 0 ? `${overdue} overdue` : `${open.length} open`}
        </Text>
      </header>

      {handoffs.length === 0 ? (
        <Text as="p" size="2" color="gray" className={styles.empty}>
          Nothing handed over. Work arrives here when someone sends a handoff.
        </Text>
      ) : (
        handoffs.map(({ handoff, patient, from, tasks }) => (
          <section key={handoff.id} className={styles.group}>
            <div className={styles.groupHead}>
              <Text size="2" weight="medium">
                {patient.name}
              </Text>
              <Text size="1" color="gray">
                from {from.name} · {when(handoff.at)}
              </Text>
              <span className={styles.spacer} />
              {handoff.accepted ? (
                <Text size="1" color="gray">
                  Picked up
                </Text>
              ) : (
                <AcceptHandoff handoffId={handoff.id} patientName={patient.name} />
              )}
            </div>

            {/* The four parts, always visible — this is what was handed over,
                and reading it is the whole job. */}
            <dl className={styles.sbar}>
              {SBAR_PARTS.map(({ key, label }) => (
                <div key={key} className={styles.sbarPart}>
                  <dt>
                    <Text size="1" weight="medium" className={styles.sbarLabel}>
                      {label}
                    </Text>
                  </dt>
                  <dd>
                    <Text as="p" size="2">
                      {handoff[key] || <span className={styles.missing}>Nothing written</span>}
                    </Text>
                  </dd>
                </div>
              ))}
            </dl>

            <ol className={styles.rows}>
              {tasks
                .filter((task) => task.status !== "done")
                .map((task) => (
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
                          {when(task.dueAt)}
                        </Text>
                      </summary>

                      <div className={styles.body}>
                        {isGap(task) ? (
                          <Text as="p" size="2" color="gray" className={styles.note}>
                            Never mentioned in the discharge conversation. The protocol adds it
                            for {patient.name}.
                          </Text>
                        ) : (
                          <blockquote className={styles.quote}>
                            <Text size="1" color="gray" className={styles.quoteLabel}>
                              Because of
                            </Text>
                            <Text as="p" size="2">
                              {task.evidence}
                            </Text>
                          </blockquote>
                        )}

                        <section className={styles.updates}>
                          <Text size="1" weight="medium" className={styles.updatesLabel}>
                            Comments
                          </Text>

                          {threads.get(task.id)?.map((note) => (
                            <div key={note.id} className={styles.update}>
                              <Text size="1" color="gray">
                                {ROLES[note.author]?.long ?? note.author} · {when(note.at)}
                                {note.kind !== "typed" && ` · ${note.kind}`}
                              </Text>
                              <Text as="p" size="2">
                                {note.text}
                              </Text>
                            </div>
                          ))}

                          <div className={styles.composerSlot}>
                            <TaskComposer
                              taskId={task.id}
                              taskTitle={task.title}
                              authorRole={current.role}
                            />
                          </div>
                        </section>

                        <CompleteTask
                          taskId={task.id}
                          taskTitle={task.title}
                          criteria={sopStep(task.stepId)?.closes ?? []}
                          closure={task.closure}
                        />
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

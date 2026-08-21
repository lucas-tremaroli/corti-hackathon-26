import { Heading, Text } from "@radix-ui/themes";
import { AcceptHandoff } from "@/components/accept-handoff";
import { CompleteTask } from "@/components/complete-task";
import { Rail } from "@/components/rail";
import { RailProfile } from "@/components/rail-profile";
import { Shell } from "@/components/shell";
import { TaskComposer } from "@/components/task-composer";
import { SBAR_PARTS } from "@/lib/handoff";
import { isGap, isOverdue, type Handoff, type Patient, type Task } from "@/lib/model";
import { activeClinician } from "@/lib/profile";
import { inboxFor, notesFor, tasksOwnedBy } from "@/lib/queries";
import { ROLES, sopStep } from "@/lib/sop";
import styles from "./inbox.module.css";

// See app/page.tsx — the graph is read at request time, never prerendered.
export const dynamic = "force-dynamic";

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

// Whole days is the right resolution here: nothing in this protocol is due by
// the hour, and "in 6 days" reads faster than a date.
function when(iso: string) {
  return relative.format(Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000), "day");
}

type Group = {
  patient: Patient;
  handoff: { handoff: Handoff; from: { name: string } } | null;
  tasks: Task[];
};

/**
 * One section per patient, whether the work arrived as a handoff or was simply
 * assigned. The sending clinician has tasks and no incoming handoff; the
 * receiving one has both. Same layout either way.
 */
function byPatient(
  handoffs: Awaited<ReturnType<typeof inboxFor>>,
  owned: Awaited<ReturnType<typeof tasksOwnedBy>>,
): Group[] {
  const groups = new Map<string, Group>();

  for (const row of handoffs) {
    groups.set(row.patient.id, {
      patient: row.patient,
      handoff: { handoff: row.handoff, from: row.from },
      tasks: [],
    });
  }
  for (const { task, patient } of owned) {
    const group = groups.get(patient.id) ?? { patient, handoff: null, tasks: [] };
    group.tasks.push(task);
    groups.set(patient.id, group);
  }
  return [...groups.values()];
}

export default async function InboxPage() {
  const current = await activeClinician();

  if (!current) {
    return (
      <Shell rail={<Rail current="/inbox" />}>
        <Text as="p" size="2" color="gray">
          No clinicians in the graph yet. Run the seed.
        </Text>
      </Shell>
    );
  }

  const [handoffs, owned] = await Promise.all([inboxFor(current.id), tasksOwnedBy(current.id)]);
  const groups = byPatient(handoffs, owned);
  const overdue = owned.filter(({ task }) => isOverdue(task)).length;
  const threads = await notesFor(owned.map(({ task }) => task.id));

  return (
    <Shell
      rail={<Rail current="/inbox" clinicianId={current.id} />}
      profile={<RailProfile />}
    >
      <header className={styles.head}>
        <Heading as="h1" size="4" weight="medium">
          {ROLES[current.role].long}
        </Heading>
        <Text size="2" color={overdue > 0 ? "red" : "gray"}>
          {overdue > 0 ? `${overdue} overdue` : `${owned.length} open`}
        </Text>
      </header>

      {groups.length === 0 ? (
        <Text as="p" size="2" color="gray" className={styles.empty}>
          Nothing outstanding. Work arrives here when someone hands it to you.
        </Text>
      ) : (
        groups.map(({ patient, handoff, tasks }) => (
          <section key={patient.id} className={styles.group}>
            <div className={styles.groupHead}>
              <Text size="2" weight="medium">
                {patient.name}
              </Text>
              {handoff && (
                <Text size="1" color="gray">
                  from {handoff.from.name} · {when(handoff.handoff.at)}
                </Text>
              )}
              <span className={styles.spacer} />
              {handoff &&
                (handoff.handoff.accepted ? (
                  <Text size="1" color="gray">
                    Picked up
                  </Text>
                ) : (
                  <AcceptHandoff handoffId={handoff.handoff.id} patientName={patient.name} />
                ))}
            </div>

            {/* The four parts, always visible — this is what was handed over,
                and reading it is the whole job. */}
            {handoff && (
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
                        {handoff.handoff[key] || (
                          <span className={styles.missing}>Nothing written</span>
                        )}
                      </Text>
                    </dd>
                  </div>
                ))}
              </dl>
            )}

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

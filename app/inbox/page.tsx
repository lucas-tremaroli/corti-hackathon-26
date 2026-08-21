import { Heading, Text } from "@radix-ui/themes";
import type { ReactNode } from "react";
import { CompleteTask } from "@/components/complete-task";
import { HandoffCard } from "@/components/handoff-card";
import { Rail } from "@/components/rail";
import { RailProfile } from "@/components/rail-profile";
import { Shell } from "@/components/shell";
import { TaskComposer } from "@/components/task-composer";
import { isGap, isOverdue } from "@/lib/model";
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

/**
 * One of the two things on this page. Open on arrival — you should see your work
 * without asking for it — but foldable, so a clinician who has read the handoffs
 * can put them away and work the list underneath.
 */
function Section({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <details className={styles.section} open>
      <summary className={styles.sectionHead}>
        <Text size="1" weight="medium" className={styles.sectionLabel}>
          {label}
        </Text>
        <Text size="1" className={styles.count}>
          {count}
        </Text>
      </summary>
      {children}
    </details>
  );
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
  const overdue = owned.filter(({ task }) => isOverdue(task)).length;
  const threads = await notesFor(owned.map(({ task }) => task.id));

  // Unread first. sort is stable, so the query's newest-first order survives
  // inside each half.
  const inbox = [...handoffs].sort(
    (a, b) => Number(a.handoff.accepted) - Number(b.handoff.accepted),
  );

  return (
    <Shell rail={<Rail current="/inbox" clinicianId={current.id} />} profile={<RailProfile />}>
      <header className={styles.head}>
        <Heading as="h1" size="4" weight="medium">
          {ROLES[current.role].long}
        </Heading>
        {/* The counts live on the section heads. Up here, only the one thing
            that needs saying before you have read anything. */}
        {overdue > 0 && (
          <Text size="2" color="red">
            {overdue} overdue
          </Text>
        )}
      </header>

      {/* Two kinds of object, two sections. A handoff is a message someone sent
          you; a task is work you owe by a date. The patient is named inside
          each one rather than above a pile of them. */}
      <Section label="Handoffs" count={inbox.length}>
        {inbox.length === 0 ? (
          <Text as="p" size="2" color="gray" className={styles.emptyLine}>
            No handoffs waiting. New ones arrive when someone sends you a patient.
          </Text>
        ) : (
          <div className={styles.cards}>
            {inbox.map(({ handoff, patient, from }) => (
              <HandoffCard
                key={handoff.id}
                handoff={handoff}
                patient={patient}
                from={from}
                sentAt={when(handoff.at)}
              />
            ))}
          </div>
        )}
      </Section>

      <Section label="Tasks" count={owned.length}>
        {owned.length === 0 ? (
          <Text as="p" size="2" color="gray" className={styles.emptyLine}>
            No open tasks. Picking up a handoff puts its work here.
          </Text>
        ) : (
          <ol className={styles.rows}>
            {owned.map(({ task, patient }) => (
              <li key={task.id}>
                <details className={styles.row}>
                  <summary className={styles.summary}>
                    <span
                      className={`${styles.mark} ${isGap(task) ? styles.gap : ""}`}
                      aria-hidden
                    />
                    <Text size="2" className={styles.who}>
                      {patient.name}
                    </Text>
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
                        Never mentioned in the discharge conversation. The protocol adds it for{" "}
                        {patient.name}.
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
        )}
      </Section>
    </Shell>
  );
}

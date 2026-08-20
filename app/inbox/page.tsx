import { Heading, Text } from "@radix-ui/themes";
import { RoleSwitcher } from "@/components/role-switcher";
import { getInbox } from "@/lib/queries";
import { isGap, isOverdue } from "@/lib/schema";
import { ROLES, type Role } from "@/lib/sop";
import styles from "./inbox.module.css";

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

// Whole days is the right resolution here: nothing in this protocol is due by
// the hour, and "in 6 days" reads faster than a date.
function whenDue(date: Date) {
  return relative.format(Math.round((date.getTime() - Date.now()) / 86_400_000), "day");
}

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const { role } = await searchParams;
  const current = (typeof role === "string" && role in ROLES ? role : "MunicipalNursing") as Role;

  const rows = await getInbox(current);
  const open = rows.filter(({ task }) => task.status !== "done");
  const overdue = open.filter(({ task }) => isOverdue(task)).length;
  const done = rows.length - open.length;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Text size="1" weight="medium" className={styles.wordmark}>
          CareOS
        </Text>
        <RoleSwitcher role={current} />
      </header>

      <Heading as="h1" size="6" weight="medium">
        {ROLES[current].long}
      </Heading>
      <Text as="p" size="2" color="gray" mt="1">
        {open.length} open
        {overdue > 0 && <Text color="red"> · {overdue} overdue</Text>}
        {done > 0 && ` · ${done} done`}
      </Text>

      {open.length === 0 ? (
        <Text as="p" size="2" color="gray" className={styles.empty}>
          Nothing outstanding. New work arrives here once a discharge is reviewed.
        </Text>
      ) : (
        <ol className={styles.list}>
          {open.map(({ task, episode }) => (
            <li key={task.id}>
              <details className={styles.row}>
                <summary className={styles.summary}>
                  <span className={styles.subject}>
                    <Text size="3">{task.title}</Text>
                    <Text size="2" color="gray">
                      {episode.patientName}
                    </Text>
                  </span>
                  <time
                    dateTime={task.dueAt.toISOString()}
                    className={`${styles.due} ${isOverdue(task) ? styles.late : ""}`}
                  >
                    {whenDue(task.dueAt)}
                  </time>
                </summary>

                <div className={styles.body}>
                  {isGap(task) ? (
                    <Text size="2" color="gray">
                      Never mentioned in the discharge conversation. The protocol adds it
                      for {episode.title.toLowerCase()}.
                    </Text>
                  ) : (
                    <Text size="2" color="gray" className={styles.quote}>
                      {task.evidence}
                    </Text>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

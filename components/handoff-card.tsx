import { Card, Text } from "@radix-ui/themes";
import type { Clinician, Handoff, Patient } from "@/lib/model";
import { ROLES } from "@/lib/sop";
import { AcceptHandoff } from "./accept-handoff";
import { Sbar } from "./sbar";
import styles from "./handoff-card.module.css";

/**
 * One handoff, as the clinician it was sent to sees it. A real card — an opaque
 * panel lifted off the page — because it is a different kind of object from the
 * task rows underneath: a message someone wrote and sent, not work you owe by a
 * date.
 *
 * Closed on arrival: the grid answers "who is waiting for me" at a glance, and
 * opening one is you choosing to read it. An open card takes the full width of
 * the grid — the four parts are prose, and prose does not want a column.
 *
 * `sentAt` arrives already humanised — the inbox owns that formatter, and it
 * uses it on the task rows too.
 */
export function HandoffCard({
  handoff,
  patient,
  from,
  sentAt,
}: {
  handoff: Handoff;
  patient: Patient;
  from: Clinician;
  sentAt: string;
}) {
  return (
    <Card asChild size="2" variant="classic">
      <details className={styles.card}>
        <summary className={styles.head}>
          <Text size="3" weight="medium" className={styles.patient}>
            {patient.name}
          </Text>
          {/* Who handed it to whom: the edge this whole product is built out of,
              written the way the graph holds it. */}
          <Text size="1" className={styles.routing}>
            {from.name} · {ROLES[from.role].long} → you · {sentAt}
          </Text>
          {/* Says what the handoff is doing, not what it is. One of these is
              asking you for something; the other is a record. */}
          <Text size="1" className={handoff.accepted ? styles.done : styles.waiting}>
            {handoff.accepted ? "Picked up" : "Waiting"}
          </Text>
        </summary>

        <div className={styles.body}>
          <Sbar sbar={handoff} missing="Nothing written" />

          {/* Below the four parts on purpose — you pick it up once you have read
              what you are picking up. */}
          {!handoff.accepted && (
            <div className={styles.foot}>
              <AcceptHandoff handoffId={handoff.id} patientName={patient.name} />
            </div>
          )}
        </div>
      </details>
    </Card>
  );
}

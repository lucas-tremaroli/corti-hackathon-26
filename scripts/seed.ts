import type { Clinician } from "../lib/model";
import { close, rows } from "../lib/graph";
import { ROLES } from "../lib/sop";

// The two people the handoff runs between, from Jane Smith's own chart. Two is
// the whole point: one profile hands over, the other picks up.
const CLINICIANS: Clinician[] = [
  {
    id: "cardiology",
    name: "Dr Michael Chen",
    role: "Cardiology",
    org: "Springfield General Hospital",
  },
  {
    id: "gp",
    name: "Dr Elena Vasquez",
    role: "GP",
    org: "Springfield Family Medicine",
  },
];

// Anything the seed creates, the seed can throw away. Everything else in the
// graph is either the demo or somebody's actual work.
await rows("MATCH (n) DETACH DELETE n");

/**
 * The patient exists before the conversation does, the way a chart does. It also
 * means nobody has to type a name into the app to start recording — the
 * dictation names them and the console matches against this list.
 *
 * Corti's synthetic set, names only: a roster is people, and everything clinical
 * about them arrives by being said out loud. Transcribed here rather than read
 * off disk because the source folder only exists on one machine, and a seed that
 * fails for the next person is not a fixture.
 *
 * Eleven, not one, because matching "Mrs Smith" against a list of one proves
 * nothing about the matching. Thomas Baker answers to Tom, which is the case
 * that catches a matcher only comparing whole strings.
 */
const PATIENTS = [
  { id: "aisha-rahman", name: "Aisha Rahman" },
  { id: "david-kim", name: "David Kim" },
  { id: "elena-petrova", name: "Elena Petrova" },
  { id: "harold-mitchell", name: "Harold Mitchell" },
  { id: "jamal-wright", name: "Jamal Wright" },
  { id: "jane-smith", name: "Jane Smith" },
  { id: "lily-chen", name: "Lily Chen" },
  { id: "maria-gonzalez", name: "Maria Gonzalez" },
  { id: "robert-okafor", name: "Robert Okafor" },
  { id: "sarah-nguyen", name: "Sarah Nguyen" },
  { id: "thomas-baker", name: "Thomas Baker" },
];

await rows(
  `UNWIND $clinicians AS row
   CREATE (c:Clinician {id: row.id, name: row.name, role: row.role, org: row.org})`,
  { clinicians: CLINICIANS },
);

await rows(
  `UNWIND $patients AS row
   CREATE (p:Patient {id: row.id, name: row.name})`,
  { patients: PATIENTS },
);

for (const person of CLINICIANS) {
  console.log(`${person.name.padEnd(20)} ${ROLES[person.role].long}`);
}
for (const patient of PATIENTS) {
  console.log(`${patient.name.padEnd(20)} patient`);
}
console.log(
  `\n${CLINICIANS.length} clinicians, ${PATIENTS.length} patients. ` +
    `The conversation comes from the app.`,
);

await close();

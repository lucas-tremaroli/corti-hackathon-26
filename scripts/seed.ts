import type { Clinician } from "../lib/model";
import { close, rows } from "../lib/graph";
import { ROLES } from "../lib/sop";

// The people work is handed between. One per role, which is all a demo needs —
// the graph cares that a task has an owner, not how many owners exist.
// Jane Smith's actual care team, from the sample chart.
const CLINICIANS: Clinician[] = [
  { id: "cardiology", name: "Dr Chen", role: "Cardiology", org: "Springfield General Hospital" },
  { id: "gp", name: "Dr Vasquez", role: "GP", org: "Springfield Family Medicine" },
  { id: "imaging", name: "Springfield Imaging", role: "Imaging", org: "Springfield Imaging Center" },
];

// Anything the seed creates, the seed can throw away. Everything else in the
// graph is either the demo or somebody's actual work.
await rows("MATCH (n) DETACH DELETE n");

await rows(
  `UNWIND $clinicians AS row
   CREATE (c:Clinician {id: row.id, name: row.name, role: row.role, org: row.org})`,
  { clinicians: CLINICIANS },
);

for (const person of CLINICIANS) {
  console.log(`${person.name.padEnd(12)} ${ROLES[person.role].long}`);
}
console.log(`\n${CLINICIANS.length} clinicians. The conversation comes from the app.`);

await close();

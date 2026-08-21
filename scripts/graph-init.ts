import { close, rows } from "../lib/graph";

// Every node we create is looked up by id, so each one gets a uniqueness
// constraint — which Neo4j backs with an index. That's the whole schema:
// labels and relationships need no declaration.
const labels = ["Patient", "Clinician", "Conversation", "Fact", "Task", "Handoff", "Note"];

for (const label of labels) {
  await rows(
    `CREATE CONSTRAINT ${label.toLowerCase()}_id IF NOT EXISTS
     FOR (n:${label}) REQUIRE n.id IS UNIQUE`,
  );
}

const constraints = await rows<{ name: string }>("SHOW CONSTRAINTS YIELD name RETURN name");
console.log(`${constraints.length} constraints:`, constraints.map((c) => c.name).join(", "));

await close();

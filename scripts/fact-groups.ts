import { corti } from "../lib/corti";
import { DESCRIPTIVE_GROUPS } from "../lib/queries";

// Corti types a fact's group as an open string, so DESCRIPTIVE_GROUPS is a
// judgement about a taxonomy that lives on their side and can change under us.
// This prints the live one against our split: a group Corti has added shows up
// as "gap?", which is the safe default but wants a human to confirm it.
const response = (await corti().facts.factGroupsList()) as unknown as {
  data?: { key?: string }[];
};

const live = (response.data ?? [])
  .map((group) => group.key)
  .filter((key): key is string => typeof key === "string")
  .sort();

const descriptive = new Set(DESCRIPTIVE_GROUPS);

for (const key of live) {
  console.log(`  ${descriptive.has(key) ? "describes " : "gap?      "} ${key}`);
}

// A name in our list that Corti no longer defines is dead weight in the query,
// and worse, a sign the taxonomy moved and the rest of the split needs a look.
const stale = DESCRIPTIVE_GROUPS.filter((group) => !live.includes(group));

console.log(
  `\n${live.length} groups: ${live.length - live.filter((k) => descriptive.has(k)).length} can be a gap, ` +
    `${live.filter((k) => descriptive.has(k)).length} describe the patient`,
);
if (stale.length > 0) console.log(`stale in DESCRIPTIVE_GROUPS: ${stale.join(", ")}`);

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { extractFacts, predictCodes } from "../lib/corti";
import { classifySteps, POST_FALL_DISCHARGE, sopForCodes } from "../lib/sop";

// The demo script itself, so a change to what gets said on stage is a change to
// what this asserts. Four protocol steps arranged out loud, two raised and dropped.
const transcript = readFileSync("demo/discharge.txt", "utf8");

const [facts, codes] = await Promise.all([extractFacts(transcript), predictCodes(transcript)]);

assert.ok(facts.length > 0, "extract-facts returned nothing");
console.log("facts:");
for (const f of facts) console.log(`  ${f.group}: ${f.text}`);

console.log("codes:");
for (const c of codes) console.log(`  ${c.system.padEnd(22)} ${c.code.padEnd(12)} ${c.display}`);

const sop = sopForCodes(codes.map((c) => c.code));
assert.ok(sop, "coded fall should select the post-fall SOP");
assert.equal(sop.id, POST_FALL_DISCHARGE.id);

const verdicts = await classifySteps(sop.steps, facts);
assert.equal(verdicts.length, sop.steps.length, "every step must get a verdict");
console.log("steps:");
for (const v of verdicts) console.log(`  ${v.status.padEnd(8)} ${v.id}  ${v.evidence}`);

const gaps = verdicts.filter((v) => v.status === "gap").map((v) => v.id);
assert.ok(gaps.includes("orthostatic-bp"), "dizziness was never acted on — must be a gap");
assert.ok(gaps.includes("home-hazard-assessment"), "lives alone, no assessment — must be a gap");

// Without this, a classifier that answers "gap" to everything passes the asserts
// above and hands the demo a board where every single row is red.
const covered = verdicts.filter((v) => v.status === "covered").map((v) => v.id);
for (const id of ["medication-review", "strength-balance-referral", "bone-health-review", "falls-follow-up"]) {
  assert.ok(covered.includes(id), `${id} was arranged out loud — must be covered`);
}
assert.ok(
  verdicts.filter((v) => v.status === "covered").every((v) => v.evidence !== ""),
  "a covered step without a quote is not evidence of anything",
);

console.log("\nok");

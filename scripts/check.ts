import assert from "node:assert";
import { readFileSync } from "node:fs";
import { extractFacts, predictCodes } from "../lib/corti";
import { checkClosure, classifySteps, POST_FALL_DISCHARGE, sopForCodes, sopStep } from "../lib/sop";

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

// The other half of the loop: a task closes on what the comments say was done,
// not on someone clicking the button.
const step = sopStep("medication-review");
assert.ok(step, "medication-review must exist in the protocol");

const planned = await checkClosure(step, [
  "Booked Mrs Jensen in for a medication review at the end of the month.",
]);
assert.ok(
  planned.criteria.every((c) => !c.met),
  "a booking is a plan, not a completed review — must not close the task",
);
console.log(`missing: ${planned.missing}`);
// The criteria are on screen beside this sentence, so echoing them back is the
// one thing it must not do.
for (const c of planned.criteria) {
  assert.ok(!planned.missing.includes(c.text), "the message must not repeat a criterion verbatim");
}
// Sits next to the criteria in a toast. Anything longer is a restatement of them.
assert.ok(planned.missing.length < 140, `the message is too long: ${planned.missing.length} chars`);

const performed = await checkClosure(step, [
  "Went through the whole medication list with her today. Stopped the zopiclone, halved the ramipril because she was dizzy standing up, kept the alendronate as it is.",
]);
console.log("closure:");
for (const c of performed.criteria) {
  console.log(`  ${c.met ? "met " : "open"}  ${c.text}  ${c.evidence}`);
}
assert.ok(
  performed.criteria.every((c) => c.met),
  "a review that names every decision must close the task",
);
assert.ok(
  performed.criteria.every((c) => c.evidence !== ""),
  "a met criterion with nothing quoted is not evidence of anything",
);

console.log("\nok");

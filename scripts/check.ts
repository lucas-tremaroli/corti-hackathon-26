import assert from "node:assert";
import { extractFacts, predictCodes } from "../lib/corti";
import { classifySteps, POST_FALL_DISCHARGE, sopForCodes } from "../lib/sop";

// Stand-in for the recording in FORK-31, and it has to behave like the real one:
// four protocol steps arranged out loud, two raised and then dropped.
const transcript = `Right, so before you go home Mrs Jensen. You had the fall last Tuesday at home, tripped on the rug in the hallway, and you fractured your left hip. The operation went well and the hip is healing nicely.
Now, your tablets. I've written to your GP asking her to go through the whole list with you within the fortnight, because a few of them can leave you unsteady on your feet.
For the bones, I've started you on alendronate, once a week, and I've asked her to review your fracture risk and your vitamin D at the same appointment.
I've also referred you to the falls prevention group at the rehab centre, so they'll do strength and balance work with you. They should be in touch inside the month.
And I've booked you a follow-up with your GP in four weeks to see how you're getting on after the fall.
Patient: I have been a bit dizzy in the mornings, when I get up out of bed.
Doctor: Right. And you live on your own, is that right?
Patient: On my own, yes, since my husband passed.`;

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

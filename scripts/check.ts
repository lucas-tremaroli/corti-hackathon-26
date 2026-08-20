import assert from "node:assert";
import { extractFacts, predictCodes } from "../lib/corti";
import { classifySteps, POST_FALL_DISCHARGE, sopForCodes } from "../lib/sop";

const transcript = `Right, so before you go home Mrs Jensen. You had the fall last Tuesday at home, tripped on the rug in the hallway, and you fractured your left hip. The operation went well and the hip is healing nicely. I've got you on the alendronate now, once a week, for the bones. And I've been a bit dizzy in the mornings, when I get up out of bed. Right. And you live on your own, is that right? Yes, on my own since my husband passed.`;

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

console.log("\nok");

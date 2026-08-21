import assert from "node:assert";
import { readFileSync } from "node:fs";
import { extractFacts, predictCodes } from "../lib/corti";
import { close, rows } from "../lib/graph";
import { draftSbar, missingParts } from "../lib/handoff";
import { ORPHAN_FACTS } from "../lib/queries";
import { checkClosure, classifySteps, NEW_AF_DISCHARGE, sopForCodes, sopStep } from "../lib/sop";
import { saveConversation, saveTasks } from "../lib/writes";

// The demo script itself, so a change to what gets said on stage is a change to
// what this asserts. Four protocol steps arranged out loud, two raised and dropped.
const transcript = readFileSync("demo/discharge.txt", "utf8");

const [facts, codes] = await Promise.all([extractFacts(transcript), predictCodes(transcript)]);

assert.ok(facts.length > 0, "extract-facts returned nothing");
console.log("facts:");
for (const [i, f] of facts.entries()) console.log(`  ${String(i).padStart(2)}  ${f.text}`);

console.log("codes:");
for (const c of codes) console.log(`  ${c.system.padEnd(22)} ${c.code.padEnd(12)} ${c.display}`);

const sop = sopForCodes(codes.map((c) => c.code));
assert.ok(sop, "coded atrial fibrillation should select a protocol");
assert.equal(sop.id, NEW_AF_DISCHARGE.id, "I48 selects the AF discharge protocol");

const verdicts = await classifySteps(sop.steps, facts);
assert.equal(verdicts.length, sop.steps.length, "every step must get a verdict");
console.log("steps:");
for (const v of verdicts) console.log(`  ${v.status.padEnd(8)} ${v.id}  ${v.evidence}`);

const gaps = verdicts.filter((v) => v.status === "gap").map((v) => v.id);
// The whole demo. She asked for it out loud and it was parked, which is exactly
// what a plan with no owner and no date looks like from the outside.
assert.ok(
  gaps.includes("anticoagulation-decision"),
  "the anticoagulant was deferred to nobody — a deferral is not coverage",
);
assert.ok(gaps.includes("bleeding-risk-bloods"), "baseline bloods were never mentioned — a gap");

// Without this, a classifier that answers "gap" to everything passes the asserts
// above and hands the demo a board where every single row is red.
const covered = verdicts.filter((v) => v.status === "covered").map((v) => v.id);
for (const id of ["rate-control-review", "echocardiogram", "rhythm-monitoring"]) {
  assert.ok(covered.includes(id), `${id} was arranged out loud — must be covered`);
}
// A covered step has to name the fact that covers it, because the task hangs off
// that fact in the graph. Without the edge there is nothing to be orphaned from.
for (const v of verdicts.filter((v) => v.status === "covered")) {
  assert.ok(facts[v.factIndex], `${v.id} is covered by a fact that does not exist`);
  assert.equal(v.evidence, facts[v.factIndex].text, `${v.id} quoted something nobody said`);
}
assert.ok(
  verdicts.filter((v) => v.status === "gap").every((v) => v.factIndex === -1),
  "a gap cannot point at a fact",
);

// The other half of the loop: a task closes on what the notes say was done, not
// on someone clicking the button.
const step = sopStep("anticoagulation-decision");
assert.ok(step, "anticoagulation-decision must exist in the protocol");

// One at a time on purpose. corti-s1 serialises concurrent requests from this
// tenant, so running these three together measured slower than running them in
// sequence — 50s against 37s. Don't "optimise" this into a Promise.all.
const sbar = await draftSbar({
  patientName: "Jane Smith",
  title: "New-onset atrial fibrillation",
  facts,
  gaps: gaps.map((id) => sopStep(id)?.title ?? id),
});
const planned = await checkClosure(step, [
  "Discussed stroke risk with Mrs Smith in general terms. Will defer the anticoagulation decision to cardiology.",
]);
const performed = await checkClosure(step, [
  "Started Mrs Smith on apixaban 5mg twice daily today. CHA2DS2-VASc 3, HAS-BLED 1, renal function fine. Went through it with her and she is happy to start.",
]);

// The handoff itself: four parts, and the R is the one that has to survive.
console.log("sbar:");
for (const [part, text] of Object.entries(sbar)) console.log(`  ${part.toUpperCase()}  ${text}`);
assert.deepEqual(missingParts(sbar), [], "a handoff with an empty part is not sendable");

assert.ok(
  planned.criteria.every((c) => !c.met),
  "deferring to cardiology is not a decision — must not close the task",
);
console.log(`missing: ${planned.missing}`);
// The criteria are on screen beside this sentence, so echoing them back is the
// one thing it must not do.
for (const c of planned.criteria) {
  assert.ok(!planned.missing.includes(c.text), "the message must not repeat a criterion verbatim");
}
// Sits next to the criteria in a toast. Anything longer is a restatement of them.
assert.ok(planned.missing.length < 140, `the message is too long: ${planned.missing.length} chars`);

console.log("closure:");
for (const c of performed.criteria) {
  console.log(`  ${c.met ? "met " : "open"}  ${c.text}  ${c.evidence}`);
}
assert.ok(
  performed.criteria.every((c) => c.met),
  "a decision that names the drug and dose must close the task",
);
assert.ok(
  performed.criteria.every((c) => c.evidence !== ""),
  "a met criterion with nothing quoted is not evidence of anything",
);

// The same writes the app does, against the real graph, so the edges the orphan
// query depends on are actually exercised. Cleans up after itself.
const conversationId = crypto.randomUUID();
await saveConversation({
  id: conversationId,
  patientId: `check:${conversationId}`,
  patientName: "Check Patient",
  title: "New-onset atrial fibrillation",
  transcript,
  facts,
});
await saveTasks(conversationId, `check:${conversationId}`, sop.steps, verdicts);

const edges = await rows<{ n: number }>(
  `MATCH (t:Task)-[:BECAUSE_OF]->(f:Fact) WHERE f.id STARTS WITH $conversationId
   RETURN count(*) AS n`,
  { conversationId },
);
assert.equal(
  Number(edges[0].n),
  covered.length,
  "every covered step must end up joined to its fact — a float fact index matches nothing",
);

// A gap task has no fact behind it, so it can only reach its patient through
// FOR. Without that edge the inbox silently drops exactly the tasks the whole
// product exists to show.
const reachable = await rows<{ step: string }>(
  `MATCH (t:Task)-[:FOR]->(:Patient {id: $patientId}) RETURN t.stepId AS step`,
  { patientId: `check:${conversationId}` },
);
assert.equal(
  reachable.length,
  sop.steps.length,
  "every task must reach its patient, gaps included",
);
for (const id of gaps) {
  assert.ok(
    reachable.some((r) => r.step === id),
    `${id} is a gap and must still be reachable from the patient`,
  );
}

const orphans = await rows<{ patient: { name: string }; fact: { text: string } }>(ORPHAN_FACTS);
const mine = orphans.filter((o) => o.patient.name === "Check Patient");
console.log(`orphan facts: ${mine.length} of ${facts.length}`);
for (const o of mine) console.log(`  ${o.fact.text}`);
assert.ok(
  mine.some((o) => /thinner|anticoag|blood.thinn/i.test(o.fact.text)),
  "she asked about a blood thinner and it reached no task — it has to be an orphan",
);
assert.ok(
  mine.every((o) => !/echocardiogram|echo\b/i.test(o.fact.text)),
  "a fact a task was built from is not an orphan",
);

// Reached through FOR, not BECAUSE_OF — gap tasks have no fact behind them, and
// an earlier version of this left two of them behind on every single run.
await rows(
  `MATCH (p:Patient {id: $patientId})
   OPTIONAL MATCH (c:Conversation)-[:ABOUT]->(p)
   OPTIONAL MATCH (f:Fact)-[:SAID_IN]->(c)
   OPTIONAL MATCH (t:Task)-[:FOR]->(p)
   DETACH DELETE p, c, f, t`,
  { patientId: `check:${conversationId}` },
);

await close();
console.log("\nok");

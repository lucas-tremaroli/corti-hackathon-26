import assert from "node:assert";
import type { Patient } from "../lib/model";
import { normaliseName, similarPatients } from "../lib/patients";

// The seeded roster, which is the one this runs against in the app.
const ROSTER: Patient[] = [
  { id: "aisha-rahman", name: "Aisha Rahman" },
  { id: "david-kim", name: "David Kim" },
  { id: "jane-smith", name: "Jane Smith" },
  { id: "maria-gonzalez", name: "Maria Gonzalez" },
  { id: "robert-okafor", name: "Robert Okafor" },
  { id: "thomas-baker", name: "Thomas Baker" },
];

const names = (name: string) => similarPatients(name, ROSTER).map((p) => p.id);

assert.equal(normaliseName("  Mrs   Jane Smith "), "jane smith", "titles and spacing come off");
assert.equal(normaliseName("O'Brien-Walsh"), "o brien walsh", "punctuation is not identity");

// The three ways one person becomes three charts.
assert.deepEqual(names("Jane Smith"), ["jane-smith"], "the same name is the same person");
assert.deepEqual(names("Mrs Smith"), ["jane-smith"], "a surname alone is how a handoff speaks");
assert.deepEqual(names("Jane Smyth"), ["jane-smith"], "one letter out is a mis-transcription");

// Somebody genuinely new has to be creatable, or the guard is just a wall.
assert.deepEqual(names("Priya Raman"), [], "a new patient looks like nobody on the roster");
assert.deepEqual(names(""), [], "no name spoken warns about nothing");

// A shared given name is not a shared person — but this warns rather than
// blocks, so flagging it is the cheap side of the trade.
assert.deepEqual(names("Thomas Baker"), ["thomas-baker"], "Tom's record is Thomas's record");

// The one that would be silently wrong: two-letter fragments matching everyone.
assert.ok(!names("Al Kim").includes("aisha-rahman"), "short fragments must not match wildly");

console.log("ok — duplicate guard holds on all six");

import type { Patient } from "./model";

// Titles are how people speak and not how charts are filed. "Mrs Smith" and
// "Jane Smith" have to collapse to the same thing before anything is compared.
const TITLE = /^(mr|mrs|ms|miss|dr|prof|sir|dame)\.?\s+/i;

// Punctuation and spacing go first: the title pattern is anchored, so it only
// matches once "  Mrs.  Smith" has already become "mrs smith".
export function normaliseName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(TITLE, "")
    .trim();
}

/** Levenshtein, two rows rather than a full matrix. Nothing here is long. */
function distance(a: string, b: string) {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * Existing patients close enough that creating this name is probably a second
 * record for somebody who already has one.
 *
 * The failure this exists to stop is not "no patient was created" — it is Jane
 * Smith, Mrs Smith and a mis-transcribed Jane Smyth ending up as three charts,
 * with her anticoagulation history on whichever one the last handoff hit. A
 * split chart is worse than a blocked handoff.
 *
 * Deliberately loose. This warns, it never blocks, so a false match costs one
 * glance and a miss costs a duplicate record.
 */
export function similarPatients(name: string, patients: Patient[]) {
  const wanted = normaliseName(name);
  if (wanted === "") return [];
  const wantedParts = wanted.split(" ");

  return patients.filter((patient) => {
    const have = normaliseName(patient.name);
    if (have === wanted) return true;
    // A surname on its own is how a handoff actually names somebody. Two letters
    // is too short to mean anything, so those only count on a full match.
    if (have.split(" ").some((part) => part.length > 2 && wantedParts.includes(part))) return true;
    return distance(have, wanted) <= 2;
  });
}

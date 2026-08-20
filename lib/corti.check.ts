import assert from "node:assert";
import { cortiFetch, getToken } from "./corti";

const [a, b] = await Promise.all([getToken(), getToken()]);
assert.equal(a, b, "concurrent callers must share one in-flight mint");
assert.equal(await getToken(), a, "second call must hit the cache");
assert.ok(a.length > 100, "token looks too short");

const { facts } = await cortiFetch<{ facts: { group: string; text: string }[] }>(
  "/tools/extract-facts",
  {
    method: "POST",
    body: JSON.stringify({
      context: [{ type: "text", text: "Patient reports morning dizziness on standing. Lives alone." }],
      outputLanguage: "en",
    }),
  },
);
assert.ok(facts.length > 0, "extract-facts returned nothing");

console.log(`ok — token cached, ${facts.length} facts:`);
for (const f of facts) console.log(`  ${f.group}: ${f.text}`);

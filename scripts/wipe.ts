import { close, rows } from "../lib/graph";

// Everything goes, clinicians included — db-seed is how you get those back.
//
// Through lib/graph rather than `docker compose exec cypher-shell`, so it can
// only ever empty the database NEO4J_URI actually points at. A delete-everything
// that quietly targets the local container while the app talks to somewhere else
// is the one mistake worth spending an import on.
const [before] = await rows<{ nodes: number; rels: number }>(
  "MATCH (n) OPTIONAL MATCH (n)-[r]->() RETURN count(DISTINCT n) AS nodes, count(r) AS rels",
);

await rows("MATCH (n) DETACH DELETE n");

console.log(`deleted ${Number(before.nodes)} nodes, ${Number(before.rels)} relationships`);
console.log("constraints are untouched — run `mise run db-seed` to get the people back");

await close();

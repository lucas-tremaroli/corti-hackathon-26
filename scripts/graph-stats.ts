import { close, rows } from "../lib/graph";
import { unclaimed } from "../lib/queries";

// What /graph is about to draw, without opening a browser. Counts arrive as
// Neo4j Integers, hence Number() on every one of them.
const nodes = await rows<{ label: string; n: number }>(
  "MATCH (n) RETURN labels(n)[0] AS label, count(*) AS n ORDER BY n DESC, label",
);
const edges = await rows<{ type: string; n: number }>(
  "MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS n ORDER BY n DESC, type",
);

// The predicate itself, imported rather than retyped — this number has to be the
// one the graph draws hollow, or the check is worth nothing.
const [gaps] = await rows<{ n: number }>(
  `MATCH (f:Fact) WHERE ${unclaimed("f")} RETURN count(f) AS n`,
);

const total = (rowsIn: { n: number }[]) => rowsIn.reduce((sum, r) => sum + Number(r.n), 0);

if (nodes.length === 0) {
  console.log("the graph is empty — `mise run db-seed` puts the people back");
} else {
  console.log("nodes");
  for (const row of nodes) console.log(`  ${String(Number(row.n)).padStart(4)}  ${row.label}`);
  console.log("relationships");
  for (const row of edges) console.log(`  ${String(Number(row.n)).padStart(4)}  ${row.type}`);
  console.log(
    `\n${total(nodes)} nodes, ${total(edges)} relationships, ` +
      `${Number(gaps.n)} said and nothing came of it`,
  );
}

await close();

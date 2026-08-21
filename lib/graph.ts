import neo4j, { type EagerResult, type RecordShape } from "neo4j-driver";

function cfg() {
  const uri = process.env.NEO4J_URI;
  const password = process.env.NEO4J_PASSWORD;
  if (!uri || !password) throw new Error("Missing NEO4J_URI / NEO4J_PASSWORD — see .env");
  return { uri, user: process.env.NEO4J_USER ?? "neo4j", password };
}

// One driver for the process — it owns a connection pool, so a second one per
// request is the documented way to run out of connections.
let driver: ReturnType<typeof neo4j.driver> | null = null;

function graph() {
  if (!driver) {
    const { uri, user, password } = cfg();
    driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }
  return driver;
}

/** Rows as plain objects. `executeQuery` already owns sessions and retries. */
export async function rows<T extends RecordShape>(cypher: string, params = {}) {
  // The generic is the whole result, not the row — hence EagerResult<T>.
  const { records } = await graph().executeQuery<EagerResult<T>>(cypher, params);
  return records.map((record) => record.toObject());
}

/** Scripts hang without this; the Next server never calls it. */
export async function close() {
  await driver?.close();
  driver = null;
}

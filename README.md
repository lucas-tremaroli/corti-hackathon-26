# CareOS

Care handoffs that don't get dropped.

A clinician dictates a handoff. Corti transcribes it, pulls out the facts, codes
the episode, and picks the protocol that the codes imply. Anything the protocol
asks for that nobody said out loud becomes a task with an owner and a date, and
all of it lands in a Neo4j graph the next shift can read, question, and close.

Everything below is how to run that on your own machine.

## What you need

| | |
|---|---|
| [Bun](https://bun.sh) | the package manager and script runner — `packageManager` pins 1.2.23 |
| [Docker](https://docs.docker.com/get-docker/) | runs the local Neo4j, nothing else |
| [mise](https://mise.jdx.dev) | optional; every task below has a plain equivalent |
| Corti credentials | client id and secret for the hackathon tenant |

Corti is not optional and there is no offline mode: transcription, fact
extraction, coding and the agent are all live calls. The app throws on the first
request without them rather than starting up and failing later.

## Environment

Create `.env` in the repo root:

```sh
CORTI_TENANT_NAME=base
CORTI_ENVIRONMENT=eu
CORTI_CLIENT_ID=<your client id>
CORTI_CLIENT_SECRET=<your client secret>

NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=careos-dev
```

`careos-dev` is the password `docker-compose.yml` hands Neo4j. It never leaves
your machine, which is the only reason it is written down.

## First run

```sh
bun install
mise run db-fresh   # or: docker compose up -d && bun scripts/graph-init.ts && bun scripts/seed.ts
bun run dev
```

`db-fresh` goes from any state to a clean seeded graph: it starts the container,
waits for bolt to actually answer, applies the uniqueness constraints, and seeds
two clinicians and eleven patients. It waits because Neo4j accepts connections a
few seconds after Docker reports the container started, and a seed that races
that fails in a way that looks like a config problem.

Then open [localhost:3000](http://localhost:3000).

## Seeing it do something

The seed puts **people** in the graph and nothing else. No facts, no tasks, no
handoffs — those come from a conversation, and until you run one, `/inbox` and
`/graph` are honestly empty and `/assistant` will tell you so. That is correct
behaviour, not a broken install.

To fill it: go to **Handoff** and either dictate one, or press **or use the
dictation on file** under the mic, which feeds `demo/dictated-handoff.txt`
through the same pipeline without needing a microphone. Watch the five steps
run, then commit and send the draft. Now the other three pages have something to
show.

| Page | |
|---|---|
| `/` | Dictate a handoff. Facts, codes, protocol, gaps, SBAR draft |
| `/inbox` | What was handed to you, and the tasks you own |
| `/graph` | The whole thing as nodes and relationships |
| `/assistant` | Ask a Corti agent questions about the board |

## Everyday commands

```sh
mise run dev         # the app on :3000
mise run db-stats    # what is in the graph right now, by label
mise run db-shell    # cypher shell against the local container
mise run db-seed     # back to just the people, conversation and all discarded
mise run db-wipe     # empty graph, clinicians included
mise run db-down     # stop Neo4j, keep the data
mise run db-reset    # stop Neo4j, throw the volume away
```

`mise tasks` lists them with descriptions. Without mise, every one is a line in
`mise.toml` you can paste.

## Checks

```sh
bun run check          # the whole pipeline against live Corti and the graph
bun run check:agent    # the board state the agent reads, every edge asserted
bun run check:patients # name matching — the one duplicate-chart guard
bun run check:graph    # the graph view's layout data
```

`check` is the real one: it runs the demo transcript through extraction, coding,
protocol selection and SBAR drafting, and asserts on what comes back. It costs
Corti credits and takes a while, because it is doing the actual work.

The others are offline or graph-only and take a second. `check:agent` builds one
handoff's worth of graph, reads it back through the agent's query, and deletes
it — it exists because a wrong traversal there fails silently, reporting an
empty ward rather than an error.

## Known blocker: `/chat`

There is a second, unfinished assistant page at `/chat` built on Corti's
embedded web component. It does not work, and the reason is not fixable from
this repo: the embedded app rejects service-account tokens —

```
access_token is missing required claims: email
```

— so it needs a real person's browser login. The authorization-code flow is
already written (`/api/corti/login` → `/api/corti/callback`) and the client
already permits that flow; what is missing is Corti registering
`http://localhost:3000/*` as a valid redirect URI on the client. Until they do,
the authorize URL returns `Invalid parameter: redirect_uri`.

`/assistant` covers the same ground on the service account and needs none of
this. If the redirect URI never arrives, `/chat`, the three routes under
`app/api/corti/` that serve it, and the `@corti/embedded-web` dependency can all
be deleted together.

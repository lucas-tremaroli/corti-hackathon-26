# CareOS

Care handoffs that don't get dropped.

A clinician dictates a handoff. Corti transcribes it, pulls out the facts, codes
the episode, and picks the matching protocol. Anything the protocol asks for
that nobody said out loud becomes a task with an owner and a date — all of it in
a Neo4j graph the next shift can read.

## Stack

- **Next.js 16 + React 19** — the app, Radix Themes for UI
- **Corti SDK** — transcription, fact extraction, coding, the agent
- **Neo4j** — the graph, running in Docker
- **Bun** — package manager and script runner

## Running it

You need [Bun](https://bun.sh), [Docker](https://docs.docker.com/get-docker/),
and Corti credentials. There's no offline mode — every AI call is live.

Create `.env`:

```sh
CORTI_TENANT_NAME=base
CORTI_ENVIRONMENT=eu
CORTI_CLIENT_ID=<your client id>
CORTI_CLIENT_SECRET=<your client secret>

NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=careos-dev
```

Then:

```sh
bun install
docker compose up -d
bun scripts/graph-init.ts   # constraints
bun scripts/seed.ts         # 2 clinicians, 11 patients
bun run dev
```

Give Neo4j a few seconds after `docker compose up` before seeding. Open
[localhost:3000](http://localhost:3000).

> With [mise](https://mise.jdx.dev): `mise run db-fresh` does all three db steps
> and waits properly. `mise tasks` lists the rest.

## Trying it

The seed puts only **people** in the graph, so `/inbox`, `/graph` and
`/assistant` start empty. That's expected.

Go to **Handoff** and either dictate one or press **or use the dictation on
file** under the mic — that runs `demo/dictated-handoff.txt` through the same
pipeline, no microphone needed. Commit and send the draft, and the other pages
fill up.

| Page | |
|---|---|
| `/` | Dictate a handoff → facts, codes, protocol, gaps, SBAR draft |
| `/inbox` | What was handed to you, and the tasks you own |
| `/graph` | The whole thing as nodes and relationships |
| `/assistant` | Ask a Corti agent about the board |

## Checks

```sh
bun run check          # full pipeline against live Corti — slow, costs credits
bun run check:agent    # the board state the agent reads
bun run check:patients # name matching
bun run check:graph    # graph view layout data
```

## Known blocker: `/chat`

An unfinished second assistant page built on Corti's embedded web component. It
rejects service-account tokens (`access_token is missing required claims:
email`), so it needs a real browser login. The auth-code flow is written
(`/api/corti/login` → `/api/corti/callback`); what's missing is Corti
whitelisting `http://localhost:3000/*` as a redirect URI.

`/assistant` covers the same ground without any of it. If the redirect URI never
arrives, `/chat`, `app/api/corti/` and `@corti/embedded-web` can be deleted
together.

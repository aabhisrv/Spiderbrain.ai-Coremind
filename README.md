# SpiderBrain: the understanding layer for your repo

[![conformance](https://github.com/aabhisrv/spiderbrain.ai/actions/workflows/ci.yml/badge.svg)](https://github.com/aabhisrv/spiderbrain.ai/actions/workflows/ci.yml)

A repo tells an AI agent *what* the code is. It never tells it what **matters**, what a
change **reaches**, or **why** anything was built the way it was. So every agent
re-derives the structure from scratch, every session, and gets it a little wrong.

SpiderBrain gives a repo a committed, source-free understanding layer: a deterministic
map of its structure, dependencies, and blast radius that any AI coding agent can read
with zero setup. This repository is the open, MIT-licensed part of that layer: the
reader, and the format specification.

- Website: https://spiderbrain.ai
- Determinism benchmark: https://contextbenchmark.com

## Use it in one line

When a repo carries a `.spiderbrain/` folder, point the reader at it:

```
npx spiderbrain mcp
```

That starts an MCP server your coding agent (Claude Code, Cursor, or any MCP client)
can query. Tools: `sb_blast`, `sb_impact`, `sb_path`, `sb_keystones`, `sb_map`,
`sb_ask`. No account, no SpiderBrain install, no configuration. A real session
transcript is in [examples/agent-session.md](examples/agent-session.md).

Prefer the terminal:

```
npx spiderbrain blast src/server/health.ts   # what a change here reaches
npx spiderbrain impact                        # what YOUR CURRENT DIFF reaches
npx spiderbrain keystones                     # the load-bearing files
npx spiderbrain map src/auth/session.ts       # what a file is + touches
npx spiderbrain path src/a.ts src/b.ts        # how one file reaches another
npx spiderbrain verify                        # folder untampered + current?
```

## Agents are first-class

Every command takes `--json` and emits one machine-readable object, and exit codes
are part of the contract: `0` ok, `1` check failed, `2` usage, `3` no understanding.
CI can gate on them:

```
npx spiderbrain impact --fail-over 200   # fail a PR whose blast exceeds 200 files
npx spiderbrain verify                   # fail a build whose folder is stale or edited
```

Ready-made workflows - a PR blast-radius comment and a freshness gate - are in
[examples/](examples).

## No folder? Registry fallback

When a repo carries no `.spiderbrain/` folder, the reader checks the public
SpiderBrain registry for an **unofficial** brain of the same repo (matched by the
`origin` remote, clearly labeled, fingerprint-verified). The committed folder always
wins when present; maintainers can publish the official one with `npx spiderbrain create`.

## This repo eats its own dogfood

This repository carries its own committed [`.spiderbrain/`](.spiderbrain) folder,
derived from its real import graph (`node scripts/build-own-brain.mjs`, regenerated
deterministically, verified in CI). Clone it and ask it about itself:

```
npx spiderbrain keystones      # read/src/core.mjs is the load-bearing file
npx spiderbrain verify         # the committed fingerprint matches the bytes
```

## Give your own repo understanding

```
export SPIDERBRAIN_API_KEY=sb_live_...     # https://spiderbrain.ai/dashboard?tab=keys
npx spiderbrain create
```

Fetches your scored brain and writes the source-free `.spiderbrain/` folder plus an
`AGENTS.md` block. Commit both, and every agent that later touches the repo reads it.

## Offline vs cloud

- **Offline** (free, deterministic, from the committed bytes): structure, dependencies,
  blast radius, keystones. Same repo, same question, same answer, byte for byte.
- **Cloud** (set `SPIDERBRAIN_API_KEY`): the *why* behind a file (the recorded decision
  and its reasoning), always-fresh scores, and semantic search. Get a key at
  https://spiderbrain.ai/dashboard?tab=keys.

```
export SPIDERBRAIN_API_KEY=sb_live_...
npx spiderbrain why src/billing/charge.ts
```

## What is in the folder

The committed `.spiderbrain/` folder is **source-free**: file paths, structure, and an
edge-derivable blast radius only. Never your source code. Never the scoring weights.
Its exact contents and determinism guarantees are documented in [SPEC.md](SPEC.md).

Every folder carries a fingerprint in its `manifest.json`; the reader recomputes it on
load, so a hand-edited or corrupted folder is flagged and the map you query is the map
that was published.

## This repo (three MIT packages + the spec)

- [`spiderbrain/`](spiderbrain) — [`spiderbrain`](https://www.npmjs.com/package/spiderbrain),
  the one command. A thin dispatcher over the two below.
- [`read/`](read) — [`@spiderbrain/read`](https://www.npmjs.com/package/@spiderbrain/read),
  **consume**: folder loader, blast-radius traversal, CLI, MCP server, cloud client. Zero
  dependencies.
- [`create/`](create) — [`@spiderbrain/create`](https://www.npmjs.com/package/@spiderbrain/create),
  **produce**: fetch your scored brain and write the understanding set + `AGENTS.md`.
- [`SPEC.md`](SPEC.md) — the `.spiderbrain/` public folder format.

Each scoped package is independently installable: a CI job that only publishes understanding
needs `@spiderbrain/create` alone; an MCP config that only reads points at `@spiderbrain/read`.
`spiderbrain` is what you type when you just want the thing.

The engine that *scores* a brain (parsing and the scoring model) is proprietary and lives
with SpiderBrain. What is open here is the **format**, the **reader**, and the **producer
client**, so anyone can read or write a published understanding layer, or build a tool that
does.

## License

MIT. See [LICENSE](LICENSE).

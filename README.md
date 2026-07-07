# SpiderBrain: the understanding layer for your repo

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
npx @spiderbrain/read mcp
```

That starts an MCP server your coding agent (Claude Code, Cursor, or any MCP client)
can query. Tools: `sb_blast`, `sb_keystones`, `sb_map`, `sb_ask`. No account, no
SpiderBrain install, no configuration.

Prefer the terminal:

```
npx @spiderbrain/read blast src/server/health.ts   # what a change here reaches
npx @spiderbrain/read keystones                     # the load-bearing files
npx @spiderbrain/read map src/auth/session.ts       # what a file is + touches
```

## Offline vs cloud

- **Offline** (free, deterministic, from the committed bytes): structure, dependencies,
  blast radius, keystones. Same repo, same question, same answer, byte for byte.
- **Cloud** (set `SPIDERBRAIN_API_KEY`): the *why* behind a file (the recorded decision
  and its reasoning), always-fresh scores, and semantic search. Get a key at
  https://spiderbrain.ai/dashboard?tab=keys.

```
export SPIDERBRAIN_API_KEY=sb_live_...
npx @spiderbrain/read why src/billing/charge.ts
```

## What is in the folder

The committed `.spiderbrain/` folder is **source-free**: file paths, structure, and an
edge-derivable blast radius only. Never your source code. Never the scoring weights.
Its exact contents and determinism guarantees are documented in [SPEC.md](SPEC.md).

Every folder carries a fingerprint in its `manifest.json`; the reader recomputes it on
load, so a hand-edited or corrupted folder is flagged and the map you query is the map
that was published.

## This repo

- [`read/`](read) — [`@spiderbrain/read`](https://www.npmjs.com/package/@spiderbrain/read),
  the MIT reader: folder loader, blast-radius traversal, CLI, MCP server, cloud client.
- [`SPEC.md`](SPEC.md) — the `.spiderbrain/` public folder format.

The engine that *produces* a brain (parsing and scoring) is proprietary and lives with
SpiderBrain. What is open here is the **format** and the **reader**, so anyone can read a
published understanding layer, or build a tool that does.

## License

MIT. See [LICENSE](LICENSE).

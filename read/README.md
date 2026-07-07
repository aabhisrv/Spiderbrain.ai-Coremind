# @spiderbrain/read

Use a repo's committed SpiderBrain understanding, offline. When a repo carries a
`.spiderbrain/` folder, this reads it and answers structural questions about the
codebase with zero setup: what a change reaches (blast radius), which files are
load-bearing (keystones), and how any file fits. No account, no SpiderBrain
install. MIT, zero dependencies.

## Use it in one line

As an MCP server for your AI coding agent (Claude Code, Cursor):

```
npx @spiderbrain/read mcp
```

Tools: `sb_blast`, `sb_keystones`, `sb_map`, `sb_ask`. Your agent can now ask what
a change reaches and what matters, from the committed graph, deterministically.

One-off from the terminal:

```
npx @spiderbrain/read blast src/server/health.ts   # what a change here reaches
npx @spiderbrain/read keystones                     # the load-bearing files
npx @spiderbrain/read map src/auth/session.ts       # what a file is + touches
```

## What is offline vs cloud

- Offline (free, deterministic, from the committed `.spiderbrain/` bytes):
  structure, dependencies, blast radius, keystones. Same question, same repo,
  same answer, byte for byte.
- Cloud (set `SPIDERBRAIN_API_KEY`): the why-layer (the decision behind a file),
  always-fresh scores, and semantic search. Get a key at
  https://spiderbrain.ai/dashboard?tab=keys.

```
export SPIDERBRAIN_API_KEY=sb_live_...
npx @spiderbrain/read why src/billing/charge.ts     # the decision + reasoning
```

## Integrity

Every folder carries a fingerprint in `manifest.json`. The reader recomputes it
from `structure.ndjson` on load; a hand-edited or corrupted folder reports a
mismatch, so the map you query is the map that was published.

## What it does not contain

The public understanding set is source-free: file paths, structure, and an
edge-derivable blast radius only. Never your source code, never the scoring
weights. See the repo's `.spiderbrain/manifest.json` for the exact contents.

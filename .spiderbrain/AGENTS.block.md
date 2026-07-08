<!-- spiderbrain:start v=1 fp=690da56ebc9813a3 commit=4738ebe62052d0ae65fc9132ad570d91ccb32c22 -->
## Repo understanding (SpiderBrain)

This repo carries a committed brain in `.spiderbrain/`: a deterministic, source-free map of its
structure, dependencies, and blast radius (35 files, 19 edges). Consult it before
reading files, to know what matters and what a change reaches.

Fastest use (an MCP server for this repo, no SpiderBrain install, no account):
    npx spiderbrain mcp
One-off:
    npx spiderbrain blast <path>     # what a change to <path> reaches
    npx spiderbrain keystones        # the load-bearing files

Keystones (top by reach, precomputed so you get value without installing anything):
- read/src/core.mjs  (reaches 5 files)
- create/src/export.mjs  (reaches 4 files)
- read/src/git.mjs  (reaches 4 files)
- create/src/gitinfo.mjs  (reaches 3 files)
- read/src/cloud.mjs  (reaches 3 files)
- read/src/registry.mjs  (reaches 3 files)
- create/src/fetch.mjs  (reaches 2 files)
- create/src/cli.mjs  (reaches 1 files)

The why (decisions, reasoning, always-fresh scores) is the cloud layer. Set SPIDERBRAIN_API_KEY
(get one at https://spiderbrain.ai/dashboard?tab=keys) and any command above also returns fresh
scores, semantic search, and `sb_why <path>` (the decision behind a file).

Deterministic: this block regenerates byte-identically from commit 4738ebe62052d0ae65fc9132ad570d91ccb32c22 (fingerprint 690da56ebc9813a3).
Do not hand-edit between the markers.
<!-- spiderbrain:end -->

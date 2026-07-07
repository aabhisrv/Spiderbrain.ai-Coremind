# The `.spiderbrain/` folder format

Version 1. A `.spiderbrain/` folder is a committed, source-free understanding layer for a
repository. It is designed to be read by an AI agent with zero setup, to diff cleanly in
review, and to regenerate byte-identically from a given commit.

This document specifies the **public** variant, which is what a public or shared brain
carries. A private in-repo brain may additionally carry a `scores.ndjson` (see the end).

## Design guarantees

- **Source-free.** The folder contains file paths, structure, and an edge-derivable blast
  radius. It never contains source code, file contents, string literals, SQL, or the
  scoring weights.
- **Deterministic.** Every file regenerates byte-identically from the same scored commit.
  Node ids are sorted, arrays within a record are sorted, JSON object keys are serialized
  in sorted order, all counts are integers, and no wall-clock timestamp appears anywhere.
- **Verifiable.** `manifest.json` carries a `graphFingerprint` and per-file hashes. A
  reader recomputes them on load; a hand-edited or corrupted folder is detectable.

## Files

### `manifest.json`

```json
{
  "schemaVersion": 1,
  "variant": "public",
  "privacy": "plain-paths",
  "engineVersion": "v5",
  "scoredFrom": "3efc4cf68a1a",
  "repo": { "name": "example-repo", "commit": null },
  "counts": { "files": 4628, "edges": 1084, "clusters": 9, "masters": 26 },
  "graphFingerprint": "8a5583479440c222",
  "fileHashes": {
    "structure.ndjson": "8a5583479440c222...",
    "AGENTS.block.md": "b60c8ce3d5a9c0e1..."
  },
  "benchmark": { "standard": "context-trust-level", "url": "https://contextbenchmark.com" },
  "ownership": { "owner": "repo", "license": "inherits-repo", "generator": "spiderbrain" }
}
```

| Field | Meaning |
|---|---|
| `schemaVersion` | Format version (this document). |
| `variant` | `public` or `private`. Public omits the weighted scores. |
| `privacy` | `plain-paths` (default) or `hashed-paths` (a detached/public brain may hash paths). |
| `engineVersion` | Engine major line that scored the brain. A short string, never an object. |
| `scoredFrom` | Provenance stamp of the scored source (a content fingerprint). Not a wall-clock. |
| `graphFingerprint` | `sha256(structure.ndjson)`, truncated. The identity of this understanding. |
| `fileHashes` | Full `sha256` per committed file, for integrity. |
| `ownership` | The brain is owned by the repo and inherits its license by default. |

### `structure.ndjson`

One JSON object per line, one per file/node, **sorted by `id`**. Each line is canonical
(object keys in sorted order), so a structural change produces a minimal, readable diff.

```json
{"blastRadius":43,"cluster":"app","contentHash":"a1b2c3d4","dependsOn":["src/db.ts"],"id":"src/auth/session.ts","isMaster":true,"kind":"code","layer":"theta","master":"src/auth/session.ts","role":""}
```

| Field | Meaning |
|---|---|
| `id` | Repo-relative path. The node identity. |
| `kind` | `code`, `config`, `content`, `table`, etc. |
| `role` | `barrel` for pure re-export files, else empty. Barrels are free hops in blast. |
| `layer` | Coarse architectural layer label. |
| `cluster` | The area/module the file belongs to. |
| `isMaster` / `master` | Whether the file is a cluster keystone, and which master it rolls up to. |
| `contentHash` | Short `sha256` of the file content. A presence check, never the content. |
| `blastRadius` | Transitive dependent count. Edge-derivable; carries no scoring weight. |
| `dependsOn` | Sorted list of node ids this file depends on (the forward edges). |

A reader reconstructs the reverse edges (`dependedOnBy`) by inverting `dependsOn` across
the graph, so only the forward direction is committed.

### `AGENTS.block.md`

A delimited Markdown block meant to be merged into the repo's `AGENTS.md` / `CLAUDE.md`
(the files coding agents auto-load). It is bounded by stable markers so it merges without
touching human-authored content and regenerates as a pure replace of the marked region:

```
<!-- spiderbrain:start v=1 fp=<graphFingerprint> commit=<sha> -->
...precomputed keystones, blast notes, and a pointer to the cloud why-layer...
<!-- spiderbrain:end -->
```

The keystones listed inside are ranked by `blastRadius` (edge-derivable reach), never by a
weighted score, so the block leaks no tuning and stays deterministic.

## Computing blast radius (for a reader)

Blast radius is a barrel-aware reach over the reverse edges: stepping onto a `role:"barrel"`
node costs 0 (a re-export is plumbing, not distance), any other step costs 1. The reach is
a unique shortest-cost fixpoint, independent of traversal order, so the result is
deterministic. See [`read/src/core.mjs`](read/src/core.mjs) for the reference implementation.

## What is NOT in the public folder

- Source code, file contents, string literals, comments, SQL. (The producing engine is
  source-free by construction.)
- The weighted scores (`webscore`, `spikescore`, `vibrationscore`, `semantic01`,
  `constitutive01`, `drift`) and any scoring constant. These encode proprietary tuning and
  are available only through the authenticated cloud API, not the committed folder.
- Author identities. Commit authorship is hashed and is not exported.

## The private variant

A private, in-repo brain (a folder committed to a private repository, as private as the
code it maps) may additionally include `scores.ndjson`, one canonical line per node with
the weighted scores. It is never present in a public or detached brain.

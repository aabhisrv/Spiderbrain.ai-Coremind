# @spiderbrain/create

Give a repo its committed SpiderBrain understanding layer. Fetches your scored brain from
the SpiderBrain API and writes a source-free `.spiderbrain/` folder plus an `AGENTS.md`
block, so any AI coding agent that later touches the repo reads it with zero setup.

This is the **produce** side. To **read** a committed folder, see
[`@spiderbrain/read`](https://www.npmjs.com/package/@spiderbrain/read). Most people use the
[`spiderbrain`](https://www.npmjs.com/package/spiderbrain) umbrella command instead of
either directly.

## Use

```
export SPIDERBRAIN_API_KEY=sb_live_...     # get one at https://spiderbrain.ai/dashboard?tab=keys
npx @spiderbrain/create --brain my-project
```

Writes `.spiderbrain/` and merges a SpiderBrain block into `AGENTS.md`. Commit both.

```
spiderbrain-create [--brain <name|id>] [--root .] [--private] [--agents AGENTS.md]
```

- `--brain` — which cloud brain to use (default: the only one on your account).
- `--root` — the repo directory to write into (default: current directory).
- `--private` — include the weighted scores. For a PRIVATE in-repo brain only; a public
  brain must never carry them.
- `--agents` — the agent context file to merge into (default `AGENTS.md`).

## What it writes

A source-free understanding set, documented in the
[format spec](https://github.com/aabhisrv/spiderbrain.ai/blob/main/SPEC.md): `manifest.json`,
`structure.ndjson`, and an `AGENTS.block.md` merged into your `AGENTS.md`. The public
variant contains file paths, structure, and an edge-derivable blast radius only, never your
source and never the scoring weights.

## License

MIT.

# spiderbrain

A committed understanding layer for your repo, and the one command to work with it. A repo
tells an AI agent *what* the code is; it never tells it what **matters**, what a change
**reaches**, or **why** anything was built the way it was. `spiderbrain` fixes that.

- Website: https://spiderbrain.ai
- Format spec + source: https://github.com/aabhisrv/Spiderbrain.ai-Coremind

## Give a repo understanding

```
export SPIDERBRAIN_API_KEY=sb_live_...     # https://spiderbrain.ai/dashboard?tab=keys
npx spiderbrain create
```

Writes a source-free `.spiderbrain/` folder and an `AGENTS.md` block. Commit both.

## Read a repo's understanding (no account needed)

When a repo has a `.spiderbrain/` folder, any agent or developer can use it offline:

```
npx spiderbrain mcp --root .        # an MCP server for Claude Code / Cursor
npx spiderbrain blast src/db.ts     # what a change here reaches
npx spiderbrain impact              # what your current git diff reaches
npx spiderbrain keystones           # the load-bearing files
npx spiderbrain path a.ts b.ts      # how one file reaches another
npx spiderbrain verify --allow-stale   # folder untampered? (CI gate)
```

> An MCP client's working directory is usually not your repository, so pass the repo
> explicitly with `--root <path>`, `--root=<path>`, or the `SPIDERBRAIN_ROOT` environment
> variable. Without it the server serves the working directory and reports that no
> understanding layer was found, which is a wrong answer rather than an error.

Every command takes `--json` (exit codes: 0 ok, 1 failed, 2 usage, 3 no understanding).
No committed folder? The reader falls back to the public registry when the repo's
origin has an unofficial brain there.

## The pieces

`spiderbrain` is a thin dispatcher over two independently installable packages:

- [`@spiderbrain/read`](https://www.npmjs.com/package/@spiderbrain/read) — consume: reader,
  CLI, MCP server. Zero dependencies.
- [`@spiderbrain/create`](https://www.npmjs.com/package/@spiderbrain/create) — produce:
  fetch your scored brain and write the understanding set.

A CI job that only publishes understanding can depend on `@spiderbrain/create` alone; an MCP
config that only reads can point at `@spiderbrain/read`. `spiderbrain` is what you type when
you just want the thing.

## License

MIT.

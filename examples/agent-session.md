# What an agent sees

A real transcript shape: an AI coding agent (Claude Code, Cursor, or any MCP client)
lands on a repo that carries a `.spiderbrain/` folder, starts the server, and knows
what matters before reading a single file.

## MCP config (one line, no account)

```json
{ "mcpServers": { "spiderbrain": { "command": "npx", "args": ["-y", "spiderbrain", "mcp"] } } }
```

## The session

**Agent** is asked: *"rename the config loader and update everything that uses it."*

```
> sb_keystones
Load-bearing files:
  src/config/loader.ts  reaches 214  [code]
  src/db/client.ts      reaches 187  [code]
  src/api/router.ts     reaches 122  [code]
```

The loader is the #1 keystone - the agent now knows this is not a casual rename.

```
> sb_blast { "path": "src/config/loader.ts" }
src/config/loader.ts reaches 214 file(s):
  src/index.ts  (through a barrel)
  src/api/router.ts
  ...
```

```
> sb_impact { "paths": ["src/config/loader.ts", "src/config/schema.ts"] }
2 changed file(s) reach 219 other file(s)
KEYSTONES TOUCHED: src/config/loader.ts
```

The agent scopes its edit plan to the real dependents instead of grepping the world,
and flags the change as high-blast in its summary.

```
> sb_path { "from": "src/billing/charge.ts", "to": "src/config/loader.ts" }
Import chain (3 hops):
  src/billing/charge.ts
  -> src/billing/gateway.ts
  -> src/core/env.ts
  -> src/config/loader.ts
```

*Why is billing coupled to config?* - answered structurally, offline, in milliseconds.

## The same answers in CI

```bash
npx spiderbrain impact --json          # the current diff's blast, machine-readable
npx spiderbrain verify                 # fail the build if the folder is stale/tampered
```

Every answer above is a deterministic function of committed bytes: same repo, same
question, same answer - byte for byte, on every machine, with no account.

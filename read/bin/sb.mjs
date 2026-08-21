#!/usr/bin/env node
/* @spiderbrain/read entry. `sb mcp` starts the MCP server; anything else is CLI. */
import { runCli } from '../src/cli.mjs'
import { startMcp, resolveRoot } from '../src/mcp.mjs'

const argv = process.argv.slice(2)
if (argv[0] === 'mcp') {
  const { root, error } = resolveRoot(argv.slice(1))
  if (error) { process.stderr.write(`spiderbrain-read: ${error}\n`); process.exit(2) }
  startMcp(root)
} else {
  /* `mcp` anywhere but first used to fall through to the CLI, which printed human help and
     exited 0 while the client waited for a JSON-RPC handshake that was never coming. */
  if (argv.includes('mcp')) {
    process.stderr.write('spiderbrain-read: `mcp` must be the first argument, e.g. `sb mcp --root <path>`.\n')
    process.exit(2)
  }
  runCli(argv).then((code) => process.exit(code || 0))
}

#!/usr/bin/env node
/* @spiderbrain/read entry. `sb mcp` starts the MCP server; anything else is CLI. */
import { runCli } from '../src/cli.mjs'
import { startMcp } from '../src/mcp.mjs'

const argv = process.argv.slice(2)
if (argv[0] === 'mcp') {
  const i = argv.indexOf('--root')
  startMcp(i >= 0 && argv[i + 1] ? argv[i + 1] : process.cwd())
} else {
  runCli(argv).then((code) => process.exit(code || 0))
}

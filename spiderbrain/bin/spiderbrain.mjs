#!/usr/bin/env node
/*
 * spiderbrain — the one command. Dispatches to the building blocks:
 *   create            -> @spiderbrain/create  (produce: give a repo understanding)
 *   mcp               -> @spiderbrain/read     (an MCP server for the repo)
 *   blast/keystones/  -> @spiderbrain/read     (read the committed understanding)
 *   map/why/ask
 * MIT.
 */
const HELP = `spiderbrain — a committed understanding layer for your repo

  Consume (from a repo that has a .spiderbrain/ folder):
    spiderbrain mcp                 run an MCP server for AI agents (Claude Code, Cursor)
    spiderbrain blast <path>        what a change to <path> reaches
    spiderbrain keystones           the load-bearing files
    spiderbrain map <path>          what a file is, depends on, and is depended on by
    spiderbrain why <path>          the decision behind a file (needs SPIDERBRAIN_API_KEY)
    spiderbrain ask "<question>"    a natural question

  Produce (give a repo its understanding):
    spiderbrain create              write .spiderbrain/ + AGENTS.md from your cloud brain
                                    (needs SPIDERBRAIN_API_KEY)

  https://spiderbrain.ai
`

const argv = process.argv.slice(2)
const cmd = argv[0]

async function main() {
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { process.stdout.write(HELP); process.exit(0) }
  if (cmd === 'create') {
    const { runCreate } = await import('@spiderbrain/create/cli')
    process.exit((await runCreate(argv.slice(1))) || 0)
  }
  if (cmd === 'mcp') {
    const { startMcp, resolveRoot } = await import('@spiderbrain/read/mcp')
    const { root, error } = resolveRoot(argv.slice(1))
    if (error) { process.stderr.write(`spiderbrain: ${error}\n`); process.exit(2) }
    startMcp(root)
    return // the MCP server keeps the process alive; do not exit
  }
  /* Same trap as the read bin: `mcp` later in argv silently ran the CLI instead. */
  if (argv.includes('mcp')) {
    process.stderr.write('spiderbrain: `mcp` must be the first argument, e.g. `spiderbrain mcp --root <path>`.\n')
    process.exit(2)
  }
  const { runCli } = await import('@spiderbrain/read/cli')
  process.exit((await runCli(argv)) || 0)
}
main()

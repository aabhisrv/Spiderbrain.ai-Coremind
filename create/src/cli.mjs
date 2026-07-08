/* @spiderbrain/create CLI: fetch a scored brain and write the understanding set
 * (.spiderbrain/ + a merged AGENTS.md) into a repo. MIT. */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildUnderstanding, mergeAgents } from './export.mjs'
import { fetchBrain } from './fetch.mjs'
import { readHeadCommit, readOriginOwnerRepo } from './gitinfo.mjs'

const HELP = `spiderbrain create: give a repo its committed understanding layer

  spiderbrain create [--brain <name|id>] [--root .] [--private] [--agents <file>]

  --brain    which cloud brain to use (default: the only one on your account)
  --root     the repo directory to write into (default: current directory)
  --private  include weighted scores (for a PRIVATE in-repo brain only)
  --agents   the agent context file to merge into (default: AGENTS.md)
  --commit   commit sha to stamp as scoredFrom (default: read from .git HEAD)

  Needs SPIDERBRAIN_API_KEY. Writes .spiderbrain/ and merges an AGENTS block.
`

function opt(args, name, dflt) { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt }

export async function runCreate(argv) {
  const args = argv.slice()
  if (args.includes('-h') || args.includes('--help') || args[0] === 'help') { process.stdout.write(HELP); return 0 }
  const root = opt(args, 'root', process.cwd())
  const brainRef = opt(args, 'brain', '')
  const isPrivate = args.includes('--private')
  const agentsFile = opt(args, 'agents', 'AGENTS.md')

  let brain, meta
  try { ({ brain, meta } = await fetchBrain(brainRef)) }
  catch (e) { console.error(`error: ${e.message}`); return 1 }

  // Stamp real provenance: the repo's origin owner/repo and its HEAD commit, read
  // from .git (no git binary needed). Explicit flags/hosted names still win.
  const origin = readOriginOwnerRepo(root)
  const commit = opt(args, 'commit', readHeadCommit(root) || '')
  const repoName = origin ? `${origin.owner}/${origin.repo}` : meta.name

  let built
  try { built = buildUnderstanding(brain, { private: isPrivate, repo: repoName, commit }) }
  catch (e) { console.error(`error: ${e.message}`); return 1 }

  const dir = join(root, '.spiderbrain')
  mkdirSync(dir, { recursive: true })
  for (const [name, contents] of Object.entries(built.files)) writeFileSync(join(dir, name), contents)

  // Merge the AGENTS block into the repo's agent context file.
  const agentsPath = join(root, agentsFile)
  const existing = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : ''
  writeFileSync(agentsPath, mergeAgents(existing, built.files['AGENTS.block.md']))

  const m = built.manifest
  console.log(`Understanding written to ${dir}`)
  console.log(`  ${m.variant} variant, ${m.counts.files} files, fingerprint ${m.graphFingerprint}`)
  console.log(`  merged the SpiderBrain block into ${agentsFile}`)
  console.log(`Commit .spiderbrain/ and ${agentsFile}. Any agent can now: npx spiderbrain mcp`)
  return 0
}

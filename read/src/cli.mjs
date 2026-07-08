/* @spiderbrain/read CLI. Offline structural answers from the committed folder;
 * unofficial registry fallback when a repo carries none; cloud why-layer when
 * SPIDERBRAIN_API_KEY is set. MIT, zero deps.
 *
 * Agent equality: every command takes --json and emits one machine-readable JSON
 * object on stdout. Exit codes are part of the contract:
 *   0  success
 *   1  check failed (verify problems, --fail-over exceeded, path/file not found)
 *   2  usage error (bad command or missing argument)
 *   3  no understanding available (no committed folder AND no registry brain)
 */
import { spawnSync } from 'node:child_process'
import { loadBrain, blast, keystones, describe, impact, pathBetween, verify } from './core.mjs'
import { fetchRegistryBrainFor, REGISTRY_NOTICE } from './registry.mjs'
import { readHeadCommit } from './git.mjs'
import { hasKey, cloudAsk, UPSELL } from './cloud.mjs'

const HELP = `spiderbrain: use a repo's committed understanding (.spiderbrain/)

  blast <path>           what a change to <path> reaches (transitive dependents)
  impact [paths...]      what the CURRENT CHANGE reaches (defaults to git diff)
                           --staged          use staged changes instead
                           --fail-over <n>   exit 1 if the reach exceeds n files
  keystones [n]          the load-bearing files (default 10)
  map <path>             what a file is, depends on, and is depended on by
  path <from> <to>       the shortest dependency path between two files
  verify                 check the folder: hashes + fingerprint + freshness vs HEAD
                           --allow-stale     do not fail when HEAD moved past the brain
  why <path>             the decision behind a file (needs SPIDERBRAIN_API_KEY)
  ask "<question>"       natural question (offline routing; richer with a key)
  mcp                    run as an MCP server (stdio) for Claude Code / Cursor

  --root <dir>           repo root (default: cwd)
  --json                 machine-readable output (agents: use this + exit codes)

  exit codes: 0 ok · 1 check failed / not found · 2 usage · 3 no understanding
`

const FUNNEL = `This repo has no committed understanding layer yet (no .spiderbrain/ folder,
and no registry brain for its remote). Give it one:

  export SPIDERBRAIN_API_KEY=sb_live_...   # https://spiderbrain.ai/dashboard?tab=keys
  npx spiderbrain create

Then commit .spiderbrain/ and AGENTS.md - every agent that touches the repo reads it.`

function opt(args, name, dflt) { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt }
const positional = (args) => args.filter((a, i) => !a.startsWith('--') && (i === 0 || args[i - 1] !== '--root' && args[i - 1] !== '--fail-over'))

/** git diff file list for `impact` with no explicit paths. */
function changedFromGit(rootDir, staged) {
  const a = staged ? ['diff', '--cached', '--name-only'] : ['diff', 'HEAD', '--name-only']
  const r = spawnSync('git', a, { cwd: rootDir, encoding: 'utf8' })
  if (r.status !== 0) return null
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
}

/** Load the committed brain, else fall back to the public registry (unofficial).
 *  Only a MISSING folder falls back - a present-but-corrupt folder must surface as
 *  corruption, never be silently papered over with a registry copy. */
async function loadWithFallback(rootDir, json) {
  try { return loadBrain(rootDir) } catch (e) {
    if (!String(e && e.message).startsWith('no understanding found')) {
      console.error(`corrupt .spiderbrain/ folder: ${e.message}`)
      return 'corrupt'
    }
  }
  const reg = await fetchRegistryBrainFor(rootDir)
  if (reg) { if (!json) console.error(REGISTRY_NOTICE(reg)); return reg }
  return null
}

export async function runCli(argv) {
  const args = argv.slice()
  const cmd = args.shift()
  const json = args.includes('--json')
  const out = (obj, human) => { if (json) process.stdout.write(JSON.stringify(obj) + '\n'); else if (human) console.log(human) }

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { process.stdout.write(HELP); return 0 }
  const rootDir = opt(args, 'root', process.cwd())

  // verify reads the folder directly (it must report a broken folder, not throw on it)
  if (cmd === 'verify') {
    const head = readHeadCommit(rootDir)
    const v = verify(rootDir, { headCommit: head })
    const allowStale = args.includes('--allow-stale')
    const staleOnly = !v.ok && v.problems.every((p) => p.includes('stale'))
    const ok = v.ok || (allowStale && staleOnly)
    if (json) process.stdout.write(JSON.stringify({ ...v, ok }) + '\n')
    else {
      console.log(ok ? `verified: fingerprint ${v.fingerprint}${v.current === true ? ', current at HEAD' : v.current === false ? ' (stale allowed)' : ''}` : 'verification FAILED:')
      for (const p of v.problems) console.log(`  - ${p}`)
    }
    return ok ? 0 : 1
  }

  const b = await loadWithFallback(rootDir, json)
  if (b === 'corrupt') {
    if (json) process.stdout.write(JSON.stringify({ error: 'corrupt_folder', hint: 'regenerate with: npx spiderbrain create' }) + '\n')
    return 1
  }
  if (!b) {
    if (json) process.stdout.write(JSON.stringify({ error: 'no_understanding', hint: 'npx spiderbrain create' }) + '\n')
    else console.error(FUNNEL)
    return 3
  }
  if (b.integrity === 'MISMATCH' && !json) console.error('warning: committed fingerprint does not match structure.ndjson (folder may be hand-edited or stale)')
  const brainRef = b.manifest?.repo?.name || b.manifest?.scoredFrom || 'this-repo'

  if (cmd === 'blast') {
    const p = positional(args)[0]
    if (!p) { console.error('usage: spiderbrain blast <path>'); return 2 }
    const r = blast(b.nodes, p)
    if (!r.found) { out({ ...r, error: 'not_in_brain' }); if (!json) console.error(`not in this brain: ${p}`); return 1 }
    out(r, `${p} reaches ${r.count} file(s):\n` + r.reached.map((x) => `  ${x.id}${x.cost === 0 ? '  (through a barrel)' : ''}`).join('\n'))
    return 0
  }

  if (cmd === 'impact') {
    const staged = args.includes('--staged')
    let paths = positional(args)
    if (!paths.length) {
      paths = changedFromGit(rootDir, staged)
      if (paths === null) { console.error('impact: not a git repository (or git is unavailable); pass paths explicitly'); return 2 }
    }
    if (!paths.length) { out({ changed: [], reachedCount: 0, reached: [], keystonesTouched: [] }, 'no changes detected'); return 0 }
    const r = impact(b.nodes, b.ids, paths)
    const failOver = Number(opt(args, 'fail-over', NaN))
    const failed = Number.isFinite(failOver) && r.reachedCount > failOver
    if (json) process.stdout.write(JSON.stringify({ ...r, failOver: Number.isFinite(failOver) ? failOver : null, failed }) + '\n')
    else {
      console.log(`${r.changed.length} changed file(s) reach ${r.reachedCount} other file(s)`)
      if (r.keystonesTouched.length) console.log(`KEYSTONES TOUCHED: ${r.keystonesTouched.join(', ')}`)
      for (const c of r.changed) console.log(`  ${c.path}  ${c.found ? `reaches ${c.reaches}${c.keystone ? '  [keystone]' : ''}` : '(not in brain: new or renamed)'}`)
      if (failed) console.log(`FAIL: reach ${r.reachedCount} exceeds --fail-over ${failOver}`)
    }
    return failed ? 1 : 0
  }

  if (cmd === 'keystones') {
    const n = Number(positional(args)[0]) || 10
    const ks = keystones(b.nodes, b.ids, n)
    out({ keystones: ks }, `Load-bearing files (top ${ks.length} by reach):\n` + ks.map((k) => `  ${k.id}  reaches ${k.reach}  [${k.kind}]`).join('\n'))
    return 0
  }

  if (cmd === 'map') {
    const p = positional(args)[0]
    if (!p) { console.error('usage: spiderbrain map <path>'); return 2 }
    const d = describe(b.nodes, p)
    if (!d.found) { out(d); if (!json) console.error(`not in this brain: ${p}`); return 1 }
    out(d, JSON.stringify(d, null, 2))
    return 0
  }

  if (cmd === 'path') {
    const [from, to] = positional(args)
    if (!from || !to) { console.error('usage: spiderbrain path <from> <to>'); return 2 }
    const r = pathBetween(b.nodes, from, to)
    if (!r.found) {
      out(r)
      if (!json) console.error(r.missing?.length ? `not in this brain: ${r.missing.join(', ')}` : `no dependency path between ${from} and ${to}`)
      return 1
    }
    out(r, `${r.direction === 'imports' ? 'import chain' : 'dependent chain'} (${r.path.length - 1} hop${r.path.length === 2 ? '' : 's'}):\n  ` + r.path.join('\n  -> '))
    return 0
  }

  if (cmd === 'why') {
    const p = positional(args)[0]
    if (!p) { console.error('usage: spiderbrain why <path>'); return 2 }
    if (!hasKey()) { out({ error: 'no_key', upsell: UPSELL }, `No offline decision data (the why-layer is cloud-only).\n${UPSELL}`); return 0 }
    const res = await cloudAsk({ brainRef, question: 'why does this file matter', path: p })
    if (!res.ok) { out({ error: res.reason }, `Could not reach the why-layer (${res.reason}).\n${UPSELL}`); return 0 }
    out({ answer: res.answer }, typeof res.answer === 'string' ? res.answer : JSON.stringify(res.answer, null, 2))
    return 0
  }

  if (cmd === 'ask') {
    const q = positional(args)[0] || ''
    const lq = q.toLowerCase()
    if (/\b(break|breaks|reach|impact|blast|affect)\b/.test(lq)) {
      const p = b.ids.find((id) => q.includes(id))
      if (p) return runCli(['blast', p, '--root', rootDir, ...(json ? ['--json'] : [])])
    }
    if (/\b(keystone|important|load.bearing|matters most|critical)\b/.test(lq)) return runCli(['keystones', '--root', rootDir, ...(json ? ['--json'] : [])])
    if (hasKey()) {
      const res = await cloudAsk({ brainRef, question: q })
      if (res.ok) { out({ answer: res.answer }, typeof res.answer === 'string' ? res.answer : JSON.stringify(res.answer, null, 2)); return 0 }
    }
    out({ error: 'offline_only', upsell: UPSELL }, `I can answer structure offline (try: spiderbrain blast <path>, spiderbrain keystones, spiderbrain impact).\nFor semantic questions and the why, ${UPSELL}`)
    return 0
  }

  console.error(`unknown command: ${cmd}\n\n${HELP}`)
  return 2
}

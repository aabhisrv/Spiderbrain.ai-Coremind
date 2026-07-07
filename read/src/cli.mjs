/* @spiderbrain/read CLI. Offline structural answers from the committed folder;
 * cloud why-layer when SPIDERBRAIN_API_KEY is set. MIT, zero deps. */
import { loadBrain, blast, keystones, describe } from './core.mjs'
import { hasKey, cloudAsk, UPSELL } from './cloud.mjs'

const HELP = `spiderbrain-read: use a repo's committed understanding (.spiderbrain/)

  sb blast <path>        what a change to <path> reaches (transitive dependents)
  sb keystones [n]       the load-bearing files (default 10)
  sb map <path>          what a file is, depends on, and is depended on by
  sb why <path>          the decision behind a file (needs SPIDERBRAIN_API_KEY)
  sb ask "<question>"    natural question (offline routing; richer with a key)
  sb mcp                 run as an MCP server (stdio) for Claude Code / Cursor

  --root <dir>           repo root (default: cwd)
`

function root(args) {
  const i = args.indexOf('--root')
  return i >= 0 && args[i + 1] ? args[i + 1] : process.cwd()
}

export async function runCli(argv) {
  const args = argv.slice()
  const cmd = args.shift()
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { process.stdout.write(HELP); return 0 }

  let b
  try { b = loadBrain(root(args)) } catch (e) { console.error(e.message); return 1 }
  if (b.integrity === 'MISMATCH') console.error('warning: committed fingerprint does not match structure.ndjson (folder may be hand-edited or stale)')
  const brainRef = b.manifest?.repo?.name || b.manifest?.scoredFrom || 'this-repo'

  if (cmd === 'blast') {
    const p = args.find((a) => !a.startsWith('--'))
    if (!p) { console.error('usage: sb blast <path>'); return 2 }
    const r = blast(b.nodes, p)
    if (!r.found) { console.error(`not in this brain: ${p}`); return 1 }
    console.log(`${p} reaches ${r.count} file(s):`)
    for (const x of r.reached) console.log(`  ${x.id}${x.cost === 0 ? '  (through a barrel)' : ''}`)
    return 0
  }
  if (cmd === 'keystones') {
    const n = Number(args.find((a) => /^\d+$/.test(a))) || 10
    const ks = keystones(b.nodes, b.ids, n)
    console.log(`Load-bearing files (top ${ks.length} by reach):`)
    for (const k of ks) console.log(`  ${k.id}  reaches ${k.reach}  [${k.kind}]`)
    return 0
  }
  if (cmd === 'map') {
    const p = args.find((a) => !a.startsWith('--'))
    if (!p) { console.error('usage: sb map <path>'); return 2 }
    const d = describe(b.nodes, p)
    if (!d.found) { console.error(`not in this brain: ${p}`); return 1 }
    console.log(JSON.stringify(d, null, 2))
    return 0
  }
  if (cmd === 'why') {
    const p = args.find((a) => !a.startsWith('--'))
    if (!p) { console.error('usage: sb why <path>'); return 2 }
    if (!hasKey()) { console.log(`No offline decision data (the why-layer is cloud-only).\n${UPSELL}`); return 0 }
    const res = await cloudAsk({ brainRef, question: 'why does this file matter', path: p })
    if (!res.ok) { console.log(`Could not reach the why-layer (${res.reason}).\n${UPSELL}`); return 0 }
    console.log(typeof res.answer === 'string' ? res.answer : JSON.stringify(res.answer, null, 2))
    return 0
  }
  if (cmd === 'ask') {
    const q = args.find((a) => !a.startsWith('--')) || ''
    // Offline routing: blast/keystone questions answer from committed bytes.
    const lq = q.toLowerCase()
    if (/\b(break|breaks|reach|impact|blast|affect)\b/.test(lq)) {
      const p = b.ids.find((id) => q.includes(id))
      if (p) return runCli(['blast', p, '--root', root(args)])
    }
    if (/\b(keystone|important|load.bearing|matters most|critical)\b/.test(lq)) return runCli(['keystones', '--root', root(args)])
    if (hasKey()) {
      const res = await cloudAsk({ brainRef, question: q })
      if (res.ok) { console.log(typeof res.answer === 'string' ? res.answer : JSON.stringify(res.answer, null, 2)); return 0 }
    }
    console.log(`I can answer structure offline (try: sb blast <path>, sb keystones).\nFor semantic questions and the why, ${UPSELL}`)
    return 0
  }
  console.error(`unknown command: ${cmd}\n\n${HELP}`)
  return 2
}

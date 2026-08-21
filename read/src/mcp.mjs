/* Minimal MCP server (stdio, newline-delimited JSON-RPC 2.0). Zero deps, so
 * `npx @spiderbrain/read mcp` starts instantly. Turns a repo's committed
 * .spiderbrain/ folder into a queryable tool for Claude Code / Cursor. */
import { loadBrain, blast, keystones, describe, impact, pathBetween, verify } from './core.mjs'
/* Read the version from the manifest rather than restating it. The published 0.2.1
 * tarball reported 0.2.0 here, so every MCP client that ever connected was shown a
 * version its own package.json contradicted. createRequire resolves ../package.json
 * from the published layout (package/src/mcp.mjs beside package/package.json). */
import { createRequire } from 'node:module'
const PKG_VERSION = createRequire(import.meta.url)('../package.json').version
import { fetchRegistryBrainFor, REGISTRY_NOTICE } from './registry.mjs'
import { readHeadCommit } from './git.mjs'
import { hasKey, cloudAsk, UPSELL } from './cloud.mjs'

const TOOLS = [
  { name: 'sb_blast', description: 'What a change to a file reaches (its transitive dependents / blast radius), computed deterministically from the committed graph.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'repo-relative file path' } }, required: ['path'] } },
  { name: 'sb_impact', description: 'What a CHANGE SET reaches: the union blast of several changed files, plus which changed files are keystones. Use before/while editing to know the consequences.', inputSchema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' }, description: 'repo-relative paths of the changed files' } }, required: ['paths'] } },
  { name: 'sb_path', description: 'The shortest dependency path between two files: how does one reach the other (import chain or dependent chain).', inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } },
  { name: 'sb_keystones', description: 'The load-bearing files, ranked by how many files they reach.', inputSchema: { type: 'object', properties: { n: { type: 'number', default: 10 } } } },
  { name: 'sb_map', description: 'What a file is, what it depends on, and what depends on it.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'sb_ask', description: 'Ask about the repo. Structure is answered offline; the why-layer needs a SpiderBrain API key.', inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } },
]

/* Every tool result goes through text(), which is why the trust banner is applied here
   rather than in each of the seven tools. A caller that forgets to prepend it cannot exist. */
let trustBanner = ''
const text = (s) => ({ content: [{ type: 'text', text: trustBanner ? trustBanner + s : s }] })

/* What the agent is told before any answer, when the folder cannot be trusted at face value.
   Deliberately blunt: an agent acting on a tampered or stale graph will make confident wrong
   edits, and the CLI already says this out loud on the same inputs. */
function buildTrustBanner(b, rootDir) {
  if (!b) return ''
  const lines = []
  if (b.integrity === 'MISMATCH') {
    lines.push('WARNING: this brain FAILS its own integrity check. The committed fingerprint does not match structure.ndjson, so the folder was hand-edited, corrupted, or partially written. Treat every answer below as unverified.')
  }
  try {
    /* verify() is intentionally git-free: it takes headCommit from opts and never reads .git.
       Passing it is what the CLI does, and omitting it made current always null, so the
       staleness half of this banner silently never fired. Caught by testing the banner
       against a genuinely stale brain rather than assuming it worked. */
    const v = verify(rootDir, { headCommit: readHeadCommit(rootDir) })
    if (v && v.current === false) {
      lines.push(`WARNING: this brain is STALE. It was scored at ${String(v.scoredFrom).slice(0, 7)} but HEAD is ${String(v.headCommit).slice(0, 7)}, so it describes older code than the repo currently contains.`)
    }
  } catch { /* verify is advisory here; never let it stop the server answering */ }
  if (b.source === 'registry') {
    lines.push('NOTE: this brain came from the public registry, not from a committed .spiderbrain/ folder in this repo.')
  }
  return lines.length ? lines.join('\n') + '\n\n' : ''
}

/* Resolve which repository the MCP server should serve.
 *
 * Accepts, in precedence order: an explicit --root flag in either spelling, then the
 * SPIDERBRAIN_ROOT environment variable, then the working directory.
 *
 * Both bins previously did `argv.indexOf('--root')` and took `argv[i + 1]`, so `--root=<path>`
 * was invisible and a bare `--root` silently became cwd. Under an MCP client the cwd is rarely
 * the user's repo, so the server started, found nothing, and reported that the repo had no
 * understanding layer. Wrong, and stated confidently.
 *
 * Returns { root, error }. A bare --root is an ERROR rather than a fallback: guessing after an
 * explicit and incomplete instruction is how the original bug stayed invisible. */
export function resolveRoot(argv = [], env = process.env) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--root') {
      const next = argv[i + 1]
      if (!next || next.startsWith('-')) {
        return { root: null, error: '--root was given with no path. Use `--root <path>` or `--root=<path>`, or set SPIDERBRAIN_ROOT.' }
      }
      return { root: next, error: null }
    }
    if (a.startsWith('--root=')) {
      const v = a.slice('--root='.length)
      if (!v) return { root: null, error: '--root= was given with an empty path. Use `--root=<path>`, or set SPIDERBRAIN_ROOT.' }
      return { root: v, error: null }
    }
  }
  const fromEnv = env && env.SPIDERBRAIN_ROOT
  if (fromEnv) return { root: fromEnv, error: null }
  return { root: process.cwd(), error: null }
}

export function startMcp(rootDir) {
  let brain
  /* Remember WHY the load failed. Collapsing every failure into "no brain" told the agent a
     corrupt folder was a missing one, which sends it to `spiderbrain create` when the real
     fix is to regenerate a folder that already exists. */
  let loadError = null
  try {
    brain = loadBrain(rootDir)
  } catch (e) {
    loadError = e
    process.stderr.write(`spiderbrain-read: ${e.message}\n`)
  }
  const folderIsCorrupt = () =>
    !!loadError && !/is missing|no understanding found/i.test(String(loadError.message))
  trustBanner = buildTrustBanner(brain, rootDir)
  // No committed folder: try the public registry (unofficial brain of the same repo)
  // in the background so the server still starts instantly.
  let registryTried = false
  async function ensureBrain() {
    if (brain || registryTried) return
    registryTried = true
    const reg = await fetchRegistryBrainFor(rootDir)
    if (reg) {
      brain = reg
      trustBanner = buildTrustBanner(brain, rootDir)
      process.stderr.write(REGISTRY_NOTICE(reg) + '\n')
    }
  }
  const brainRefOf = () => brain?.manifest?.repo?.name || brain?.manifest?.scoredFrom || 'this-repo'

  async function callTool(name, a = {}) {
    await ensureBrain()
    const brainRef = brainRefOf()
    if (!brain) {
      if (folderIsCorrupt()) {
        return text(`This repo HAS a .spiderbrain/ folder but it could not be read: ${loadError.message}. It is corrupt, not missing. Do not treat this repo as un-analysed. Maintainers: regenerate it with \`npx spiderbrain create\`.`)
      }
      return text('No committed understanding found in this repo (.spiderbrain/ is missing, and the registry has no brain for its remote). Maintainers: npx spiderbrain create')
    }
    if (name === 'sb_blast') {
      const r = blast(brain.nodes, a.path)
      if (!r.found) return text(`Not in this brain: ${a.path}`)
      return text(`${a.path} reaches ${r.count} file(s):\n` + r.reached.map((x) => `  ${x.id}${x.cost === 0 ? ' (through a barrel)' : ''}`).join('\n'))
    }
    if (name === 'sb_impact') {
      const paths = Array.isArray(a.paths) ? a.paths : []
      if (!paths.length) return text('sb_impact needs paths: the repo-relative files of the change set.')
      const r = impact(brain.nodes, brain.ids, paths)
      const lines = [`${r.changed.length} changed file(s) reach ${r.reachedCount} other file(s)`]
      if (r.keystonesTouched.length) lines.push(`KEYSTONES TOUCHED: ${r.keystonesTouched.join(', ')}`)
      for (const c of r.changed) lines.push(`  ${c.path}  ${c.found ? `reaches ${c.reaches}${c.keystone ? '  [keystone]' : ''}` : '(not in brain: new or renamed)'}`)
      if (r.reachedCount) lines.push('reached: ' + r.reached.slice(0, 40).join(', ') + (r.reached.length > 40 ? ` ... +${r.reached.length - 40} more` : ''))
      return text(lines.join('\n'))
    }
    if (name === 'sb_path') {
      const r = pathBetween(brain.nodes, a.from, a.to)
      if (!r.found) return text(r.missing?.length ? `Not in this brain: ${r.missing.join(', ')}` : `No dependency path between ${a.from} and ${a.to}.`)
      return text(`${r.direction === 'imports' ? 'Import chain' : 'Dependent chain'} (${r.path.length - 1} hops):\n  ` + r.path.join('\n  -> '))
    }
    if (name === 'sb_keystones') {
      const ks = keystones(brain.nodes, brain.ids, Number(a.n) || 10)
      return text(`Load-bearing files:\n` + ks.map((k) => `  ${k.id}  reaches ${k.reach}  [${k.kind}]`).join('\n'))
    }
    if (name === 'sb_map') {
      const d = describe(brain.nodes, a.path)
      return text(d.found ? JSON.stringify(d, null, 2) : `Not in this brain: ${a.path}`)
    }
    if (name === 'sb_ask') {
      const q = String(a.question || '')
      if (/\b(keystone|important|load.bearing|critical|matters most)\b/i.test(q)) return callTool('sb_keystones', {})
      const p = brain.ids.find((id) => q.includes(id))
      if (p && /\b(break|reach|impact|blast|affect)\b/i.test(q)) return callTool('sb_blast', { path: p })
      if (hasKey()) { const res = await cloudAsk({ brainRef, question: q }); if (res.ok) return text(typeof res.answer === 'string' ? res.answer : JSON.stringify(res.answer, null, 2)) }
      return text(`Structure is answerable offline (sb_blast, sb_keystones, sb_map). For semantic answers and the why, ${UPSELL}`)
    }
    return text(`unknown tool: ${name}`)
  }

  function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n') }
  async function handle(req) {
    const { id, method, params } = req
    if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'spiderbrain-read', version: PKG_VERSION } } })
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
    if (method === 'tools/call') { const r = await callTool(params?.name, params?.arguments || {}); return send({ jsonrpc: '2.0', id, result: r }) }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} })
    if (typeof method === 'string' && method.startsWith('notifications/')) return
    if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } })
  }

  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buf += chunk
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let req
      try { req = JSON.parse(line) } catch { continue }
      handle(req)
    }
  })
  process.stderr.write(`spiderbrain-read mcp: serving ${brain ? brain.ids.length + ' files' : 'no brain'}\n`)
}

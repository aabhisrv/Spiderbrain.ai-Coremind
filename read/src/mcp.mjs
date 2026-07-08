/* Minimal MCP server (stdio, newline-delimited JSON-RPC 2.0). Zero deps, so
 * `npx @spiderbrain/read mcp` starts instantly. Turns a repo's committed
 * .spiderbrain/ folder into a queryable tool for Claude Code / Cursor. */
import { loadBrain, blast, keystones, describe, impact, pathBetween } from './core.mjs'
import { fetchRegistryBrainFor, REGISTRY_NOTICE } from './registry.mjs'
import { hasKey, cloudAsk, UPSELL } from './cloud.mjs'

const TOOLS = [
  { name: 'sb_blast', description: 'What a change to a file reaches (its transitive dependents / blast radius), computed deterministically from the committed graph.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'repo-relative file path' } }, required: ['path'] } },
  { name: 'sb_impact', description: 'What a CHANGE SET reaches: the union blast of several changed files, plus which changed files are keystones. Use before/while editing to know the consequences.', inputSchema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' }, description: 'repo-relative paths of the changed files' } }, required: ['paths'] } },
  { name: 'sb_path', description: 'The shortest dependency path between two files: how does one reach the other (import chain or dependent chain).', inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } },
  { name: 'sb_keystones', description: 'The load-bearing files, ranked by how many files they reach.', inputSchema: { type: 'object', properties: { n: { type: 'number', default: 10 } } } },
  { name: 'sb_map', description: 'What a file is, what it depends on, and what depends on it.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'sb_ask', description: 'Ask about the repo. Structure is answered offline; the why-layer needs a SpiderBrain API key.', inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } },
]

const text = (s) => ({ content: [{ type: 'text', text: s }] })

export function startMcp(rootDir) {
  let brain
  try { brain = loadBrain(rootDir) } catch (e) { process.stderr.write(`spiderbrain-read: ${e.message}\n`) }
  // No committed folder: try the public registry (unofficial brain of the same repo)
  // in the background so the server still starts instantly.
  let registryTried = false
  async function ensureBrain() {
    if (brain || registryTried) return
    registryTried = true
    const reg = await fetchRegistryBrainFor(rootDir)
    if (reg) { brain = reg; process.stderr.write(REGISTRY_NOTICE(reg) + '\n') }
  }
  const brainRefOf = () => brain?.manifest?.repo?.name || brain?.manifest?.scoredFrom || 'this-repo'

  async function callTool(name, a = {}) {
    await ensureBrain()
    const brainRef = brainRefOf()
    if (!brain) return text('No committed understanding found in this repo (.spiderbrain/ is missing, and the registry has no brain for its remote). Maintainers: npx spiderbrain create')
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
    if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'spiderbrain-read', version: '0.2.0' } } })
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

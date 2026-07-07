/* Minimal MCP server (stdio, newline-delimited JSON-RPC 2.0). Zero deps, so
 * `npx @spiderbrain/read mcp` starts instantly. Turns a repo's committed
 * .spiderbrain/ folder into a queryable tool for Claude Code / Cursor. */
import { loadBrain, blast, keystones, describe } from './core.mjs'
import { hasKey, cloudAsk, UPSELL } from './cloud.mjs'

const TOOLS = [
  { name: 'sb_blast', description: 'What a change to a file reaches (its transitive dependents / blast radius), computed deterministically from the committed graph.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'repo-relative file path' } }, required: ['path'] } },
  { name: 'sb_keystones', description: 'The load-bearing files, ranked by how many files they reach.', inputSchema: { type: 'object', properties: { n: { type: 'number', default: 10 } } } },
  { name: 'sb_map', description: 'What a file is, what it depends on, and what depends on it.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'sb_ask', description: 'Ask about the repo. Structure is answered offline; the why-layer needs a SpiderBrain API key.', inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } },
]

const text = (s) => ({ content: [{ type: 'text', text: s }] })

export function startMcp(rootDir) {
  let brain
  try { brain = loadBrain(rootDir) } catch (e) { process.stderr.write(`spiderbrain-read: ${e.message}\n`) }
  const brainRef = brain?.manifest?.repo?.name || brain?.manifest?.scoredFrom || 'this-repo'

  async function callTool(name, a = {}) {
    if (!brain) return text('No committed understanding found in this repo (.spiderbrain/ is missing).')
    if (name === 'sb_blast') {
      const r = blast(brain.nodes, a.path)
      if (!r.found) return text(`Not in this brain: ${a.path}`)
      return text(`${a.path} reaches ${r.count} file(s):\n` + r.reached.map((x) => `  ${x.id}${x.cost === 0 ? ' (through a barrel)' : ''}`).join('\n'))
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
    if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'spiderbrain-read', version: '0.1.0' } } })
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

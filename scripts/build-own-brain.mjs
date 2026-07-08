/* Dogfood: give THIS repo its own committed understanding layer, derived from its
 * real ESM import graph (the packages are plain relative-import ESM, so the graph
 * is exact). Deterministic: sorted walks, no wall-clock; re-running at the same
 * commit is byte-identical. Run from the repo root:
 *   node scripts/build-own-brain.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, relative, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildUnderstanding, mergeAgents } from '../create/src/export.mjs'
import { readHeadCommit, readOriginOwnerRepo } from '../create/src/gitinfo.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SKIP = new Set(['.git', 'node_modules', '.spiderbrain', '.github'])
const toPosix = (p) => p.split('\\').join('/')

// ── collect files (sorted, deterministic) ─────────────────────────────────────
const files = []
;(function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full)
    else files.push(toPosix(relative(ROOT, full)))
  }
})(ROOT)

// ── parse relative ESM imports (the repo's only import style) ────────────────
const fileSet = new Set(files)
const importsOf = (relPath) => {
  if (!/\.(mjs|js|ts|d\.ts)$/.test(relPath)) return []
  const src = readFileSync(join(ROOT, relPath), 'utf8')
  const out = new Set()
  for (const m of src.matchAll(/(?:import\s[^'"]*?|import\(|from\s*)['"](\.\.?\/[^'"]+)['"]/g)) {
    let target = posix.normalize(posix.join(posix.dirname(relPath), m[1]))
    for (const cand of [target, target + '.mjs', target + '.js']) {
      if (fileSet.has(cand)) { out.add(cand); break }
    }
  }
  return [...out].sort()
}

const kindOf = (p) =>
  /\.(md|txt)$/i.test(p) ? 'doc'
  : /\.(json|ndjson)$/i.test(p) ? 'data'
  : /\.(yml|yaml)$/i.test(p) ? 'config'
  : /\.(mjs|js|ts)$/i.test(p) ? 'code'
  : ''
const clusterOf = (p) => (p.includes('/') ? p.split('/')[0] : 'root')

// ── nodes + edges + blastRadius (plain transitive dependents; no barrels here) ─
const nodes = {}
const edges = []
for (const f of files) {
  const deps = importsOf(f)
  nodes[f] = { kind: kindOf(f), cluster: clusterOf(f), dependsOn: deps }
  for (const d of deps) edges.push([f, d])
}
const dependedOnBy = Object.fromEntries(files.map((f) => [f, []]))
for (const [s, t] of edges) dependedOnBy[t].push(s)
for (const f of files) {
  const seen = new Set()
  const stack = [...dependedOnBy[f]]
  while (stack.length) {
    const x = stack.pop()
    if (seen.has(x)) continue
    seen.add(x)
    for (const p of dependedOnBy[x]) stack.push(p)
  }
  nodes[f].blastRadius = seen.size
}

// ── build + write via the real producer (same leak guard, same determinism) ───
const origin = readOriginOwnerRepo(ROOT)
const built = buildUnderstanding(
  { nodes, edges, stats: { edgeCount: edges.length } },
  { repo: origin ? `${origin.owner}/${origin.repo}` : 'aabhisrv/spiderbrain.ai', commit: readHeadCommit(ROOT) || '' },
)
const dir = join(ROOT, '.spiderbrain')
mkdirSync(dir, { recursive: true })
for (const [name, contents] of Object.entries(built.files)) writeFileSync(join(dir, name), contents)
const agentsPath = join(ROOT, 'AGENTS.md')
const existing = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : ''
writeFileSync(agentsPath, mergeAgents(existing, built.files['AGENTS.block.md']))

console.log(`dogfood: ${built.manifest.counts.files} files, ${built.manifest.counts.edges} edges, fp ${built.manifest.graphFingerprint}`)
console.log('wrote .spiderbrain/ + AGENTS.md - try: node read/bin/sb.mjs keystones')

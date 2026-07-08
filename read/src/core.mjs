/*
 * @spiderbrain/read core: load a committed .spiderbrain/ understanding folder and
 * answer structural questions offline. MIT. Zero dependencies.
 *
 * Reads only the public understanding set (structure.ndjson + manifest.json). All
 * answers here are deterministic functions of committed bytes: no scoring weights,
 * no network. The cloud why-layer is a separate, keyed path (see cloud.mjs).
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

/** Parse structure.ndjson text into a node map with dependedOnBy inverted from the
 *  committed forward edges. Shared by the on-disk loader and the registry fallback. */
export function parseStructure(raw) {
  const nodes = Object.create(null)
  for (const line of raw.split('\n')) {
    if (!line) continue
    const n = JSON.parse(line)
    n.dependedOnBy = []
    nodes[n.id] = n
  }
  // Invert dependsOn -> dependedOnBy (skip dangling edges, never throw).
  for (const id of Object.keys(nodes)) {
    for (const dep of nodes[id].dependsOn || []) {
      if (nodes[dep]) nodes[dep].dependedOnBy.push(id)
    }
  }
  return nodes
}

/** Integrity read: the committed fingerprint must match a fresh hash of the bytes. */
export function integrityOf(structureText, manifest) {
  if (!manifest || !manifest.graphFingerprint) return 'unknown'
  const fresh = createHash('sha256').update(structureText).digest('hex').slice(0, manifest.graphFingerprint.length)
  return fresh === manifest.graphFingerprint ? 'verified' : 'MISMATCH'
}

/** Load the folder into an in-memory graph. Builds dependedOnBy by inverting
 *  dependsOn, so blast (which walks dependents) needs only the committed forward
 *  edges. Returns { nodes, ids, manifest, integrity }. */
export function loadBrain(root) {
  const dir = root.endsWith('.spiderbrain') ? root : join(root, '.spiderbrain')
  const structPath = join(dir, 'structure.ndjson')
  if (!existsSync(structPath)) throw new Error(`no understanding found: ${structPath} is missing`)
  const raw = readFileSync(structPath, 'utf8')
  const nodes = parseStructure(raw)
  let manifest = null
  const mPath = join(dir, 'manifest.json')
  if (existsSync(mPath)) { try { manifest = JSON.parse(readFileSync(mPath, 'utf8')) } catch {} }
  return { dir, nodes, ids: Object.keys(nodes).sort(), manifest, integrity: integrityOf(raw, manifest), source: 'committed' }
}

/** Barrel-aware reach over dependents (clean-room reimplementation of the blast
 *  traversal): stepping onto a role==='barrel' node costs 0, any other step 1,
 *  bounded by maxCost. Pure and deterministic (0/1 weights relax to a unique
 *  shortest-cost fixpoint regardless of visit order). Returns Map<id, cost>. */
export function reach(nodes, id, maxCost = Infinity) {
  const best = new Map([[id, 0]])
  const queue = [[id, 0]]
  while (queue.length) {
    const [cur, cost] = queue.shift()
    if (cost > (best.get(cur) ?? Infinity)) continue
    const dependents = nodes[cur] && Array.isArray(nodes[cur].dependedOnBy) ? nodes[cur].dependedOnBy : []
    for (const d of dependents) {
      if (!nodes[d]) continue
      const step = cost + (nodes[d].role === 'barrel' ? 0 : 1)
      if (step <= maxCost && step < (best.get(d) ?? Infinity)) {
        best.set(d, step)
        queue.push([d, step])
      }
    }
  }
  best.delete(id)
  return best
}

/** Full blast: every transitive dependent of `id`, sorted by (cost asc, id asc). */
export function blast(nodes, id) {
  if (!nodes[id]) return { id, found: false, reached: [] }
  const m = reach(nodes, id)
  const reached = [...m.entries()].map(([rid, cost]) => ({ id: rid, cost })).sort((a, b) => (a.cost - b.cost) || (a.id < b.id ? -1 : 1))
  return { id, found: true, count: reached.length, reached }
}

/** Keystones: the load-bearing files, ranked by committed blastRadius (an
 *  edge-derivable transitive-dependent count), tie-break by id. */
export function keystones(nodes, ids, n = 10) {
  return ids
    .map((id) => ({ id, reach: Number(nodes[id].blastRadius) || 0, kind: nodes[id].kind, cluster: nodes[id].cluster }))
    .filter((x) => x.reach > 0)
    .sort((a, b) => (b.reach - a.reach) || (a.id < b.id ? -1 : 1))
    .slice(0, n)
}

/** Node summary: what it is, what it depends on, what depends on it. */
export function describe(nodes, id) {
  const n = nodes[id]
  if (!n) return { id, found: false }
  return {
    id, found: true, kind: n.kind, role: n.role || null, cluster: n.cluster, layer: n.layer,
    isMaster: !!n.isMaster, master: n.master || null, blastRadius: Number(n.blastRadius) || 0,
    dependsOn: n.dependsOn || [], dependedOnByCount: n.dependedOnBy.length,
  }
}

/** Impact of a change set: the union of every changed file's blast, plus which of
 *  the changed files are themselves keystones. Deterministic. Paths not in the
 *  brain are reported (renames/new files), never fatal. */
export function impact(nodes, ids, changedPaths, opts = {}) {
  const keystoneN = Number(opts.keystoneN) || 10
  const ks = new Set(keystones(nodes, ids, keystoneN).map((k) => k.id))
  const union = new Set()
  const changed = []
  for (const p of [...new Set(changedPaths)].sort()) {
    if (!nodes[p]) { changed.push({ path: p, found: false, reaches: 0 }); continue }
    const m = reach(nodes, p)
    for (const rid of m.keys()) union.add(rid)
    changed.push({ path: p, found: true, reaches: m.size, keystone: ks.has(p) })
  }
  for (const c of changed) if (c.found) union.delete(c.path) // a changed file is a cause, not an effect
  const reached = [...union].sort()
  return {
    changed,
    keystonesTouched: changed.filter((c) => c.keystone).map((c) => c.path),
    reachedCount: reached.length,
    reached,
    unknownCount: changed.filter((c) => !c.found).length,
  }
}

/** Shortest dependency path between two files: how does `from` reach `to`?
 *  Tries the import direction (from -> dependsOn -> ... -> to) first, then the
 *  dependent direction. Returns { found, direction, path } with path inclusive. */
export function pathBetween(nodes, from, to) {
  if (!nodes[from] || !nodes[to]) return { found: false, missing: [from, to].filter((p) => !nodes[p]) }
  const bfs = (key) => {
    const prev = new Map([[from, null]])
    const q = [from]
    while (q.length) {
      const cur = q.shift()
      if (cur === to) {
        const path = []
        for (let x = to; x !== null; x = prev.get(x)) path.push(x)
        return path.reverse()
      }
      const next = nodes[cur] && Array.isArray(nodes[cur][key]) ? nodes[cur][key] : []
      for (const nx of [...next].sort()) {
        if (!nodes[nx] || prev.has(nx)) continue
        prev.set(nx, cur)
        q.push(nx)
      }
    }
    return null
  }
  const dep = bfs('dependsOn')
  if (dep) return { found: true, direction: 'imports', path: dep }
  const rev = bfs('dependedOnBy')
  if (rev) return { found: true, direction: 'imported-by', path: rev }
  return { found: false, missing: [] }
}

/** Verify the committed folder: fingerprint + per-file hashes must match the bytes,
 *  and (when both are known) the recorded commit should match the repo's HEAD.
 *  Pure report; the CLI decides exit codes. */
export function verify(root, opts = {}) {
  const dir = root.endsWith('.spiderbrain') ? root : join(root, '.spiderbrain')
  const problems = []
  const files = {}
  let manifest = null
  try { manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) } catch { problems.push('manifest.json is missing or unreadable') }
  let structureText = null
  try { structureText = readFileSync(join(dir, 'structure.ndjson'), 'utf8') } catch { problems.push('structure.ndjson is missing') }
  if (manifest && structureText) {
    const integ = integrityOf(structureText, manifest)
    if (integ === 'MISMATCH') problems.push('graphFingerprint does not match structure.ndjson (hand-edited or corrupted)')
    for (const [name, hash] of Object.entries(manifest.fileHashes || {})) {
      try {
        const fresh = createHash('sha256').update(readFileSync(join(dir, name), 'utf8')).digest('hex')
        files[name] = fresh === hash ? 'ok' : 'mismatch'
        if (files[name] === 'mismatch') problems.push(`${name} does not match its recorded hash`)
      } catch { files[name] = 'missing'; problems.push(`${name} is missing`) }
    }
  }
  const scoredFrom = manifest && (manifest.repo?.commit || manifest.scoredFrom) || null
  const headCommit = opts.headCommit || null
  let current = null
  if (scoredFrom && headCommit) {
    current = String(scoredFrom).slice(0, 12) === String(headCommit).slice(0, 12)
    if (!current) problems.push(`brain was scored at ${String(scoredFrom).slice(0, 7)} but HEAD is ${String(headCommit).slice(0, 7)} (stale)`)
  }
  return { ok: problems.length === 0, dir, files, scoredFrom, headCommit, current, problems, fingerprint: manifest?.graphFingerprint || null }
}

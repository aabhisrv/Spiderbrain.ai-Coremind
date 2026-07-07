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

/** Load the folder into an in-memory graph. Builds dependedOnBy by inverting
 *  dependsOn, so blast (which walks dependents) needs only the committed forward
 *  edges. Returns { nodes, ids, manifest, integrity }. */
export function loadBrain(root) {
  const dir = root.endsWith('.spiderbrain') ? root : join(root, '.spiderbrain')
  const structPath = join(dir, 'structure.ndjson')
  if (!existsSync(structPath)) throw new Error(`no understanding found: ${structPath} is missing`)
  const raw = readFileSync(structPath, 'utf8')
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
  let manifest = null
  const mPath = join(dir, 'manifest.json')
  if (existsSync(mPath)) { try { manifest = JSON.parse(readFileSync(mPath, 'utf8')) } catch {} }
  // Integrity: the committed fingerprint must match a fresh hash of the bytes.
  let integrity = 'unknown'
  if (manifest && manifest.graphFingerprint) {
    const fresh = createHash('sha256').update(raw).digest('hex').slice(0, manifest.graphFingerprint.length)
    integrity = fresh === manifest.graphFingerprint ? 'verified' : 'MISMATCH'
  }
  return { dir, nodes, ids: Object.keys(nodes).sort(), manifest, integrity }
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

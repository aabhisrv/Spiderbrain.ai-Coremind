/*
 * @spiderbrain/create — build the .spiderbrain/ understanding set from an
 * already-scored brain. Pure function port of the exporter (same logic, same
 * guarantees): public variant = structure + edges + edge-derivable blast, NO
 * weighted scores, leak-guarded, deterministic. MIT.
 */
import { createHash } from 'node:crypto'

const SCHEMA_VERSION = 1
const KEYSTONE_COUNT = 8

const sha256 = (s) => createHash('sha256').update(s).digest('hex')
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
  }
  return JSON.stringify(v)
}
const num = (x) => (Number.isFinite(x) ? x : 0)
// Every string a record carries (top-level strings + strings inside arrays), for the value-level
// leak scan below. The structure projection only holds strings, booleans, numbers, and a string[]
// (dependsOn), so this covers it without recursing arbitrarily.
function recordStrings(rec) {
  const out = []
  for (const v of Object.values(rec)) {
    if (typeof v === 'string') out.push(v)
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') out.push(x)
  }
  return out
}

/** Build the understanding set from a scored brain ({ nodes: id->node, edges, stats }).
 *  opts: { private?: boolean, repo?: string, commit?: string }
 *  Returns { files: { name -> contents }, manifest }. */
export function buildUnderstanding(brain, opts = {}) {
  const isPrivate = !!opts.private
  const repoName = opts.repo || ''
  const commit = opts.commit || ''

  const nodesMap = brain.nodes || {}
  const ids = Object.keys(nodesMap).sort()
  if (!ids.length) throw new Error('brain has no nodes')

  const structureLines = ids.map((id) => {
    const n = nodesMap[id] || {}
    return canon({
      id,
      kind: n.kind || '',
      role: n.role || '',
      layer: n.layer || '',
      cluster: n.cluster || '',
      isMaster: !!n.isMaster,
      master: n.master || '',
      contentHash: n.contentHash || '',
      blastRadius: num(n.blastRadius),
      dependsOn: Array.isArray(n.dependsOn) ? [...n.dependsOn].sort() : [],
    })
  })
  const structureNdjson = structureLines.join('\n') + '\n'

  const WEIGHTED = ['webscore', 'spikescore', 'vibrationscore', 'drift', 'semantic01', 'constitutive01', 'blindspot01', 'pattern', 'community', 'palpKind', 'blastVolume']
  let scoresNdjson = null
  if (isPrivate) {
    scoresNdjson = ids.map((id) => {
      const n = nodesMap[id] || {}
      const rec = { id }
      for (const k of WEIGHTED) if (n[k] !== undefined && n[k] !== null) rec[k] = n[k]
      return canon(rec)
    }).join('\n') + '\n'
  }

  const byBlast = ids
    .map((id) => ({ id, blast: num(nodesMap[id].blastRadius) }))
    .sort((a, b) => (b.blast - a.blast) || (a.id < b.id ? -1 : 1))
  const keystones = byBlast.slice(0, KEYSTONE_COUNT).filter((k) => k.blast > 0)
  const graphFingerprint = sha256(structureNdjson).slice(0, 16)

  const stamp = commit || (brain.sourceHash ? String(brain.sourceHash).slice(0, 12) : 'unknown')
  const ks = keystones.length
    ? keystones.map((k) => `- ${k.id}  (reaches ${k.blast} files)`).join('\n')
    : '- (no multi-file keystones in this brain)'
  const agentsBlock = [
    `<!-- spiderbrain:start v=${SCHEMA_VERSION} fp=${graphFingerprint} commit=${stamp} -->`,
    `## Repo understanding (SpiderBrain)`,
    ``,
    `This repo carries a committed brain in \`.spiderbrain/\`: a deterministic, source-free map of its`,
    `structure, dependencies, and blast radius (${ids.length} files, ${num(brain.stats?.edgeCount)} edges). Consult it before`,
    `reading files, to know what matters and what a change reaches.`,
    ``,
    `Fastest use (an MCP server for this repo, no SpiderBrain install, no account):`,
    `    npx spiderbrain mcp`,
    `One-off:`,
    `    npx spiderbrain blast <path>     # what a change to <path> reaches`,
    `    npx spiderbrain keystones        # the load-bearing files`,
    ``,
    `Keystones (top by reach, precomputed so you get value without installing anything):`,
    ks,
    ``,
    `The why (decisions, reasoning, always-fresh scores) is the cloud layer. Set SPIDERBRAIN_API_KEY`,
    `(get one at https://spiderbrain.ai/dashboard?tab=keys) and any command above also returns fresh`,
    `scores, semantic search, and \`sb_why <path>\` (the decision behind a file).`,
    ``,
    `Deterministic: this block regenerates byte-identically from commit ${stamp} (fingerprint ${graphFingerprint}).`,
    `Do not hand-edit between the markers.`,
    `<!-- spiderbrain:end -->`,
    ``,
  ].join('\n')

  // engineVersion MUST be a short static string. brain.v5 (if present) is NOT a
  // version: on some payloads it is an object holding private scoring internals.
  // Never serialize it into a committed artifact. Only accept a string.
  const engineVersion =
    (typeof brain.v5 === 'string' && brain.v5) ||
    (typeof brain.meta?.engineVersion === 'string' && brain.meta.engineVersion) ||
    'v5'

  const fileHashes = { 'structure.ndjson': sha256(structureNdjson), 'AGENTS.block.md': sha256(agentsBlock) }
  if (scoresNdjson) fileHashes['scores.ndjson'] = sha256(scoresNdjson)
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    variant: isPrivate ? 'private' : 'public',
    privacy: 'plain-paths',
    engineVersion,
    scoredFrom: commit || (brain.sourceHash ? String(brain.sourceHash) : null),
    repo: { name: repoName || null, commit: commit || null },
    counts: {
      files: ids.length,
      edges: num(brain.stats?.edgeCount),
      clusters: num(brain.stats?.clusterCount),
      masters: num(brain.stats?.masterCount),
    },
    graphFingerprint,
    fileHashes,
    benchmark: { standard: 'context-trust-level', url: 'https://contextbenchmark.com', note: 'CTL is measured, never hardcoded; see the published run.' },
    ownership: { owner: 'repo', license: 'inherits-repo', generator: 'spiderbrain' },
    attribution: null,
  }

  // Leak guard. structure.ndjson / AGENTS.block / manifest.json are the source-free AND score-free
  // projection in BOTH variants — the weighted scores live ONLY in the separate private scores.ndjson.
  // So these three files must never carry a score field-name or an out-of-allowlist key regardless of
  // `private`. Before 2026-07-19 (BaaS hardening) this whole block ran only for the PUBLIC variant, so
  // a private brain's structure.ndjson — exactly the artifact a cloud/BaaS parse returns — was never
  // checked at all. FORBIDDEN is anchored as JSON keys so a legit file PATH (".../webscore.mjs") never
  // false-positives; only a leaked score FIELD trips it. scoresNdjson is deliberately NOT in the
  // haystack, so the legitimate private scores don't self-trip.
  const FORBIDDEN = ['"webscore":', '"spikescore":', '"vibrationscore":', '"semantic01":', '"constitutive01":', '"drift":', '"clusterspikescore":', '"topologyspikescore":', '"blindspotIndex":', '"shortcutAudit"', '"refMass"', '"alpha":', '"modularity"']
  const haystack = structureNdjson + '\n' + agentsBlock + '\n' + JSON.stringify(manifest)
  const hit = FORBIDDEN.find((t) => haystack.includes(t))
  if (hit) throw new Error(`LEAK GUARD: forbidden token ${hit} would appear in structure/agents/manifest. Aborting (this should never happen; please report it).`)

  // Structural key allowlist + value sanity, on EVERY record. The projection above builds homogeneous
  // lines today (so line 0 was representative), but checking all lines future-proofs against a later
  // conditional projection, and the value scan catches embedded source content — a value carrying a
  // newline, or longer than any real path/hash — that a key-only check would wave through.
  const ALLOWED_KEYS = new Set(['id', 'kind', 'role', 'layer', 'cluster', 'isMaster', 'master', 'contentHash', 'blastRadius', 'dependsOn'])
  const MAX_VAL = 4096 // deepest legit path is well under this; a source file is well over it
  for (let i = 0; i < structureLines.length; i++) {
    const rec = JSON.parse(structureLines[i])
    const badKey = Object.keys(rec).find((k) => !ALLOWED_KEYS.has(k))
    if (badKey) throw new Error(`LEAK GUARD: unexpected key "${badKey}" in structure record ${i}. Aborting.`)
    const badVal = recordStrings(rec).find((v) => v.includes('\n') || v.length > MAX_VAL)
    if (badVal !== undefined) throw new Error(`LEAK GUARD: structure record ${i} carries a multiline/oversized value (possible embedded source). Aborting.`)
  }

  // Private variant: scores.ndjson must carry ONLY id + the weighted-score allowlist. Built by
  // allowlist projection above, so this is defense-in-depth against a future edit that widens it —
  // the private path had no such assertion before.
  if (scoresNdjson) {
    const OK_SCORE_KEYS = new Set(['id', ...WEIGHTED])
    const scoreLines = scoresNdjson.trim().split('\n')
    for (let i = 0; i < scoreLines.length; i++) {
      const bad = Object.keys(JSON.parse(scoreLines[i])).find((k) => !OK_SCORE_KEYS.has(k))
      if (bad) throw new Error(`LEAK GUARD: unexpected key "${bad}" in scores record ${i}. Aborting.`)
    }
  }

  const out = { 'structure.ndjson': structureNdjson, 'AGENTS.block.md': agentsBlock, 'manifest.json': JSON.stringify(manifest, null, 2) + '\n' }
  if (scoresNdjson) out['scores.ndjson'] = scoresNdjson
  return { files: out, manifest }
}

/** Merge the AGENTS block into an existing AGENTS.md/CLAUDE.md body between the
 *  spiderbrain markers, preserving human-authored content. Returns the new body. */
export function mergeAgents(existing, block) {
  const START = '<!-- spiderbrain:start'
  const END = '<!-- spiderbrain:end -->'
  if (!existing || !existing.trim()) return block
  const s = existing.indexOf(START)
  if (s === -1) return existing.replace(/\s*$/, '') + '\n\n' + block
  const e = existing.indexOf(END, s)
  if (e === -1) return existing.slice(0, s).replace(/\s*$/, '') + '\n\n' + block
  const after = existing.slice(e + END.length)
  return existing.slice(0, s) + block.replace(/\s*$/, '') + after
}

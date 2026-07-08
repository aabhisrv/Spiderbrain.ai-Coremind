/* Registry fallback: when a repo carries no committed .spiderbrain/ folder, try
 * the SpiderBrain public registry for an UNOFFICIAL, source-free brain of the
 * same repo (derived from its public structure). Clearly labeled; the committed
 * folder always wins when present. MIT, zero deps (global fetch, Node >= 18). */
import { parseStructure, integrityOf } from './core.mjs'
import { readOriginOwnerRepo } from './git.mjs'

const REGISTRY = (process.env.SPIDERBRAIN_REGISTRY || 'https://spiderbrain.ai/registry').replace(/\/$/, '')

/** Fetch a registry brain for owner/repo. Returns a loadBrain-shaped object with
 *  source:'registry', or null when the registry has no brain for this repo. */
export async function fetchRegistryBrain(owner, repo) {
  try {
    const base = `${REGISTRY}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    const mRes = await fetch(`${base}/manifest.json`)
    if (!mRes.ok) return null
    const manifest = await mRes.json()
    const sRes = await fetch(`${base}/structure.ndjson`)
    if (!sRes.ok) return null
    const raw = await sRes.text()
    const nodes = parseStructure(raw)
    return {
      dir: `${base} (registry)`,
      nodes,
      ids: Object.keys(nodes).sort(),
      manifest,
      integrity: integrityOf(raw, manifest),
      source: 'registry',
    }
  } catch { return null }
}

/** Resolve the registry brain for the repo at `dir` via its origin remote. */
export async function fetchRegistryBrainFor(dir) {
  const or = readOriginOwnerRepo(dir)
  if (!or) return null
  return fetchRegistryBrain(or.owner, or.repo)
}

export const REGISTRY_NOTICE = (b) =>
  `note: this repo carries no committed .spiderbrain/ folder; using an UNOFFICIAL registry brain ` +
  `(${b.manifest?.counts?.files ?? '?'} files, fp ${b.manifest?.graphFingerprint ?? '?'}). ` +
  `Maintainers can publish an official one: npx spiderbrain create`

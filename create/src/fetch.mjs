/* Fetch a scored brain from the SpiderBrain API. Needs SPIDERBRAIN_API_KEY. */
const BASE = process.env.SPIDERBRAIN_API_BASE || 'https://api.spiderbrain.ai'

function key() {
  const k = (process.env.SPIDERBRAIN_API_KEY || '').trim()
  if (!k) throw new Error('SPIDERBRAIN_API_KEY is not set. Get one at https://spiderbrain.ai/dashboard?tab=keys')
  return k
}
const auth = () => ({ Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' })

/** List the caller's brains (id, name, ...). */
export async function listBrains() {
  const r = await fetch(`${BASE}/v1/brains`, { headers: auth() })
  if (!r.ok) throw new Error(`could not list brains (HTTP ${r.status}). Check your API key.`)
  const j = await r.json().catch(() => null)
  return Array.isArray(j?.brains) ? j.brains : []
}

/** Resolve a --brain arg (id or name) to a brain id, then fetch the full scored brain.
 *  With no arg and exactly one brain, use it; with several, error and list them. */
export async function fetchBrain(ref) {
  const list = await listBrains()
  if (!list.length) throw new Error('no brains found on this account. Build and upload one from the SpiderBrain app first.')
  let meta
  if (ref) {
    meta = list.find((b) => b.id === ref) || list.find((b) => b.name === ref)
    if (!meta) throw new Error(`no brain named "${ref}". Available: ${list.map((b) => b.name).join(', ')}`)
  } else if (list.length === 1) {
    meta = list[0]
  } else {
    throw new Error(`several brains on this account; pass --brain <name>. Available: ${list.map((b) => b.name).join(', ')}`)
  }
  const r = await fetch(`${BASE}/v1/brains/${encodeURIComponent(meta.id)}`, { headers: auth() })
  if (!r.ok) throw new Error(`could not fetch brain "${meta.name}" (HTTP ${r.status}).`)
  const brain = await r.json().catch(() => null)
  if (!brain || !brain.nodes) throw new Error(`brain "${meta.name}" has no data. Upload it to the cloud from the app first.`)
  return { brain, meta }
}

/*
 * Cloud why-layer client. Optional: only used when SPIDERBRAIN_API_KEY is set.
 * The committed folder answers structure offline; the cloud answers the why
 * (decisions, reasoning), fresh scores, and semantic search. Degrades gracefully
 * when unset or unreachable, so the offline path always works.
 */
const BASE = process.env.SPIDERBRAIN_API_BASE || 'https://api.spiderbrain.ai'

export function hasKey() {
  return !!(process.env.SPIDERBRAIN_API_KEY && process.env.SPIDERBRAIN_API_KEY.trim())
}

/** Ask the cloud a question about a brain. brainRef identifies the hosted brain
 *  (name or id). Returns { ok, answer } or { ok:false, reason }. */
export async function cloudAsk({ brainRef, question, path }) {
  const key = (process.env.SPIDERBRAIN_API_KEY || '').trim()
  if (!key) return { ok: false, reason: 'no_key' }
  try {
    const res = await fetch(`${BASE}/v1/answers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ brain: brainRef, question, path }),
    })
    if (!res.ok) return { ok: false, reason: `http_${res.status}` }
    const data = await res.json().catch(() => null)
    return { ok: true, answer: data }
  } catch (e) {
    return { ok: false, reason: 'network' }
  }
}

export const UPSELL =
  'The why-layer (decisions, reasoning, always-fresh scores, semantic search) is the cloud layer. ' +
  'Set SPIDERBRAIN_API_KEY (get one at https://spiderbrain.ai/dashboard?tab=keys) and re-run.'

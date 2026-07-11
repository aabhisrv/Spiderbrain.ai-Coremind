// spiderbrain-brain-creator — R2 data plane for /brains + the compat-scan proxy.
//
// GET  /brains/...          -> R2 object (agent-plane files)
// POST /scan/start          -> Gate 1 (public JS/TS) then kick a parse on KVM8 -> { jobId }
// GET  /scan/:jobId?tier=   -> poll KVM8; free tier strips the paid scores (locked teasers)
//
// Secrets (wrangler secret): REGISTRY_PARSE_KEY. Var: REGISTRY_PARSE_URL, GITHUB_TOKEN (optional).

const CT = { '.json': 'application/json; charset=utf-8', '.ndjson': 'application/x-ndjson; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };
const contentType = (k) => { const d = k.lastIndexOf('.'); return (d >= 0 && CT[k.slice(d)]) || 'application/octet-stream'; };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, HEAD, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const JS_TS = new Set(['JavaScript', 'TypeScript']);
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS } });

// The FREE compat report shows structure; the DeepWeave scores are the locked upsell.
function stripToFree(result) {
  if (!result || !result.display) return result;
  const d = result.display;
  return {
    owner: result.owner, repo: result.repo, sha: result.sha, fingerprint: result.fingerprint,
    display: {
      nodes: d.nodes, edges: d.edges, codeFiles: d.codeFiles, clusters: d.clusters,
      impactReach: d.impactReach, topHotspot: d.topHotspot,
      hotspots: d.hotspots, startHere: d.startHere, clusterSizes: d.clusterSizes,
      topFiles: (d.topFiles || []).map(({ file, blast, in: i, out, cluster, master }) => ({ file, blast, in: i, out, cluster, master })),
      scored: false,
    },
    locked: ['Webscore importance', 'Semantic + constitutive relevance', 'Spike / risk signals', 'Decisions & memory'],
  };
}

// Bump to invalidate the ENTIRE scan cache on an engine upgrade (the key includes it,
// so old-engine builds are simply never read again). Keep in sync with sbpw.
const ENGINE_VER = 'v5';
// Cache version segment = the repo's `pushed_at` (digits only), which the SINGLE gate1
// /repos call already returns — so no extra GitHub call, and it changes whenever the repo
// is pushed to. It over-invalidates slightly (a push to any branch bumps it, triggering a
// re-parse of the default branch we didn't need) but NEVER serves stale data. Beats a HEAD-
// sha key that needs a 2nd GitHub call per scan (unauth GitHub is 60/hr, shared).
const verOf = (pushedAt) => String(pushedAt || '').replace(/\D/g, '') || 'x';
const cacheKey = (owner, repo, ver) => `scan/${owner}/${repo}/${ENGINE_VER}/${ver}.json`;

function ghHeaders(env) {
  const h = { 'user-agent': 'spiderbrain-compat', accept: 'application/vnd.github+json' };
  if (env.GITHUB_TOKEN) h.authorization = 'Bearer ' + env.GITHUB_TOKEN;
  return h;
}

async function gate1(owner, repo, env) {
  if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) return { ok: false, code: 400, error: 'invalid owner/repo' };
  let r;
  try { r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: ghHeaders(env) }); } catch { return { ok: false, code: 502, error: 'could not reach GitHub' }; }
  if (r.status === 404) return { ok: false, code: 404, error: 'repo not found (or private)' };
  if (!r.ok) return { ok: false, code: 502, error: 'GitHub error ' + r.status };
  const meta = await r.json();
  if (meta.private) return { ok: false, code: 403, error: 'private repos are coming soon' };
  if (meta.language && !JS_TS.has(meta.language)) return { ok: false, code: 422, error: `${meta.language} is not supported yet (JS/TS only). Vote for it on the demand board.`, language: meta.language };
  return { ok: true, ver: verOf(meta.pushed_at) };
}

async function kvm8(path, env, init) {
  const r = await fetch(env.REGISTRY_PARSE_URL + path, { ...init, headers: { ...(init && init.headers), authorization: 'Bearer ' + env.REGISTRY_PARSE_KEY } });
  return r;
}

// Per-IP throttle for the unauthenticated /scan/start (each call kicks a KVM8 parse +
// a GitHub API hit). Fails OPEN if KV is missing so a binding glitch never blocks scans.
async function scanRateLimited(request, env, max = 20, ttl = 3600) {
  if (!env.RATE_LIMIT) return false;
  const ip = request.headers.get('cf-connecting-ip') || 'noip';
  const key = `rl:scan:${ip}`;
  try {
    const cur = parseInt((await env.RATE_LIMIT.get(key)) || '0', 10);
    if (cur >= max) return true;
    await env.RATE_LIMIT.put(key, String(cur + 1), { expirationTtl: ttl });
    return false;
  } catch { return false; }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { return new Response('bad request', { status: 400 }); }

    // ── compat scan proxy ──────────────────────────────────────────────
    if (path === '/scan/start' && request.method === 'POST') {
      if (!env.REGISTRY_PARSE_URL || !env.REGISTRY_PARSE_KEY) return json({ error: 'scan not configured' }, 503);
      if (await scanRateLimited(request, env)) return json({ error: 'Too many scans from your network. Please wait a bit and retry.' }, 429);
      let b; try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      const owner = String(b.owner || '').trim(), repo = String(b.repo || '').trim();
      const g = await gate1(owner, repo, env);
      if (!g.ok) return json({ error: g.error, ...(g.language ? { language: g.language } : {}) }, g.code);
      // Cache hit on this pushed_at -> return the stripped result inline, no KVM8 parse.
      if (env.SCAN_CACHE && g.ver) {
        try {
          const hit = await env.SCAN_CACHE.get(cacheKey(owner, repo, g.ver));
          if (hit) return json({ status: 'done', cached: true, ver: g.ver, result: stripToFree(JSON.parse(await hit.text())) });
        } catch { /* cache miss/parse error -> fall through to a fresh parse */ }
      }
      // Miss: KVM8 dedups concurrent parses of the same repo (byRepo), so no lock needed here.
      let r; try { r = await kvm8('/parse', env, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner, repo }) }); } catch { return json({ error: 'parser unreachable' }, 502); }
      if (!r.ok) return json({ error: 'parser rejected (' + r.status + ')' }, 502);
      const { jobId } = await r.json();
      // Thread owner/repo/ver to /scan/:id (which has only the jobId) so it can write the
      // cache under the right key on completion. Best-effort KV (reuses RATE_LIMIT).
      if (env.RATE_LIMIT && jobId) {
        try { await env.RATE_LIMIT.put(`jm:${jobId}`, JSON.stringify({ owner, repo, ver: g.ver }), { expirationTtl: 3600 }); } catch {}
      }
      return json({ jobId, ver: g.ver });
    }

    if (path.startsWith('/scan/') && request.method === 'GET') {
      if (!env.REGISTRY_PARSE_URL) return json({ error: 'scan not configured' }, 503);
      const jobId = path.slice('/scan/'.length);
      if (!/^[a-f0-9-]{16,}$/i.test(jobId)) return json({ error: 'bad job id' }, 400);
      let r; try { r = await kvm8('/jobs/' + jobId, env, {}); } catch { return json({ error: 'parser unreachable' }, 502); }
      if (r.status === 404) return json({ error: 'no such job' }, 404);
      const j = await r.json();
      if (j.status === 'done') {
        // Persist the FULL result to the shared cache under the pushed_at ver threaded from
        // /scan/start (via KV, keyed by jobId), so the next scan of this repo — free or paid —
        // is an instant hit. Best-effort; idempotent.
        const res = j.result || {};
        if (env.SCAN_CACHE && env.RATE_LIMIT && res.owner && res.repo) {
          try {
            const meta = await env.RATE_LIMIT.get(`jm:${jobId}`);
            const ver = meta ? JSON.parse(meta).ver : null;
            if (ver) await env.SCAN_CACHE.put(cacheKey(res.owner, res.repo, ver), JSON.stringify(res), { httpMetadata: { contentType: 'application/json' } });
          } catch { /* cache write is best-effort */ }
        }
        // This PUBLIC proxy ALWAYS strips to the free tier. The paid full report (with
        // DeepWeave scores) is fetched server-side by sbpw straight from the cache/KVM8
        // with the parse key, only after a verified $9 payment — never exposed here.
        return json({ status: 'done', result: stripToFree(res) });
      }
      return json({ status: j.status, ...(j.error ? { error: j.error } : {}) });
    }

    // ── R2 data plane ──────────────────────────────────────────────────
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
    let key = path.replace(/^\/+/, '').replace(/\/+$/, '');
    if (key === '' || key === 'brains') key = 'brains/index.json';
    if (!key.startsWith('brains/')) return new Response('not found', { status: 404 });
    const obj = await env.BRAINS.get(key);
    if (!obj) return new Response('not found', { status: 404 });
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('etag', obj.httpEtag);
    headers.set('access-control-allow-origin', '*');
    headers.set('content-type', contentType(key));
    const volatile = key.endsWith('index.json') || key.endsWith('transparency-log.json') || key.endsWith('manifest.json');
    headers.set('cache-control', volatile ? 'no-cache, must-revalidate' : 'public, max-age=300');
    return new Response(request.method === 'HEAD' ? null : obj.body, { headers });
  },
};

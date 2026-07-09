// spiderbrain-brain-creator — R2-backed data plane for the /brains registry.
//
// GET /brains/...            -> the object at that key in R2 (agent-plane files)
// GET /brains/ or /          -> /brains/index.json
// Everything else            -> 404
//
// Read-only + CORS-open (the data is public and source-free). The manifest/index/log
// are served no-cache (they change on each rebuild); the immutable per-commit files
// could be cached hard once we key by <sha> — for now a short TTL.

const CT = {
  '.json': 'application/json; charset=utf-8',
  '.ndjson': 'application/x-ndjson; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function contentType(key) {
  const dot = key.lastIndexOf('.');
  return (dot >= 0 && CT[key.slice(dot)]) || 'application/octet-stream';
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, HEAD, OPTIONS',
          'access-control-max-age': '86400',
        },
      });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405 });
    }

    const url = new URL(request.url);
    let key = decodeURIComponent(url.pathname).replace(/^\/+/, '').replace(/\/+$/, '');
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

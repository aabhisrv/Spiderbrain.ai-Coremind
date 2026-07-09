// adapter.mjs — turn a built brain (synganglion.json) into the /brains registry
// data contract: the source-free agent-plane files + a display record for the pages.
//
// Reuses the SHIPPED, leak-guarded transformer (create/src/export.mjs :: buildUnderstanding)
// so the public registry copy is provably source-free (ALLOWED_KEYS allowlist + FORBIDDEN
// token guard). We only ADD a display record derived from the same public structure.
//
//   node adapter.mjs --brain <brainDir> --owner <o> --repo <r> --out <dir> [--tier official] [--lang TypeScript]
//
// <brainDir> is the output of build-brain.mjs (contains synganglion.json).
// Writes <out>/<owner>/<repo>/{structure.ndjson,manifest.json,AGENTS.block.md,provenance.json,brain.json}.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildUnderstanding } from '../create/src/export.mjs';

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { a[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i]; }
  }
  return a;
}

const SEV = (blast, max) => (blast >= max * 0.5 ? 'high' : blast >= max * 0.2 ? 'med' : 'low');

const byBlast = (a, b) => (b.blastRadius || 0) - (a.blastRadius || 0) || (a.id < b.id ? -1 : 1);

/** A renderable subgraph: the top-N code nodes by blast radius plus the dependency
 *  edges among them. Deterministic (sorted). Small enough to lay out + draw client-side. */
export function graphSubset(nodes, limit = 80) {
  const code = nodes.filter((n) => n.kind === 'code');
  const top = code.slice().sort(byBlast).slice(0, limit);
  const idx = new Map(top.map((n, i) => [n.id, i]));
  const clusters = [...new Set(top.map((n) => n.cluster || ''))].sort();
  const cIndex = new Map(clusters.map((c, i) => [c, i]));
  const maxBlast = top.reduce((m, n) => Math.max(m, n.blastRadius || 0), 0) || 1;
  const gnodes = top.map((n) => ({
    id: n.id,
    label: n.id.split('/').pop(),
    c: cIndex.get(n.cluster || ''),
    b: Math.round(((n.blastRadius || 0) / maxBlast) * 100) / 100, // 0..1
    m: !!n.isMaster,
  }));
  const edges = [];
  for (const n of top) {
    const s = idx.get(n.id);
    for (const dep of (n.dependsOn || [])) {
      const t = idx.get(dep);
      if (t !== undefined && t !== s) edges.push([s, t]);
    }
  }
  return { nodes: gnodes, edges, clusters: clusters.length };
}

/** Build the display record the registry pages render, from the SAME public structure.
 *  meta = { owner, repo, tier, lang, featured }; counts/fp/sha from manifest; builtAt from provenance/brain. */
export function displayRecord({ meta, nodes, manifest, builtAt }) {
  // Only CODE nodes are meaningful hotspots/keystones — config/docs clusters (kind
  // 'content'/'config') have per-cluster masters like .changeset/config.json that are
  // noise for "what breaks" and "where to start".
  const code = nodes.filter((n) => n.kind === 'code');
  const maxBlast = code.reduce((m, n) => Math.max(m, n.blastRadius || 0), 0);
  const hotspots = code
    .filter((n) => (n.blastRadius || 0) > 0)
    .sort(byBlast)
    .slice(0, 6)
    .map((n) => ({ file: n.id, reach: n.blastRadius, sev: SEV(n.blastRadius, maxBlast) }));
  // where-to-start: cluster keystones (code masters) that AREN'T already hotspots, so the two
  // lists stay distinct — "what breaks" vs "where to begin". Rank by reach; pad with next code.
  const hotspotIds = new Set(hotspots.map((h) => h.file));
  const masters = code.filter((n) => n.isMaster && (n.blastRadius || 0) > 0 && !hotspotIds.has(n.id)).sort(byBlast).map((n) => n.id);
  const topCode = code.filter((n) => (n.blastRadius || 0) > 0 && !hotspotIds.has(n.id)).sort(byBlast).map((n) => n.id);
  const startHere = [...new Set([...masters, ...topCode])].slice(0, 5);
  const topHotspot = hotspots[0]?.file || (code[0] && code[0].id) || '';
  return {
    owner: meta.owner,
    repo: meta.repo,
    lang: meta.lang || 'TypeScript',
    tier: meta.tier || 'unofficial',
    featured: !!meta.featured,
    nodes: manifest.counts.files,
    edges: manifest.counts.edges,
    codeFiles: code.length,
    impactReach: maxBlast, // the single most far-reaching file's blast radius (a real, meaningful number)
    topHotspot,
    freshness: 100, // just built; the pipeline sets this from HEAD-vs-build age later
    builtAt: builtAt || null,
    sha: (manifest.scoredFrom ? String(manifest.scoredFrom).slice(0, 7) : 'unknown'),
    graphFingerprint: manifest.graphFingerprint,
    hotspots,
    startHere,
  };
}

export function adapt({ brainDir, owner, repo, out, tier, lang, commit }) {
  const syn = JSON.parse(readFileSync(join(brainDir, 'synganglion.json'), 'utf8'));
  // buildUnderstanding wants { nodes: id->node, edges, stats, sourceHash }
  const { files, manifest } = buildUnderstanding(syn, { private: false, repo: `${owner}/${repo}`, commit: commit || '' });

  const dir = join(out, owner, repo);
  mkdirSync(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents);

  // provenance.json — minimal PROV-O-flavored record (no source locators beyond public paths)
  const provenance = {
    generatedAt: syn.generatedAt || null,
    generatedBy: syn.generatedBy || 'spiderbrain-engine',
    sourceHash: syn.sourceHash || null,
    graphFingerprint: manifest.graphFingerprint,
    engineVersion: manifest.engineVersion,
    determinism: 'measured-ctl',
  };
  writeFileSync(join(dir, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');

  const nodes = files['structure.ndjson'].trim().split('\n').map((l) => JSON.parse(l));
  const display = displayRecord({ meta: { owner, repo, tier, lang, featured: false }, nodes, manifest, builtAt: syn.generatedAt });
  writeFileSync(join(dir, 'brain.json'), JSON.stringify(display, null, 2) + '\n');
  writeFileSync(join(dir, 'graph.json'), JSON.stringify(graphSubset(nodes)) + '\n');

  return { display, manifest };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('adapter.mjs')) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.brain || !a.owner || !a.repo || !a.out) {
    console.error('usage: node adapter.mjs --brain <dir> --owner <o> --repo <r> --out <dir> [--tier t] [--lang L] [--commit sha]');
    process.exit(1);
  }
  const { display, manifest } = adapt({
    brainDir: resolve(a.brain), owner: a.owner, repo: a.repo, out: resolve(a.out),
    tier: a.tier, lang: a.lang, commit: a.commit,
  });
  console.log(`✓ ${a.owner}/${a.repo}: ${manifest.counts.files} files, ${manifest.counts.edges} edges, fp ${manifest.graphFingerprint}`);
  console.log(`  hotspots: ${display.hotspots.map((h) => `${h.file}(${h.reach})`).join(', ') || '(none)'}`);
  console.log(`  keystones: ${display.startHere.join(', ') || '(none)'}`);
}

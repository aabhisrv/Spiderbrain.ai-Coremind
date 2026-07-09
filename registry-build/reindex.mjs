// reindex.mjs — recompute brain.json + _generated/index.json from the persisted
// public/brains/<o>/<r>/{structure.ndjson,manifest.json,provenance.json,brain.json}
// WITHOUT rebuilding brains. Use after changing displayRecord logic.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { displayRecord, graphSubset } from './adapter.mjs';

const HERE = resolve(process.argv[1], '..');
const WEB = resolve(HERE, '../../../Spiderbrain-website');
const PUBLIC_OUT = join(WEB, 'public', 'brains');
const GEN_DIR = join(WEB, 'app', 'brains', '_generated');

const dirsIn = (p) => (existsSync(p) ? readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []);

// Curation: which brain leads the page (featured is a display choice, not a build property).
const FEATURED = 'langchain-ai/langchainjs';

const brains = [];
for (const owner of dirsIn(PUBLIC_OUT)) {
  for (const repo of dirsIn(join(PUBLIC_OUT, owner))) {
    const dir = join(PUBLIC_OUT, owner, repo);
    const bj = join(dir, 'brain.json');
    const sj = join(dir, 'structure.ndjson');
    if (!existsSync(bj) || !existsSync(sj)) continue;
    const prev = JSON.parse(readFileSync(bj, 'utf8'));
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    const prov = existsSync(join(dir, 'provenance.json')) ? JSON.parse(readFileSync(join(dir, 'provenance.json'), 'utf8')) : {};
    const nodes = readFileSync(sj, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const display = displayRecord({
      meta: { owner, repo, tier: prev.tier, lang: prev.lang, featured: `${owner}/${repo}` === FEATURED },
      nodes,
      manifest,
      builtAt: prov.generatedAt || prev.builtAt,
    });
    // preserve full-brain scores captured at build time (reindex has no scored graph)
    if (prev.topFiles && display.topFiles) {
      const sc = new Map(prev.topFiles.map((t) => [t.file, t]));
      for (const t of display.topFiles) {
        const p = sc.get(t.file);
        if (p && p.webscore != null) { t.webscore = p.webscore; t.semantic = p.semantic; t.constitutive = p.constitutive; t.spike = p.spike; }
      }
      display.scored = display.topFiles.some((t) => t.webscore != null);
    }
    writeFileSync(bj, JSON.stringify(display, null, 2) + '\n');
    writeFileSync(join(dir, 'graph.json'), JSON.stringify(graphSubset(nodes)) + '\n');
    brains.push(display);
    console.log(`✓ ${owner}/${repo}: ${display.nodes} files (${display.codeFiles} code), keystones: ${display.startHere.slice(0, 3).join(', ')}`);
  }
}

// Apply pdad-approved tier overrides (brain_overrides, public-readable via the anon key).
// An approved claim in the admin flips a brain to Official here on the next rebuild.
const SUPABASE_URL = 'https://vrloeeqmvbchxqnckuxy.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZybG9lZXFtdmJjaHhxbmNrdXh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyMzgwNDAsImV4cCI6MjA5NTgxNDA0MH0.Piavmozyx2vV_RGfO3g0CgPQc92ATQPCG2gK-i0r4c4';

async function applyOverrides() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/brain_overrides?select=owner,repo,tier`, {
      headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON },
    });
    if (!res.ok) return 0;
    const rows = await res.json();
    const map = new Map(rows.map((r) => [`${r.owner}/${r.repo}`, r.tier]));
    let n = 0;
    for (const b of brains) {
      const t = map.get(`${b.owner}/${b.repo}`);
      if (t && t !== b.tier) { b.tier = t; n++; }
    }
    return n;
  } catch { return -1; } // offline / table missing — skip silently
}

const applied = await applyOverrides();
if (applied > 0) console.log(`applied ${applied} pdad tier override(s)`);

mkdirSync(GEN_DIR, { recursive: true });
// stable order: featured first, then by node count desc
brains.sort((a, b) => (b.featured - a.featured) || (b.nodes - a.nodes));
writeFileSync(join(GEN_DIR, 'index.json'), JSON.stringify({ count: brains.length, brains, failed: [] }, null, 2) + '\n');
console.log(`\nreindexed ${brains.length} brains → ${join(GEN_DIR, 'index.json')}`);

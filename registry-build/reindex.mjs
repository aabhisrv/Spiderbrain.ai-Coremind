// reindex.mjs — recompute brain.json + _generated/index.json from the persisted
// public/brains/<o>/<r>/{structure.ndjson,manifest.json,provenance.json,brain.json}
// WITHOUT rebuilding brains. Use after changing displayRecord logic.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { displayRecord } from './adapter.mjs';

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
    writeFileSync(bj, JSON.stringify(display, null, 2) + '\n');
    brains.push(display);
    console.log(`✓ ${owner}/${repo}: ${display.nodes} files (${display.codeFiles} code), keystones: ${display.startHere.slice(0, 3).join(', ')}`);
  }
}

mkdirSync(GEN_DIR, { recursive: true });
// stable order: featured first, then by node count desc
brains.sort((a, b) => (b.featured - a.featured) || (b.nodes - a.nodes));
writeFileSync(join(GEN_DIR, 'index.json'), JSON.stringify({ count: brains.length, brains, failed: [] }, null, 2) + '\n');
console.log(`\nreindexed ${brains.length} brains → ${join(GEN_DIR, 'index.json')}`);

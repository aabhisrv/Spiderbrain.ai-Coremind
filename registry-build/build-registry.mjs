// build-registry.mjs — the local runner (one of the three the architecture calls for).
// For each seed repo: shallow-clone, capture HEAD sha, run build-brain.mjs headless,
// adapt() the brain into the source-free registry contract, and collect a display record.
// Writes per-repo files into the website's public/brains/<o>/<r>/ (the agent plane) and a
// single _generated/index.json the pages read. Continue-on-error, per-repo time budget.
//
//   node build-registry.mjs
//
// Engine is proprietary + on-box; this is the "cold full rebuild runs locally" path.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { adapt } from './adapter.mjs';

const HERE = resolve(process.argv[1], '..');
const ENGINE = resolve(HERE, '../../spiderbrain-engine');
const BUILD_BRAIN = join(ENGINE, 'scripts', 'build-brain.mjs');
const WEB = resolve(HERE, '../../../Spiderbrain-website');
const PUBLIC_OUT = join(WEB, 'public', 'brains');
const GEN_DIR = join(WEB, 'app', 'brains', '_generated');

// The Track-A (JS/TS) seed set. prey = the one-line goal the engine scores against.
const SEED = [
  { owner: 'langchain-ai', repo: 'langchainjs', url: 'https://github.com/langchain-ai/langchainjs', tier: 'living', lang: 'TypeScript', prey: 'compose LLM apps from runnables', featured: true },
  { owner: 'run-llama', repo: 'LlamaIndexTS', url: 'https://github.com/run-llama/LlamaIndexTS', tier: 'official', lang: 'TypeScript', prey: 'data framework for LLM apps' },
  { owner: 'mastra-ai', repo: 'mastra', url: 'https://github.com/mastra-ai/mastra', tier: 'living', lang: 'TypeScript', prey: 'the TypeScript agent framework' },
  { owner: 'cline', repo: 'cline', url: 'https://github.com/cline/cline', tier: 'official', lang: 'TypeScript', prey: 'autonomous coding agent in the editor' },
  { owner: 'quarto-dev', repo: 'quarto-cli', url: 'https://github.com/quarto-dev/quarto-cli', tier: 'unofficial', lang: 'TypeScript', prey: 'scientific and technical publishing' },
];

const PER_REPO_MS = 6 * 60 * 1000;
const TMP = join(tmpdir(), 'sb-registry-clones');

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });
}

function buildOne(s) {
  const slug = `${s.owner}-${s.repo}`;
  const clone = join(TMP, slug);
  const brain = join(TMP, `${slug}-brain`);
  rmSync(clone, { recursive: true, force: true });
  rmSync(brain, { recursive: true, force: true });

  console.log(`\n[${s.owner}/${s.repo}] cloning (depth 1)…`);
  sh('git', ['clone', '--depth', '1', '--quiet', s.url, clone], { timeout: PER_REPO_MS });
  let sha = '';
  try { sha = sh('git', ['-C', clone, 'rev-parse', 'HEAD']).trim().slice(0, 12); } catch { /* keep '' */ }

  console.log(`[${s.owner}/${s.repo}] building brain…`);
  sh(process.execPath, [BUILD_BRAIN, '--project', clone, '--brain', brain, '--prey', s.prey], { timeout: PER_REPO_MS });

  console.log(`[${s.owner}/${s.repo}] adapting…`);
  const { display, manifest } = adapt({
    brainDir: brain, owner: s.owner, repo: s.repo, out: PUBLIC_OUT,
    tier: s.tier, lang: s.lang, commit: sha,
  });
  display.featured = !!s.featured;
  rmSync(clone, { recursive: true, force: true });
  rmSync(brain, { recursive: true, force: true });
  console.log(`[${s.owner}/${s.repo}] ✓ ${manifest.counts.files} files, ${manifest.counts.edges} edges, fp ${manifest.graphFingerprint}`);
  return display;
}

mkdirSync(TMP, { recursive: true });
mkdirSync(PUBLIC_OUT, { recursive: true });
mkdirSync(GEN_DIR, { recursive: true });

const built = [];
const failed = [];
for (const s of SEED) {
  try {
    built.push(buildOne(s));
  } catch (e) {
    const msg = (e.stderr || e.message || String(e)).toString().split('\n').slice(-3).join(' ').slice(0, 300);
    console.error(`[${s.owner}/${s.repo}] ✗ ${msg}`);
    failed.push({ repo: `${s.owner}/${s.repo}`, error: msg });
  }
}

const index = {
  generatedAt: null, // stamped by caller if needed; kept null for determinism
  count: built.length,
  brains: built,
  failed,
};
writeFileSync(join(GEN_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`\n=== DONE: ${built.length}/${SEED.length} built, ${failed.length} failed ===`);
if (failed.length) console.log('failed:', failed.map((f) => f.repo).join(', '));
console.log('index →', join(GEN_DIR, 'index.json'));

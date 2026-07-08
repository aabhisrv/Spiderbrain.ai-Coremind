/* Conformance suite for the .spiderbrain/ format: the producer (@spiderbrain/create)
 * and the consumer (@spiderbrain/read) tested against one golden fixture. Anyone
 * building a third-party reader or writer can run this suite against SPEC.md.
 * Run from the repo root: node --test test/ */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { buildUnderstanding, mergeAgents } from '../create/src/export.mjs'
import { loadBrain, blast, keystones, impact, pathBetween, verify, parseStructure, integrityOf } from '../read/src/core.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const FIXTURE = JSON.parse(readFileSync(join(here, 'fixtures', 'mini-brain.json'), 'utf8'))
const COMMIT = 'abcdef1234567890abcdef1234567890abcdef12'

function writeFolder(built, root) {
  const dir = join(root, '.spiderbrain')
  mkdirSync(dir, { recursive: true })
  for (const [name, contents] of Object.entries(built.files)) writeFileSync(join(dir, name), contents)
  return dir
}

function freshFolder() {
  const root = mkdtempSync(join(tmpdir(), 'sb-conf-'))
  const built = buildUnderstanding(FIXTURE, { repo: 'acme/mini', commit: COMMIT })
  writeFolder(built, root)
  return { root, built }
}

// ── producer ──────────────────────────────────────────────────────────────────

test('builder is deterministic: two builds are byte-identical', () => {
  const a = buildUnderstanding(FIXTURE, { repo: 'acme/mini', commit: COMMIT })
  const b = buildUnderstanding(FIXTURE, { repo: 'acme/mini', commit: COMMIT })
  for (const name of Object.keys(a.files)) assert.equal(a.files[name], b.files[name], name)
  assert.equal(a.manifest.graphFingerprint, b.manifest.graphFingerprint)
})

test('public build never leaks a weighted score', () => {
  const built = buildUnderstanding(FIXTURE, { repo: 'acme/mini', commit: COMMIT })
  const all = Object.values(built.files).join('\n')
  for (const bad of ['"webscore":', '"spikescore":', '"blindspot01":']) {
    assert.ok(!all.includes(bad), `leaked ${bad}`)
  }
})

test('private build carries scores in scores.ndjson only', () => {
  const built = buildUnderstanding(FIXTURE, { repo: 'acme/mini', commit: COMMIT, private: true })
  assert.ok(built.files['scores.ndjson'].includes('"webscore":0.91'))
  assert.ok(!built.files['structure.ndjson'].includes('webscore'))
})

test('manifest records provenance and counts', () => {
  const { built } = freshFolder()
  assert.equal(built.manifest.repo.name, 'acme/mini')
  assert.equal(built.manifest.repo.commit, COMMIT)
  assert.equal(built.manifest.counts.files, 6)
  assert.equal(built.manifest.variant, 'public')
})

test('mergeAgents is idempotent and preserves human content', () => {
  const { built } = freshFolder()
  const block = built.files['AGENTS.block.md']
  const human = '# My repo\n\nHand-written notes.\n'
  const once = mergeAgents(human, block)
  const twice = mergeAgents(once, block)
  assert.equal(once, twice)
  assert.ok(once.startsWith('# My repo'))
  assert.ok(once.includes('spiderbrain:start'))
})

// ── consumer ──────────────────────────────────────────────────────────────────

test('loadBrain verifies integrity and inverts edges', () => {
  const { root } = freshFolder()
  const b = loadBrain(root)
  assert.equal(b.integrity, 'verified')
  assert.equal(b.ids.length, 6)
  assert.deepEqual(b.nodes['src/util.mjs'].dependedOnBy.sort(), ['src/api.mjs', 'src/core.mjs'])
})

test('blast matches the committed blastRadius (barrel-aware)', () => {
  const { root } = freshFolder()
  const b = loadBrain(root)
  for (const id of b.ids) {
    assert.equal(blast(b.nodes, id).reached.length, b.nodes[id].blastRadius, id)
  }
  // barrel hop costs 0: index is reached from core at cost 0
  const core = blast(b.nodes, 'src/core.mjs')
  assert.deepEqual(core.reached[0], { id: 'src/index.mjs', cost: 0 })
})

test('keystones rank by reach with id tie-break', () => {
  const { root } = freshFolder()
  const b = loadBrain(root)
  assert.deepEqual(keystones(b.nodes, b.ids, 10).map((k) => k.id),
    ['src/util.mjs', 'src/core.mjs', 'src/api.mjs', 'src/index.mjs'])
})

test('impact unions the change set and flags keystones', () => {
  const { root } = freshFolder()
  const b = loadBrain(root)
  const r = impact(b.nodes, b.ids, ['src/core.mjs', 'docs/readme.md', 'brand-new.ts'])
  assert.equal(r.reachedCount, 3) // index, api, app
  assert.deepEqual(r.keystonesTouched, ['src/core.mjs'])
  assert.equal(r.unknownCount, 1) // brand-new.ts not in the brain
})

test('pathBetween finds the import chain', () => {
  const { root } = freshFolder()
  const b = loadBrain(root)
  const r = pathBetween(b.nodes, 'src/app.mjs', 'src/util.mjs')
  assert.equal(r.found, true)
  assert.equal(r.direction, 'imports')
  assert.equal(r.path[0], 'src/app.mjs')
  assert.equal(r.path[r.path.length - 1], 'src/util.mjs')
  const rev = pathBetween(b.nodes, 'src/util.mjs', 'src/app.mjs')
  assert.equal(rev.direction, 'imported-by')
})

test('verify passes on pristine bytes and fails on tamper', () => {
  const { root } = freshFolder()
  assert.equal(verify(root).ok, true)
  assert.equal(verify(root, { headCommit: COMMIT }).current, true)
  assert.equal(verify(root, { headCommit: 'f'.repeat(40) }).ok, false) // stale
  // tamper: flip a byte in structure.ndjson
  const sPath = join(root, '.spiderbrain', 'structure.ndjson')
  writeFileSync(sPath, readFileSync(sPath, 'utf8').replace('"src/app.mjs"', '"src/APP.mjs"'))
  const v = verify(root)
  assert.equal(v.ok, false)
  assert.ok(v.problems.some((p) => p.toLowerCase().includes('fingerprint')))
})

test('parseStructure + integrityOf round-trip standalone', () => {
  const { built } = freshFolder()
  const nodes = parseStructure(built.files['structure.ndjson'])
  assert.equal(Object.keys(nodes).length, 6)
  assert.equal(integrityOf(built.files['structure.ndjson'], built.manifest), 'verified')
})

// ── CLI contract (agents depend on --json + exit codes) ───────────────────────

const CLI = join(here, '..', 'read', 'bin', 'sb.mjs')
function run(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' })
}

test('cli: blast --json emits one JSON object, exit 0', () => {
  const { root } = freshFolder()
  const r = run(['blast', 'src/core.mjs', '--json'], root)
  assert.equal(r.status, 0, r.stderr)
  const j = JSON.parse(r.stdout)
  assert.equal(j.count, 3)
})

test('cli: impact with explicit paths honors --fail-over (exit 1)', () => {
  const { root } = freshFolder()
  const ok = run(['impact', 'src/core.mjs', '--json'], root)
  assert.equal(ok.status, 0)
  assert.equal(JSON.parse(ok.stdout).reachedCount, 3)
  const fail = run(['impact', 'src/core.mjs', '--fail-over', '2', '--json'], root)
  assert.equal(fail.status, 1)
  assert.equal(JSON.parse(fail.stdout).failed, true)
})

test('cli: verify exit codes (0 ok, 1 stale, 0 with --allow-stale)', () => {
  const { root } = freshFolder()
  assert.equal(run(['verify', '--json'], root).status, 0)
  // a fake .git making HEAD differ from the stamped commit
  const git = join(root, '.git')
  mkdirSync(join(git, 'refs', 'heads'), { recursive: true })
  writeFileSync(join(git, 'HEAD'), 'ref: refs/heads/main\n')
  writeFileSync(join(git, 'refs', 'heads', 'main'), '1'.repeat(40) + '\n')
  assert.equal(run(['verify'], root).status, 1)
  assert.equal(run(['verify', '--allow-stale'], root).status, 0)
})

test('cli: unknown file exits 1, unknown command exits 2, no folder exits 3', () => {
  const { root } = freshFolder()
  assert.equal(run(['blast', 'nope.ts'], root).status, 1)
  assert.equal(run(['frobnicate'], root).status, 2)
  const empty = mkdtempSync(join(tmpdir(), 'sb-empty-'))
  const r = run(['keystones'], empty)
  assert.equal(r.status, 3)
  assert.ok((r.stderr || '').includes('npx spiderbrain create'))
})

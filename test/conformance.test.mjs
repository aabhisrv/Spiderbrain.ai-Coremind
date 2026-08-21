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

test('folder ships line-ending armor (.gitattributes -text)', () => {
  const built = buildUnderstanding(FIXTURE, { repo: 'acme/mini', commit: COMMIT })
  assert.ok(built.files['.gitattributes'].includes('* -text'))
})

test('verify + integrity tolerate a CRLF-converted checkout (git autocrlf)', () => {
  const { root } = freshFolder()
  // simulate what autocrlf=true does to the working tree on Windows
  for (const name of ['structure.ndjson', 'AGENTS.block.md']) {
    const p = join(root, '.spiderbrain', name)
    writeFileSync(p, readFileSync(p, 'utf8').replace(/\n/g, '\r\n'))
  }
  const v = verify(root)
  assert.equal(v.ok, true, v.problems.join('; '))
  assert.equal(loadBrain(root).integrity, 'verified')
})

test('cli: a corrupt folder exits 1 and is never masked by the registry', () => {
  const { root } = freshFolder()
  const sPath = join(root, '.spiderbrain', 'structure.ndjson')
  writeFileSync(sPath, 'this is not ndjson {{{\n' + readFileSync(sPath, 'utf8'))
  const r = run(['keystones', '--json'], root)
  assert.equal(r.status, 1)
  assert.ok((r.stderr || '').includes('corrupt'))
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


// ── MCP surface ───────────────────────────────────────────────────────────────
// These exist because the CLI and `verify` told the truth about a tampered or stale brain
// while the MCP server answered from it silently, and nothing in this suite touched MCP.

const MCP_CLI = fileURLToPath(new URL('../read/bin/sb.mjs', import.meta.url))

/** Drive the stdio MCP server through one tool call and return the text of the result. */
function mcpCall(args, cwd, toolName = 'sb_keystones', toolArgs = {}) {
  const reqs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'conformance', version: '1' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: toolName, arguments: toolArgs } },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n'
  const r = spawnSync(process.execPath, [MCP_CLI, 'mcp', ...args], { cwd, input: reqs, encoding: 'utf8', timeout: 60000 })
  const lines = (r.stdout || '').trim().split('\n').filter(Boolean)
  const last = lines.length ? JSON.parse(lines[lines.length - 1]) : null
  return { status: r.status, stderr: r.stderr || '', text: last?.result?.content?.[0]?.text ?? null }
}

test('mcp: --root accepts the space form, the equals form, and SPIDERBRAIN_ROOT', () => {
  const { root } = freshFolder()
  const elsewhere = mkdtempSync(join(tmpdir(), 'sb-cwd-'))

  const space = mcpCall(['--root', root], elsewhere)
  assert.match(space.text, /Load-bearing files/, 'space form: ' + space.stderr)

  // --root=<path> used to be invisible (argv.indexOf('--root')), so the server silently
  // served cwd and told the agent the repo had no understanding layer.
  const equals = mcpCall([`--root=${root}`], elsewhere)
  assert.match(equals.text, /Load-bearing files/, 'equals form: ' + equals.stderr)

  const viaEnv = spawnSync(process.execPath, [MCP_CLI, 'mcp'], {
    cwd: elsewhere,
    env: { ...process.env, SPIDERBRAIN_ROOT: root },
    input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } } }) + '\n' +
           JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'sb_keystones', arguments: {} } }) + '\n',
    encoding: 'utf8',
    timeout: 60000,
  })
  const envLines = (viaEnv.stdout || '').trim().split('\n').filter(Boolean)
  const envText = JSON.parse(envLines[envLines.length - 1]).result.content[0].text
  assert.match(envText, /Load-bearing files/, 'SPIDERBRAIN_ROOT: ' + viaEnv.stderr)
})

test('mcp: a bare --root and a misplaced mcp are errors, not silent fallbacks', () => {
  const elsewhere = mkdtempSync(join(tmpdir(), 'sb-cwd-'))
  // Guessing after an explicit but incomplete instruction is what hid the original bug.
  const bare = spawnSync(process.execPath, [MCP_CLI, 'mcp', '--root'], { cwd: elsewhere, input: '', encoding: 'utf8', timeout: 30000 })
  assert.equal(bare.status, 2)
  assert.match(bare.stderr, /--root was given with no path/)

  // `mcp` anywhere but first fell through to the CLI, which printed help and exited 0 while
  // the client waited for a handshake that never came.
  const misplaced = spawnSync(process.execPath, [MCP_CLI, '--root', elsewhere, 'mcp'], { cwd: elsewhere, input: '', encoding: 'utf8', timeout: 30000 })
  assert.equal(misplaced.status, 2)
  assert.match(misplaced.stderr, /must be the first argument/)
})

test('mcp: a tampered brain is flagged in the tool result, not answered silently', () => {
  const { root } = freshFolder()
  const sPath = join(root, '.spiderbrain', 'structure.ndjson')
  writeFileSync(sPath, readFileSync(sPath, 'utf8') + '{"id":"FAKE/injected.mjs","kind":"code"}\n')

  const r = mcpCall(['--root', root], root)
  assert.match(r.text, /Load-bearing files/, 'should still answer')
  assert.match(r.text, /FAILS its own integrity check/, 'MUST warn the agent the brain is untrustworthy')
})

test('mcp: a stale brain is flagged in the tool result', () => {
  const { root } = freshFolder()
  // The fixture records COMMIT; claim a different HEAD so verify sees staleness.
  const mPath = join(root, '.spiderbrain', 'manifest.json')
  const m = JSON.parse(readFileSync(mPath, 'utf8'))
  const scoredAt = m.repo?.commit || m.scoredFrom
  assert.ok(scoredAt, 'fixture must record the commit it was scored at')

  // A git dir the brain has moved on from: HEAD is a different sha.
  const gitDir = join(root, '.git')
  mkdirSync(gitDir, { recursive: true })
  writeFileSync(join(gitDir, 'HEAD'), 'a'.repeat(40) + '\n')

  const r = mcpCall(['--root', root], root)
  assert.match(r.text, /is STALE/, 'MUST warn that the brain describes older code')
})

test('mcp: a corrupt folder is reported as corrupt, never as missing', () => {
  const { root } = freshFolder()
  writeFileSync(join(root, '.spiderbrain', 'structure.ndjson'), 'this is not ndjson {{{\n')
  const corrupt = mcpCall(['--root', root], root)
  assert.match(corrupt.text, /corrupt, not missing/, 'a corrupt folder told the agent the repo was un-analysed')
  assert.doesNotMatch(corrupt.text, /\.spiderbrain\/ is missing/)

  // And a genuinely absent folder still says missing.
  const empty = mkdtempSync(join(tmpdir(), 'sb-empty-'))
  const absent = mcpCall(['--root', empty], empty)
  assert.match(absent.text, /is missing/)
})

test('bin shebangs ship LF: a CR breaks execve on every POSIX host', () => {
  // All three 0.2.1 tarballs shipped `#!/usr/bin/env node\r\n` because they were packed on
  // Windows. npm repairs it on install; pnpm, yarn, bun and Docker COPY do not.
  const bins = [
    '../spiderbrain/bin/spiderbrain.mjs',
    '../read/bin/sb.mjs',
    '../create/bin/create.mjs',
  ]
  for (const rel of bins) {
    const p = fileURLToPath(new URL(rel, import.meta.url))
    const firstLine = readFileSync(p, 'utf8').split('\n')[0]
    assert.ok(firstLine.startsWith('#!'), `${rel} must start with a shebang`)
    assert.ok(!firstLine.endsWith('\r'), `${rel} shebang ends with CR; execve would look for an interpreter named "node\\r"`)
  }
})

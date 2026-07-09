// signlog.mjs — the transparency log.
//
// One signed record per (repo, commit, engine-version): the graph fingerprint, when
// it was generated, and an ed25519 signature over the canonical record. Anyone can
// verify: (1) the served structure.ndjson still hashes to the fingerprint, and
// (2) the signature checks out against the published public key. Append-only in spirit
// (a re-sign supersedes; the fingerprint is what's attested).
//
// Signing key: a STABLE ed25519 private key kept OUT of the repo (next to the Tauri key).
// In production the worker verifies-bytes-then-signs with the key in a CF secret; this is
// the local-runner variant (same key material, same records).

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as edSign } from 'node:crypto';

const HERE = resolve(process.argv[1], '..');
const WEB = resolve(HERE, '../../../Spiderbrain-website');
const PUBLIC_OUT = join(WEB, 'public', 'brains');
const KEY_PATH = 'C:/Desktop/sharedmac/old/sbkey/brains-log-ed25519.pem';
const ENGINE_VERSION = 'v5';

function loadOrCreateKey() {
  if (existsSync(KEY_PATH)) return createPrivateKey(readFileSync(KEY_PATH, 'utf8'));
  const { privateKey } = generateKeyPairSync('ed25519');
  mkdirSync(dirname(KEY_PATH), { recursive: true });
  writeFileSync(KEY_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  console.log('generated a new transparency-log signing key at', KEY_PATH);
  return privateKey;
}

// canonical JSON (sorted keys) so the signed bytes are deterministic
function canon(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

const dirsIn = (p) => (existsSync(p) ? readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []);

const privateKey = loadOrCreateKey();
const pubJwk = createPublicKey(privateKey).export({ format: 'jwk' }); // { kty:'OKP', crv:'Ed25519', x }

const records = [];
for (const owner of dirsIn(PUBLIC_OUT)) {
  for (const repo of dirsIn(join(PUBLIC_OUT, owner))) {
    const dir = join(PUBLIC_OUT, owner, repo);
    const mPath = join(dir, 'manifest.json');
    const pPath = join(dir, 'provenance.json');
    if (!existsSync(mPath)) continue;
    const m = JSON.parse(readFileSync(mPath, 'utf8'));
    const prov = existsSync(pPath) ? JSON.parse(readFileSync(pPath, 'utf8')) : {};
    const body = {
      owner,
      repo,
      commit: m.repo?.commit || m.scoredFrom || null,
      engineVersion: m.engineVersion || ENGINE_VERSION,
      graphFingerprint: m.graphFingerprint,
      files: m.counts?.files ?? null,
      generatedAt: prov.generatedAt || null,
      determinism: 'same-commit+engine → byte-identical structure',
    };
    const sig = edSign(null, Buffer.from(canon(body)), privateKey).toString('base64');
    records.push({ ...body, sig });
  }
}

const out = {
  algorithm: 'ed25519',
  publicKey: pubJwk.x, // base64url raw ed25519 public key
  note: 'Verify: structure.ndjson still hashes to graphFingerprint, AND sig verifies over the canonical record (all fields except sig) with publicKey.',
  count: records.length,
  records,
};
writeFileSync(join(PUBLIC_OUT, 'transparency-log.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`signed ${records.length} records → public/brains/transparency-log.json`);
console.log('PUBLIC KEY (embed in frontend):', pubJwk.x);

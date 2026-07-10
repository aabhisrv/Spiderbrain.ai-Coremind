// Pre-deploy guard: refuse to deploy unless wrangler is authenticated to the CF
// account this worker is pinned to. The two-account topology (89d110e7 for the SB
// workers, 03d8d4ba for Perform Digital) has bitten deploys before — a wrong-account
// session either fails auth or binds same-named-but-empty resources. This fails LOUD
// before `wrangler deploy` runs.
//
// Reads the expected account_id from wrangler.jsonc and asserts `wrangler whoami`
// lists it among the accessible accounts.

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const cfgPath = resolve(process.cwd(), 'wrangler.jsonc');
const cfg = readFileSync(cfgPath, 'utf8');
// tolerate JSONC comments — just pull the account_id string
const m = cfg.match(/"account_id"\s*:\s*"([0-9a-f]{32})"/i);
if (!m) {
  console.error('check-account: no account_id pinned in wrangler.jsonc — aborting to be safe.');
  process.exit(1);
}
const expected = m[1];

let out = '';
try {
  out = execSync('npx wrangler whoami', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  out = (e.stdout || '') + (e.stderr || '');
}

if (!out.includes(expected)) {
  console.error('\n✗ check-account: wrangler is NOT authenticated to the pinned account.');
  console.error(`  expected account_id: ${expected}`);
  console.error('  `wrangler whoami` did not list it. You are likely logged into the wrong');
  console.error('  Cloudflare account (89d110e7 = SB workers, 03d8d4ba = Perform Digital).');
  console.error('  Run `npx wrangler login` with the correct account, then retry.\n');
  process.exit(1);
}
console.log(`✓ check-account: authenticated to the pinned account ${expected}.`);

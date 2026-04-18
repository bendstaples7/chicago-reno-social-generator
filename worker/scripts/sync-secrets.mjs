/**
 * Syncs all secrets from .dev.vars to the deployed Cloudflare Worker.
 *
 * Usage:
 *   node scripts/sync-secrets.mjs [--dry-run]
 *
 * Reads every KEY=VALUE pair from .dev.vars and pushes each one as a
 * Cloudflare Worker secret via `wrangler secret put`. Skips empty values.
 *
 * Options:
 *   --dry-run   Show what would be synced without actually pushing secrets
 *
 * Exit codes:
 *   0 — all secrets synced (or dry-run completed)
 *   1 — failure (missing .dev.vars, wrangler errors)
 */
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const DRY_RUN = process.argv.includes('--dry-run');

function run(cmd, input) {
  return execSync(cmd, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function parseDevVars() {
  let content;
  try {
    content = readFileSync('.dev.vars', 'utf8');
  } catch {
    console.error('[sync-secrets] ERROR: .dev.vars not found. Run this script from the worker/ directory.');
    process.exit(1);
  }

  const vars = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!key || !value) continue;
    vars.push({ key, value });
  }
  return vars;
}

function getExistingSecrets() {
  try {
    const output = run('npx wrangler secret list');
    const secrets = JSON.parse(output);
    return new Set(secrets.map((s) => s.name));
  } catch {
    return new Set();
  }
}

const vars = parseDevVars();
if (vars.length === 0) {
  console.log('[sync-secrets] No secrets found in .dev.vars.');
  process.exit(0);
}

console.log(`[sync-secrets] Found ${vars.length} secrets in .dev.vars.`);

if (DRY_RUN) {
  console.log('[sync-secrets] DRY RUN — no changes will be made.\n');
}

const existing = getExistingSecrets();
let synced = 0;
let skipped = 0;
let failed = 0;

for (const { key, value } of vars) {
  const status = existing.has(key) ? 'update' : 'create';

  if (DRY_RUN) {
    console.log(`  ${status === 'create' ? '+ CREATE' : '~ UPDATE'} ${key}`);
    synced++;
    continue;
  }

  try {
    run(`npx wrangler secret put ${key}`, value);
    console.log(`  ✅ ${key} (${status}d)`);
    synced++;
  } catch (err) {
    console.error(`  ❌ ${key} — ${err.message || err}`);
    failed++;
  }
}

console.log(`\n[sync-secrets] Done. ${synced} synced, ${skipped} skipped, ${failed} failed.`);
if (failed > 0) process.exit(1);

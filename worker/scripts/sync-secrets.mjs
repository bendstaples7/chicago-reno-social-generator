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
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const DRY_RUN = process.argv.includes('--dry-run');

function runWrangler(args, input) {
  return execFileSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
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
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip matching surrounding quotes (dotenv format)
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key || !value) continue;
    vars.push({ key, value });
  }
  return vars;
}

function getExistingSecrets() {
  try {
    const output = runWrangler(['secret', 'list']);
    const secrets = JSON.parse(output);
    return new Set(secrets.map((s) => s.name));
  } catch (err) {
    console.warn('[sync-secrets] Could not list existing secrets:', err.message || err);
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
let planned = 0;
let failed = 0;

for (const { key, value } of vars) {
  const status = existing.has(key) ? 'update' : 'create';

  if (DRY_RUN) {
    console.log(`  ${status === 'create' ? '+ CREATE' : '~ UPDATE'} ${key}`);
    planned++;
    continue;
  }

  try {
    runWrangler(['secret', 'put', key], value);
    console.log(`  ✅ ${key} (${status}d)`);
    synced++;
  } catch (err) {
    console.error(`  ❌ ${key} — ${err.message || err}`);
    failed++;
  }
}

if (DRY_RUN) {
  console.log(`\n[sync-secrets] Dry run complete. ${planned} secret(s) would be synced.`);
} else {
  console.log(`\n[sync-secrets] Done. ${synced} synced, ${failed} failed.`);
}
if (failed > 0) process.exit(1);

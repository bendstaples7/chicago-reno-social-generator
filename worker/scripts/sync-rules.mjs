/**
 * Pull business rules from production D1 to local D1.
 *
 * Syncs rule_groups and rules tables from remote → local so that
 * local dev has the same rules as production for quote generation.
 *
 * Usage:
 *   node scripts/sync-rules.mjs
 *
 * Gracefully skips if:
 * - Not authenticated with Cloudflare
 * - No network access
 * - No rules in production D1
 */
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function query(flag, sql) {
  try {
    const escaped = sql.replace(/"/g, '\\"');
    const output = run(`npx wrangler d1 execute DB ${flag} --json --command "${escaped}"`);
    const parsed = JSON.parse(output);
    return parsed[0]?.results || [];
  } catch {
    return null;
  }
}

function execFile(flag, sql) {
  const tmpFile = join(tmpdir(), `sync-rules-${Date.now()}.sql`);
  try {
    writeFileSync(tmpFile, sql, 'utf8');
    run(`npx wrangler d1 execute DB ${flag} --file "${tmpFile}"`);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

const esc = (s) => (s ?? '').replace(/'/g, "''");

try {
  console.log('[sync-rules] Pulling rules from production D1...');

  const remoteGroups = query('--remote', 'SELECT id, name, description, display_order, created_at FROM rule_groups');
  if (!remoteGroups) {
    console.log('[sync-rules] Could not reach production D1. Skipping.');
    process.exit(0);
  }

  const remoteRules = query('--remote', 'SELECT id, name, description, rule_group_id, priority_order, is_active, created_at, updated_at FROM rules') || [];

  console.log(`[sync-rules] Found ${remoteGroups.length} rule groups and ${remoteRules.length} rules in production.`);

  if (remoteGroups.length === 0 && remoteRules.length === 0) {
    console.log('[sync-rules] No rules in production. Skipping.');
    process.exit(0);
  }

  // Build SQL to upsert groups and rules into local
  const sqlLines = [];

  // Upsert rule groups — handle both id and name unique constraints
  for (const g of remoteGroups) {
    // Delete any local group with the same name but different id (migration-seeded default)
    sqlLines.push(
      `DELETE FROM rule_groups WHERE name = '${esc(g.name)}' COLLATE NOCASE AND id != '${esc(g.id)}';`
    );
    sqlLines.push(
      `INSERT INTO rule_groups (id, name, description, display_order, created_at) VALUES ('${esc(g.id)}', '${esc(g.name)}', '${esc(g.description)}', ${g.display_order}, '${esc(g.created_at)}') ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description, display_order = excluded.display_order;`
    );
  }

  // Upsert rules
  for (const r of remoteRules) {
    sqlLines.push(
      `INSERT INTO rules (id, name, description, rule_group_id, priority_order, is_active, created_at, updated_at) VALUES ('${esc(r.id)}', '${esc(r.name)}', '${esc(r.description)}', '${esc(r.rule_group_id)}', ${r.priority_order}, ${r.is_active}, '${esc(r.created_at)}', '${esc(r.updated_at)}') ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description, rule_group_id = excluded.rule_group_id, priority_order = excluded.priority_order, is_active = excluded.is_active, updated_at = excluded.updated_at;`
    );
  }

  execFile('--local', sqlLines.join('\n'));
  console.log(`[sync-rules] Synced ${remoteGroups.length} rule groups and ${remoteRules.length} rules from production → local.`);

} catch (err) {
  console.log(`[sync-rules] Could not sync rules: ${err.message}. Skipping.`);
  process.exit(0);
}

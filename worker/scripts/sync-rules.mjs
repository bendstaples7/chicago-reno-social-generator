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

const listRemoteOnly = process.argv.includes('--list-remote');

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function query(flag, sql) {
  try {
    const escaped = sql.replace(/"/g, '\\"');
    const output = run(`npx wrangler d1 execute DB ${flag} --json --command "${escaped}"`);
    const parsed = JSON.parse(output);
    return parsed[0]?.results || [];
  } catch (err) {
    console.debug(`[sync-rules] query failed: ${err.message}`);
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

/** Escape a string for SQL single-quoted literal. Returns SQL NULL for null/undefined. */
function sqlVal(s) {
  if (s === null || s === undefined) return 'NULL';
  return `'${String(s).replace(/'/g, "''")}'`;
}

try {
  console.log(listRemoteOnly ? '[sync-rules] Listing production rules...' : '[sync-rules] Pulling rules from production D1...');

  const remoteGroups = query('--remote', 'SELECT id, name, description, display_order, created_at FROM rule_groups');
  if (!remoteGroups) {
    console.log('[sync-rules] Could not reach production D1. Skipping.');
    process.exit(0);
  }

  const remoteRules = query('--remote', 'SELECT id, name, description, rule_group_id, priority_order, is_active, created_at, updated_at FROM rules');
  if (!remoteRules) {
    if (listRemoteOnly) {
      console.error('[sync-rules] Failed to query rules from production D1.');
      process.exit(1);
    }
    console.log('[sync-rules] Could not query rules from production D1. Skipping.');
    process.exit(0);
  }

  console.log(`[sync-rules] Found ${remoteGroups.length} rule groups and ${remoteRules.length} rules in production.`);

  if (remoteRules.length > 0) {
    for (const r of remoteRules) {
      const status = r.is_active ? '✅' : '⏸️';
      console.log(`  ${status} ${r.name}`);
    }
  }

  if (listRemoteOnly) {
    process.exit(0);
  }

  if (remoteGroups.length === 0 && remoteRules.length === 0) {
    console.log('[sync-rules] No rules in production. Skipping.');
    process.exit(0);
  }

  // Build SQL to upsert groups and rules into local.
  // Order: upsert remote group → repoint stale rules → delete stale group
  // This avoids FK violations from deleting a group that still has rules.
  const sqlLines = [];

  for (const g of remoteGroups) {
    // 1. Upsert the remote group by id
    sqlLines.push(
      `INSERT INTO rule_groups (id, name, description, display_order, created_at) VALUES (${sqlVal(g.id)}, ${sqlVal(g.name)}, ${sqlVal(g.description)}, ${g.display_order}, ${sqlVal(g.created_at)}) ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description, display_order = excluded.display_order;`
    );
    // 2. Repoint any rules from a stale local group with the same name to the remote group id
    sqlLines.push(
      `UPDATE rules SET rule_group_id = ${sqlVal(g.id)} WHERE rule_group_id IN (SELECT id FROM rule_groups WHERE name = ${sqlVal(g.name)} COLLATE NOCASE AND id != ${sqlVal(g.id)});`
    );
    // 3. Now safe to delete the stale local group (no more FK references)
    sqlLines.push(
      `DELETE FROM rule_groups WHERE name = ${sqlVal(g.name)} COLLATE NOCASE AND id != ${sqlVal(g.id)};`
    );
  }

  // Upsert rules
  for (const r of remoteRules) {
    sqlLines.push(
      `INSERT INTO rules (id, name, description, rule_group_id, priority_order, is_active, created_at, updated_at) VALUES (${sqlVal(r.id)}, ${sqlVal(r.name)}, ${sqlVal(r.description)}, ${sqlVal(r.rule_group_id)}, ${r.priority_order}, ${r.is_active}, ${sqlVal(r.created_at)}, ${sqlVal(r.updated_at)}) ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description, rule_group_id = excluded.rule_group_id, priority_order = excluded.priority_order, is_active = excluded.is_active, updated_at = excluded.updated_at;`
    );
  }

  execFile('--local', sqlLines.join('\n'));
  console.log(`[sync-rules] Synced ${remoteGroups.length} rule groups and ${remoteRules.length} rules from production → local.`);

} catch (err) {
  console.log(`[sync-rules] Could not sync rules: ${err.message}. Skipping.`);
  process.exit(0);
}

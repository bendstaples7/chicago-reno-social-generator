/**
 * Sync product_catalog between local and production D1.
 *
 * Usage:
 *   node scripts/sync-catalog.mjs              # Pull: production → local
 *   node scripts/sync-catalog.mjs --push       # Push: local → production
 *   node scripts/sync-catalog.mjs --list-remote # List production catalog only
 *
 * Gracefully skips if:
 * - Not authenticated with Cloudflare
 * - No network access
 * - No products in source database
 */
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const listRemoteOnly = process.argv.includes('--list-remote');
const pushToRemote = process.argv.includes('--push');

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function runWithFile(flag, sql) {
  const tmpFile = join(tmpdir(), `sync-catalog-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  try {
    writeFileSync(tmpFile, sql, 'utf8');
    return run(`npx wrangler d1 execute DB ${flag} --yes --file "${tmpFile}"`);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

function query(flag, sql) {
  try {
    const output = run(`npx wrangler d1 execute DB ${flag} --json --command "${sql.replace(/"/g, '\\"')}"`);
    const parsed = JSON.parse(output);
    return parsed[0]?.results || [];
  } catch (err) {
    console.debug(`[sync-catalog] query failed: ${err.message}`);
    return null;
  }
}

function execFile(flag, sql) {
  runWithFile(flag, sql);
}

/** Escape a string for SQL single-quoted literal. Returns SQL NULL for null/undefined. */
function sqlVal(s) {
  if (s === null || s === undefined) return 'NULL';
  return `'${String(s).replace(/'/g, "''")}'`;
}

const CATALOG_COLUMNS = 'id, user_id, name, unit_price, description, category, sort_order, keywords, source, jobber_active, locally_modified_at, created_at, updated_at';

/**
 * Build SQL to upsert products from source into target.
 * Uses INSERT OR IGNORE + UPDATE by (user_id, name) to avoid clobbering local edits.
 */
function buildUpsertSql(products) {
  const sqlLines = [];

  for (const p of products) {
    // Insert only if no row with this (user_id, name) exists
    sqlLines.push(
      `INSERT OR IGNORE INTO product_catalog (id, user_id, name, unit_price, description, category, sort_order, keywords, source, jobber_active, locally_modified_at, created_at, updated_at) VALUES (${sqlVal(p.id)}, ${sqlVal(p.user_id)}, ${sqlVal(p.name)}, ${p.unit_price}, ${sqlVal(p.description)}, ${sqlVal(p.category)}, ${p.sort_order}, ${sqlVal(p.keywords)}, ${sqlVal(p.source)}, ${p.jobber_active}, ${sqlVal(p.locally_modified_at)}, ${sqlVal(p.created_at)}, ${sqlVal(p.updated_at)});`
    );
    // Update existing rows with all fields from source
    sqlLines.push(
      `UPDATE product_catalog SET unit_price = ${p.unit_price}, description = ${sqlVal(p.description)}, category = ${sqlVal(p.category)}, sort_order = ${p.sort_order}, keywords = ${sqlVal(p.keywords)}, source = ${sqlVal(p.source)}, jobber_active = ${p.jobber_active}, locally_modified_at = ${sqlVal(p.locally_modified_at)}, updated_at = ${sqlVal(p.updated_at)} WHERE user_id = ${sqlVal(p.user_id)} AND name = ${sqlVal(p.name)};`
    );
  }

  return sqlLines.join('\n');
}

try {
  if (pushToRemote) {
    // ── Push: local → production ──────────────────────────────
    console.log('[sync-catalog] Pushing product catalog from local → production D1...');

    const localProducts = query('--local', `SELECT ${CATALOG_COLUMNS} FROM product_catalog`);
    if (!localProducts) {
      console.error('[sync-catalog] Could not read local D1. Aborting.');
      process.exit(1);
    }

    console.log(`[sync-catalog] Found ${localProducts.length} products locally.`);

    if (localProducts.length > 0) {
      const bySource = {};
      for (const p of localProducts) {
        bySource[p.source] = (bySource[p.source] || 0) + 1;
      }
      for (const [source, count] of Object.entries(bySource)) {
        console.log(`  ${source}: ${count} products`);
      }
    }

    if (localProducts.length === 0) {
      console.log('[sync-catalog] No local products to push.');
      process.exit(0);
    }

    const sql = buildUpsertSql(localProducts);
    execFile('--remote', sql);
    console.log(`[sync-catalog] Pushed ${localProducts.length} products from local → production.`);

  } else {
    // ── Pull: production → local (or list) ────────────────────
    console.log(listRemoteOnly ? '[sync-catalog] Listing production catalog...' : '[sync-catalog] Pulling product catalog from production D1...');

    const remoteProducts = query('--remote', `SELECT ${CATALOG_COLUMNS} FROM product_catalog`);
    if (!remoteProducts) {
      console.log('[sync-catalog] Could not reach production D1. Skipping.');
      process.exit(0);
    }

    console.log(`[sync-catalog] Found ${remoteProducts.length} products in production.`);

    if (remoteProducts.length > 0) {
      const bySource = {};
      for (const p of remoteProducts) {
        bySource[p.source] = (bySource[p.source] || 0) + 1;
      }
      for (const [source, count] of Object.entries(bySource)) {
        console.log(`  ${source}: ${count} products`);
      }

      // Show first few product names
      const preview = remoteProducts.slice(0, 5);
      for (const p of preview) {
        const active = p.jobber_active ? '✅' : '⏸️';
        console.log(`  ${active} ${p.name} ($${p.unit_price}) [${p.source}]`);
      }
      if (remoteProducts.length > 5) {
        console.log(`  ... and ${remoteProducts.length - 5} more`);
      }
    }

    if (listRemoteOnly) {
      process.exit(0);
    }

    if (remoteProducts.length === 0) {
      console.log('[sync-catalog] No products in production. Skipping.');
      process.exit(0);
    }

    const sql = buildUpsertSql(remoteProducts);
    execFile('--local', sql);
    console.log(`[sync-catalog] Synced ${remoteProducts.length} products from production → local.`);
  }

} catch (err) {
  console.log(`[sync-catalog] Could not sync catalog: ${err.message}. Skipping.`);
  process.exit(0);
}

/**
 * Apply version-controlled catalog sort_order from JSON file to D1.
 *
 * Usage:
 *   node scripts/apply-catalog-order.mjs           # Apply to local D1 (default)
 *   node scripts/apply-catalog-order.mjs --remote   # Apply to production D1
 *
 * Reads from: worker/data/catalog-order.json
 *
 * Behavior:
 * - Products in JSON but not in D1 → skipped with warning
 * - Products in D1 but not in JSON → left unchanged
 * - Batches updates in groups of 50 (D1 limit)
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT_PATH = resolve(__dirname, '../data/catalog-order.json');

const useRemote = process.argv.includes('--remote');
const flag = useRemote ? '--remote' : '--local';
const target = useRemote ? 'production' : 'local';

const BATCH_SIZE = 50;

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function runWithFile(sql) {
  const tmpFile = join(tmpdir(), `apply-catalog-order-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  try {
    writeFileSync(tmpFile, sql, 'utf8');
    return run(`npx wrangler d1 execute DB ${flag} --yes --file "${tmpFile}"`);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

function query(sql) {
  try {
    const output = run(`npx wrangler d1 execute DB ${flag} --json --command "${sql.replace(/"/g, '\\"')}"`);
    const parsed = JSON.parse(output);
    return parsed[0]?.results || [];
  } catch (err) {
    console.error(`[apply-catalog-order] Query failed: ${err.message}`);
    return null;
  }
}

/** Escape a string for SQL single-quoted literal. */
function sqlVal(s) {
  if (s === null || s === undefined) return 'NULL';
  return `'${String(s).replace(/'/g, "''")}'`;
}

try {
  console.log(`[apply-catalog-order] Applying catalog ordering to ${target} D1...`);

  // Read the JSON file
  let data;
  try {
    const raw = readFileSync(INPUT_PATH, 'utf8');
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`[apply-catalog-order] Could not read ${INPUT_PATH}: ${err.message}`);
    process.exit(1);
  }

  if (!data.products || data.products.length === 0) {
    console.log('[apply-catalog-order] No products in JSON file. Nothing to apply.');
    process.exit(0);
  }

  console.log(`[apply-catalog-order] JSON file has ${data.products.length} products (exported ${data.exportedAt})`);

  // Query existing product names in D1 to detect missing products
  const existing = query('SELECT name FROM product_catalog');
  if (!existing) {
    console.error('[apply-catalog-order] Could not read product catalog from D1. Aborting.');
    process.exit(1);
  }

  const existingNames = new Set(existing.map(p => p.name.toLowerCase()));
  const missing = [];
  const toApply = [];

  for (const p of data.products) {
    if (existingNames.has(p.name.toLowerCase())) {
      toApply.push(p);
    } else {
      missing.push(p.name);
    }
  }

  if (missing.length > 0) {
    console.warn(`[apply-catalog-order] ⚠️  ${missing.length} products in JSON not found in D1 (skipping):`);
    for (const name of missing) {
      console.warn(`  - ${name}`);
    }
  }

  if (toApply.length === 0) {
    console.log('[apply-catalog-order] No matching products to update.');
    process.exit(0);
  }

  // Batch updates in groups of BATCH_SIZE
  let batchCount = 0;
  for (let i = 0; i < toApply.length; i += BATCH_SIZE) {
    const batch = toApply.slice(i, i + BATCH_SIZE);
    const sqlLines = batch.map(p =>
      `UPDATE product_catalog SET sort_order = ${p.sortOrder}, updated_at = datetime('now') WHERE name = ${sqlVal(p.name)} COLLATE NOCASE;`
    );
    runWithFile(sqlLines.join('\n'));
    batchCount++;
  }

  console.log(`[apply-catalog-order] Applied sort_order for ${toApply.length} products (${batchCount} batches)`);
} catch (err) {
  console.error(`[apply-catalog-order] Failed: ${err.message}`);
  process.exit(1);
}

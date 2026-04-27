/**
 * Export product_catalog sort_order to a version-controlled JSON file.
 *
 * Usage:
 *   node scripts/export-catalog-order.mjs           # Export from local D1 (default)
 *   node scripts/export-catalog-order.mjs --remote   # Export from production D1
 *
 * Writes to: worker/data/catalog-order.json
 */
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../data/catalog-order.json');

const useRemote = process.argv.includes('--remote');
const flag = useRemote ? '--remote' : '--local';
const source = useRemote ? 'production' : 'local';

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function query(sql) {
  try {
    const output = run(`npx wrangler d1 execute DB ${flag} --json --command "${sql.replace(/"/g, '\\"')}"`);
    const parsed = JSON.parse(output);
    return parsed[0]?.results || [];
  } catch (err) {
    console.error(`[export-catalog-order] Query failed: ${err.message}`);
    return null;
  }
}

try {
  console.log(`[export-catalog-order] Reading catalog from ${source} D1...`);

  const products = query('SELECT name, sort_order FROM product_catalog ORDER BY sort_order ASC, name ASC');
  if (!products) {
    console.error('[export-catalog-order] Could not read D1. Aborting.');
    process.exit(1);
  }

  if (products.length === 0) {
    console.log('[export-catalog-order] No products found. Aborting.');
    process.exit(1);
  }

  const data = {
    description: 'Product catalog sort order. Committed to git so CI can apply to production D1 on deploy.',
    exportedAt: new Date().toISOString(),
    products: products.map(p => ({
      name: p.name,
      sortOrder: p.sort_order,
    })),
  };

  // Ensure data/ directory exists
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');

  console.log(`[export-catalog-order] Exported ${products.length} products to data/catalog-order.json`);
} catch (err) {
  console.error(`[export-catalog-order] Failed: ${err.message}`);
  process.exit(1);
}

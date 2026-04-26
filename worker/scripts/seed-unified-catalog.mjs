#!/usr/bin/env node
/**
 * Seed the unified product_catalog table from the Jobber CSV export,
 * merging sort_order from manual_catalog_entries and keywords from catalog_keywords.
 *
 * Usage:
 *   node worker/scripts/seed-unified-catalog.mjs                          # dry run (prints SQL)
 *   node worker/scripts/seed-unified-catalog.mjs --apply-local            # apply to local D1
 *   node worker/scripts/seed-unified-catalog.mjs --apply-remote           # apply to remote D1
 *   node worker/scripts/seed-unified-catalog.mjs --apply-local --user-id <id>
 */
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workerDir = resolve(__dirname, '..');

// ── Parse flags ──────────────────────────────────────────────────────

const applyLocal = process.argv.includes('--apply-local');
const applyRemote = process.argv.includes('--apply-remote');

if (applyLocal && applyRemote) {
  console.error('ERROR: Cannot use --apply-local and --apply-remote together.');
  process.exit(1);
}

const userIdIdx = process.argv.indexOf('--user-id');
let userId = '';
if (userIdIdx !== -1 && process.argv[userIdIdx + 1]) {
  userId = process.argv[userIdIdx + 1];
}

if (applyRemote && !userId) {
  console.error('ERROR: --apply-remote requires --user-id <id>');
  console.error('Usage: node worker/scripts/seed-unified-catalog.mjs --apply-remote --user-id <user-uuid>');
  process.exit(1);
}

// ── Parse CSV ────────────────────────────────────────────────────────

const csvPath = resolve(__dirname, '../../Products and Services Export (04_09_2026).csv');
const csv = readFileSync(csvPath, 'utf-8');

function parseCSV(text) {
  const rows = [];
  let i = 0;
  while (i < text.length) {
    const row = [];
    while (i < text.length) {
      if (text[i] === '"') {
        i++;
        let field = '';
        while (i < text.length) {
          if (text[i] === '"') {
            if (i + 1 < text.length && text[i + 1] === '"') { field += '"'; i += 2; }
            else { i++; break; }
          } else { field += text[i]; i++; }
        }
        row.push(field);
        if (i < text.length && text[i] === ',') i++;
      } else {
        let field = '';
        while (i < text.length && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') { field += text[i]; i++; }
        row.push(field);
        if (i < text.length && text[i] === ',') i++;
      }
      if (i >= text.length || text[i] === '\n' || text[i] === '\r') {
        if (text[i] === '\r') i++;
        if (i < text.length && text[i] === '\n') i++;
        break;
      }
    }
    if (row.length > 0) rows.push(row);
  }
  return rows;
}

const rows = parseCSV(csv);
const header = rows[0];
const idx = (name) => header.indexOf(name);

const products = [];
for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  if (row.length < idx('Active') + 1) continue;
  if (row[idx('Active')].trim().toLowerCase() !== 'true') continue;
  const name = row[idx('Name')].trim();
  if (!name) continue;
  products.push({
    name,
    unitPrice: parseFloat(row[idx('Unit Price')]) || 0,
    description: row[idx('Description')].trim().replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim(),
    category: row[idx('Category')].trim(),
  });
}

console.log(`Parsed ${products.length} active products from CSV`);

// ── Helpers ──────────────────────────────────────────────────────────

const esc = (s) => s.replace(/'/g, "''");

function d1query(sql) {
  const flag = applyRemote ? '--remote' : '--local';
  const tmpFile = resolve(__dirname, '_tmp_unified_query.sql');
  writeFileSync(tmpFile, sql, 'utf-8');
  try {
    const cmd = `npx wrangler d1 execute DB ${flag} --json --file "${tmpFile}"`;
    const out = execSync(cmd, { cwd: workerDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return JSON.parse(out);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

// ── Resolve user ID ──────────────────────────────────────────────────

if (!userId && (applyLocal || applyRemote)) {
  try {
    const result = d1query("SELECT id FROM users WHERE id != 'system' ORDER BY rowid LIMIT 1;");
    userId = result[0]?.results?.[0]?.id;
  } catch { /* ignore */ }
  if (!userId) {
    console.error('ERROR: Could not determine user ID from D1. Pass --user-id <id> explicitly.');
    process.exit(1);
  }
} else if (!userId) {
  userId = '<user-id>';
}

console.log(`Target user: ${userId}`);

// ── Fetch sort_order from manual_catalog_entries ─────────────────────

const sortOrderMap = new Map();
if (applyLocal || applyRemote) {
  try {
    const result = d1query(`SELECT name, sort_order FROM manual_catalog_entries WHERE user_id = '${esc(userId)}';`);
    const rows = result[0]?.results || [];
    for (const row of rows) {
      if (row.name && row.sort_order != null) {
        sortOrderMap.set(row.name, row.sort_order);
      }
    }
    console.log(`Fetched ${sortOrderMap.size} sort_order values from manual_catalog_entries`);
  } catch (err) {
    console.warn(`Warning: Could not read manual_catalog_entries: ${err.message}`);
  }
}

// ── Fetch keywords from catalog_keywords ─────────────────────────────

const keywordsMap = new Map();
if (applyLocal || applyRemote) {
  try {
    const result = d1query(`SELECT product_name, keywords FROM catalog_keywords WHERE user_id = '${esc(userId)}';`);
    const rows = result[0]?.results || [];
    for (const row of rows) {
      if (row.product_name && row.keywords) {
        keywordsMap.set(row.product_name, row.keywords);
      }
    }
    console.log(`Fetched ${keywordsMap.size} keyword entries from catalog_keywords`);
  } catch (err) {
    console.warn(`Warning: Could not read catalog_keywords: ${err.message}`);
  }
}

// ── Build SQL ────────────────────────────────────────────────────────

const sqlLines = [
  'BEGIN TRANSACTION;',
  `DELETE FROM product_catalog WHERE user_id = '${esc(userId)}';`,
];

for (const p of products) {
  const id = randomUUID();
  const sortOrder = sortOrderMap.get(p.name) ?? 500;
  const keywords = keywordsMap.get(p.name);
  const keywordsVal = keywords ? `'${esc(keywords)}'` : 'NULL';

  sqlLines.push(
    `INSERT INTO product_catalog (id, user_id, name, unit_price, description, category, sort_order, keywords, source, jobber_active) VALUES ('${id}', '${esc(userId)}', '${esc(p.name)}', ${p.unitPrice}, '${esc(p.description)}', '${esc(p.category)}', ${sortOrder}, ${keywordsVal}, 'jobber', 1);`
  );
}

sqlLines.push('COMMIT;');

const sql = sqlLines.join('\n');

// ── Execute or print ─────────────────────────────────────────────────

if (!applyLocal && !applyRemote) {
  console.log('\n--- SQL OUTPUT (dry run) ---\n');
  console.log(sql);
  console.log(`\n--- ${products.length} products ---`);
  console.log('Run with --apply-local or --apply-remote to execute');
} else {
  const flag = applyRemote ? '--remote' : '--local';
  const tmpFile = resolve(__dirname, '_tmp_unified_seed.sql');
  writeFileSync(tmpFile, sql, 'utf-8');
  console.log(`Generated ${products.length} INSERT statements (transactional)`);

  try {
    const cmd = `npx wrangler d1 execute DB ${flag} --yes --file "${tmpFile}"`;
    execSync(cmd, { cwd: workerDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    console.log(`✅ Seeded ${products.length} products into product_catalog (${flag.replace('--', '')})`);
  } catch (err) {
    console.error('Failed to execute SQL:', err.stderr || err.message);
    process.exit(1);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

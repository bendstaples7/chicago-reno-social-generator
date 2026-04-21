#!/usr/bin/env node
/**
 * Seed the manual_catalog_entries table from the Jobber CSV export.
 * This provides a D1 backup of the product catalog for when the Jobber API is unavailable.
 *
 * Usage:
 *   node scripts/seed-catalog.mjs                # seed local D1
 *   node scripts/seed-catalog.mjs --remote       # seed remote/production D1
 */
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const remote = process.argv.includes('--remote');
const flag = remote ? '--remote' : '--local';

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

// ── Get user ID ──────────────────────────────────────────────────────

function d1exec(sql) {
  const tmpFile = resolve(__dirname, '_tmp_seed.sql');
  writeFileSync(tmpFile, sql, 'utf-8');
  try {
    const cmd = `npx wrangler d1 execute cross-poster-db ${flag} --json --file "${tmpFile}"`;
    const out = execSync(cmd, { cwd: resolve(__dirname, '..'), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return JSON.parse(out);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

const userResult = d1exec("SELECT id FROM users WHERE id != 'system' ORDER BY rowid LIMIT 1;");
const userId = userResult[0]?.results?.[0]?.id;
if (!userId) {
  console.error('No non-system user found in database');
  process.exit(1);
}
console.log(`Target user: ${userId}`);

// ── Build SQL file with all inserts ──────────────────────────────────

const esc = (s) => s.replace(/'/g, "''");

const sqlLines = [
  `DELETE FROM manual_catalog_entries WHERE user_id = '${userId}';`,
];

for (const p of products) {
  const id = randomUUID();
  sqlLines.push(
    `INSERT INTO manual_catalog_entries (id, user_id, name, unit_price, description, category) VALUES ('${id}', '${userId}', '${esc(p.name)}', ${p.unitPrice}, '${esc(p.description)}', '${esc(p.category)}');`
  );
}

const tmpFile = resolve(__dirname, '_tmp_seed.sql');
writeFileSync(tmpFile, sqlLines.join('\n'), 'utf-8');
console.log(`Generated ${sqlLines.length} SQL statements`);

try {
  const cmd = `npx wrangler d1 execute cross-poster-db ${flag} --file "${tmpFile}" --json`;
  execSync(cmd, { cwd: resolve(__dirname, '..'), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  console.log(`✅ Seeded ${products.length} products into manual_catalog_entries (${flag})`);
} catch (err) {
  console.error('Failed to execute SQL:', err.stderr || err.message);
  process.exit(1);
} finally {
  try { unlinkSync(tmpFile); } catch {}
}

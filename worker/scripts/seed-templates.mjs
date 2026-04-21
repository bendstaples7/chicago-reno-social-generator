#!/usr/bin/env node
/**
 * Seed the manual_templates table from the fetched Jobber quote data.
 *
 * Usage:
 *   node scripts/seed-templates.mjs                              # seed local D1
 *   node scripts/seed-templates.mjs --remote                     # seed remote/production D1
 *   node scripts/seed-templates.mjs --user-id <id>               # specify user explicitly
 *   node scripts/seed-templates.mjs --remote --user-id <id>      # remote with explicit user
 */
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const remote = process.argv.includes('--remote');
const flag = remote ? '--remote' : '--local';

const userIdFlagIdx = process.argv.indexOf('--user-id');
const explicitUserId = userIdFlagIdx !== -1 ? process.argv[userIdFlagIdx + 1] : null;

const templates = JSON.parse(readFileSync(resolve(__dirname, 'template-data.json'), 'utf-8'));
console.log(`Loaded ${templates.length} templates`);

function d1execFile(sql) {
  const tmpFile = resolve(__dirname, '_tmp_seed_templates.sql');
  writeFileSync(tmpFile, sql, 'utf-8');
  try {
    const cmd = `npx wrangler d1 execute cross-poster-db ${flag} --file "${tmpFile}" --json`;
    execSync(cmd, { cwd: resolve(__dirname, '..'), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

function d1query(sql) {
  const tmpFile = resolve(__dirname, '_tmp_query_templates.sql');
  writeFileSync(tmpFile, sql, 'utf-8');
  try {
    const cmd = `npx wrangler d1 execute cross-poster-db ${flag} --json --file "${tmpFile}"`;
    const out = execSync(cmd, { cwd: resolve(__dirname, '..'), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return JSON.parse(out);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

// Resolve user ID
let userId;
if (explicitUserId) {
  if (explicitUserId === 'system') {
    console.error('Cannot seed templates for the system user.');
    process.exit(1);
  }
  const check = d1query(`SELECT id FROM users WHERE id = '${explicitUserId.replace(/'/g, "''")}';`);
  if (!check[0]?.results?.[0]?.id) {
    console.error(`User ID '${explicitUserId}' not found in database.`);
    process.exit(1);
  }
  userId = explicitUserId;
} else {
  const userResult = d1query("SELECT id FROM users WHERE id != 'system' ORDER BY rowid LIMIT 1;");
  userId = userResult[0]?.results?.[0]?.id;
  if (!userId) {
    console.error('No non-system user found. Use --user-id <id> to specify one.');
    process.exit(1);
  }
}
console.log(`Target user: ${userId}`);

const esc = (s) => s.replace(/'/g, "''").replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();

const sqlLines = [
  'BEGIN TRANSACTION;',
  `DELETE FROM manual_templates WHERE user_id = '${esc(userId)}';`,
];

for (const t of templates) {
  const id = randomUUID();
  const lineItemsJson = JSON.stringify(t.lineItems.map(li => ({
    name: li.name,
    description: (li.description || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim(),
    quantity: li.quantity,
    unitPrice: li.unitPrice,
  })));
  
  sqlLines.push(
    `INSERT INTO manual_templates (id, user_id, name, content, category, line_items_json) VALUES ('${id}', '${esc(userId)}', '${esc(t.name)}', '${esc(t.content)}', '${esc(t.category || '')}', '${lineItemsJson.replace(/'/g, "''")}');`
  );
}

sqlLines.push('COMMIT;');

d1execFile(sqlLines.join('\n'));
console.log(`✅ Seeded ${templates.length} templates into manual_templates (${flag})`);

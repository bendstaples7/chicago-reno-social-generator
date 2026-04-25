/**
 * Generate keywords for all products in the catalog using AI.
 * Reads the CSV, calls OpenAI to generate matching keywords for each product,
 * and outputs SQL INSERT statements for the catalog_keywords table.
 *
 * Usage:
 *   node worker/scripts/generate-keywords.mjs                    # dry run (prints SQL)
 *   node worker/scripts/generate-keywords.mjs --apply-local      # apply to local D1
 *   node worker/scripts/generate-keywords.mjs --apply-remote     # apply to remote D1
 */
import { readFileSync } from 'fs';
import { writeFileSync, unlinkSync, readdirSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workerDir = resolve(__dirname, '..');

// Read API key from .dev.vars
const devVarsPath = resolve(workerDir, '.dev.vars');
let apiKey = '';
try {
  const devVars = readFileSync(devVarsPath, 'utf-8');
  const match = devVars.match(/^AI_TEXT_API_KEY=(.+)$/m);
  if (match) apiKey = match[1].trim();
} catch { /* ignore */ }

if (!apiKey) {
  console.error('ERROR: AI_TEXT_API_KEY not found in worker/.dev.vars');
  process.exit(1);
}

// Resolve CSV path: --csv flag or glob fallback
const rootDir = resolve(__dirname, '../..');
const csvFlagIdx = process.argv.indexOf('--csv');
let csvPath;
if (csvFlagIdx !== -1 && process.argv[csvFlagIdx + 1]) {
  csvPath = resolve(process.argv[csvFlagIdx + 1]);
} else {
  // Find most recently modified "Products and Services Export*.csv"
  const candidates = readdirSync(rootDir)
    .filter(f => f.startsWith('Products and Services Export') && f.endsWith('.csv'))
    .map(f => ({ name: f, mtime: statSync(resolve(rootDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (candidates.length === 0) {
    console.error('ERROR: No "Products and Services Export*.csv" found in project root. Use --csv <path> to specify.');
    process.exit(1);
  }
  csvPath = resolve(rootDir, candidates[0].name);
  console.log(`Using CSV: ${candidates[0].name}`);
}
const csv = readFileSync(csvPath, 'utf-8');

function parseCSV(text) {
  const rows = [];
  let i = 0;
  while (i < text.length) {
    const row = [];
    while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
      if (text[i] === '"') {
        i++; let field = '';
        while (i < text.length) {
          if (text[i] === '"' && text[i + 1] === '"') { field += '"'; i += 2; }
          else if (text[i] === '"') { i++; break; }
          else { field += text[i]; i++; }
        }
        row.push(field);
        if (i < text.length && text[i] === ',') i++;
      } else {
        let field = '';
        while (i < text.length && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') { field += text[i]; i++; }
        row.push(field);
        if (i < text.length && text[i] === ',') i++;
      }
    }
    if (text[i] === '\r') i++;
    if (text[i] === '\n') i++;
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
  const name = (row[idx('Name')] || '').trim();
  const description = (row[idx('Description')] || '').trim();
  const active = (row[idx('Active')] || '').trim().toLowerCase();
  if (!name || active !== 'true') continue;
  products.push({ name, description });
}

console.log(`Found ${products.length} active products`);

// Generate keywords in batches using AI
const BATCH_SIZE = 30;

async function generateKeywordsBatch(batch) {
  const prompt = [
    'For each product below, generate 2-5 comma-separated keywords or short phrases that a customer might use when requesting this type of work.',
    'Keywords should be alternative terms, common names, or shorthand that customers use in home renovation requests.',
    'Do NOT repeat the product name itself. Focus on how a homeowner would describe the work in plain language.',
    'If the product is a "Materials:" item, include keywords like "material", "supply" combined with the trade.',
    '',
    'Return a JSON object with a "results" array where each element is { "name": "exact product name", "keywords": "keyword1, keyword2, keyword3" }',
    '',
    'Products:',
    ...batch.map((p, i) => `${i + 1}. ${p.name}${p.description ? ' — ' + p.description.slice(0, 100) : ''}`),
  ].join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You generate product matching keywords for a home renovation quoting system. Return ONLY valid JSON with a "results" array.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
    }),
    signal: controller.signal,
  });

  clearTimeout(timeout);

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error('Empty AI response');

  const parsed = JSON.parse(raw);
  return parsed.results || parsed.products || parsed.keywords || [];
}

// Get user ID
const applyLocal = process.argv.includes('--apply-local');
const applyRemote = process.argv.includes('--apply-remote');

// Parse --user-id flag
let userId = '';
const userIdIdx = process.argv.indexOf('--user-id');
if (userIdIdx !== -1 && process.argv[userIdIdx + 1]) {
  userId = process.argv[userIdIdx + 1];
}

if (applyRemote && !userId) {
  console.error('ERROR: --apply-remote requires --user-id <id>');
  console.error('Usage: node worker/scripts/generate-keywords.mjs --apply-remote --user-id <user-uuid>');
  process.exit(1);
}

if (applyLocal && !userId) {
  try {
    const out = execSync('npx wrangler d1 execute DB --local --json --command "SELECT id FROM users LIMIT 1"', { cwd: workerDir, encoding: 'utf-8' });
    const parsed = JSON.parse(out);
    if (parsed[0]?.results?.[0]?.id) userId = parsed[0].results[0].id;
  } catch { /* ignore */ }
  if (!userId) {
    console.error('ERROR: Could not determine user ID from local D1. Pass --user-id <id> explicitly.');
    process.exit(1);
  }
}

// Process all products
const allKeywords = [];
for (let i = 0; i < products.length; i += BATCH_SIZE) {
  const batch = products.slice(i, i + BATCH_SIZE);
  const batchNum = Math.floor(i / BATCH_SIZE) + 1;
  const totalBatches = Math.ceil(products.length / BATCH_SIZE);
  console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} products)...`);

  try {
    const results = await generateKeywordsBatch(batch);
    allKeywords.push(...results);
    console.log(`  → Got ${results.length} keyword entries`);
  } catch (err) {
    console.error(`  ✗ Batch ${batchNum} failed: ${err.message}`);
  }

  // Rate limit
  if (i + BATCH_SIZE < products.length) {
    await new Promise(r => setTimeout(r, 1000));
  }
}

console.log(`\nGenerated keywords for ${allKeywords.length} products`);

// Build SQL
const esc = (s) => s.replace(/'/g, "''");
const sqlLines = [
  '-- Auto-generated catalog keywords',
  `DELETE FROM catalog_keywords WHERE user_id = '${esc(userId)}';`,
];

for (const item of allKeywords) {
  if (!item.name || !item.keywords) continue;
  sqlLines.push(
    `INSERT OR REPLACE INTO catalog_keywords (id, user_id, product_name, keywords) VALUES (hex(randomblob(16)), '${esc(userId)}', '${esc(item.name)}', '${esc(item.keywords)}');`
  );
}

const sql = sqlLines.join('\n');

if (!applyLocal && !applyRemote) {
  console.log('\n--- SQL OUTPUT (dry run) ---\n');
  console.log(sql);
  console.log(`\n--- ${allKeywords.length} products ---`);
  console.log('Run with --apply-local or --apply-remote to execute');
} else {
  const flag = applyRemote ? '--remote' : '--local';
  const SQL_BATCH_SIZE = 50;

  // First, delete existing keywords
  const deleteFile = resolve(__dirname, '_tmp_kw_delete.sql');
  writeFileSync(deleteFile, `DELETE FROM catalog_keywords WHERE user_id = '${esc(userId)}';`, 'utf-8');
  try {
    execSync(`npx wrangler d1 execute DB ${flag} --yes --file "${deleteFile}"`, { cwd: workerDir, stdio: 'inherit' });
    console.log('Cleared existing keywords');
  } finally {
    try { unlinkSync(deleteFile); } catch {}
  }

  // Insert in batches to avoid wrangler file size limits
  const insertLines = sqlLines.slice(2); // skip comment and DELETE
  const totalBatches = Math.ceil(insertLines.length / SQL_BATCH_SIZE);

  for (let b = 0; b < insertLines.length; b += SQL_BATCH_SIZE) {
    const chunk = insertLines.slice(b, b + SQL_BATCH_SIZE);
    const batchNum = Math.floor(b / SQL_BATCH_SIZE) + 1;
    const tmpFile = resolve(__dirname, `_tmp_kw_batch_${batchNum}.sql`);
    writeFileSync(tmpFile, chunk.join('\n'), 'utf-8');

    try {
      execSync(`npx wrangler d1 execute DB ${flag} --yes --file "${tmpFile}"`, { cwd: workerDir, stdio: 'inherit' });
      console.log(`  SQL batch ${batchNum}/${totalBatches} applied (${chunk.length} rows)`);
    } catch (err) {
      console.error(`  SQL batch ${batchNum} failed: ${err.message}`);
    } finally {
      try { unlinkSync(tmpFile); } catch {}
    }
  }

  console.log(`\n✅ Applied ${insertLines.length} keyword entries to ${flag.replace('--', '')} D1`);
}

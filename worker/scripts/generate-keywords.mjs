/**
 * Generate keywords for all products in the unified product_catalog using AI.
 * Reads products from product_catalog in D1, calls OpenAI to generate matching
 * keywords for each product, and writes them back to product_catalog.keywords.
 *
 * Usage:
 *   node worker/scripts/generate-keywords.mjs                    # dry run (prints SQL)
 *   node worker/scripts/generate-keywords.mjs --apply-local      # apply to local D1
 *   node worker/scripts/generate-keywords.mjs --apply-remote     # apply to remote D1
 *   node worker/scripts/generate-keywords.mjs --apply-local --user-id <id>
 */
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workerDir = resolve(__dirname, '..');

// ── Read API key from .dev.vars ──────────────────────────────────────

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

// ── Parse flags ──────────────────────────────────────────────────────

const applyLocal = process.argv.includes('--apply-local');
const applyRemote = process.argv.includes('--apply-remote');

if (applyLocal && applyRemote) {
  console.error('ERROR: Cannot use --apply-local and --apply-remote together.');
  process.exit(1);
}

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

// ── Helpers ──────────────────────────────────────────────────────────

const esc = (s) => s.replace(/'/g, "''");

function d1query(flag, sql) {
  try {
    const output = execSync(
      `npx wrangler d1 execute DB ${flag} --json --command "${sql.replace(/"/g, '\\"')}"`,
      { cwd: workerDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const parsed = JSON.parse(output);
    return parsed[0]?.results || [];
  } catch (err) {
    console.debug(`[generate-keywords] query failed: ${err.message}`);
    return null;
  }
}

function d1execFile(flag, sql) {
  const tmpFile = resolve(__dirname, `_tmp_kw_${Date.now()}.sql`);
  writeFileSync(tmpFile, sql, 'utf-8');
  try {
    execSync(`npx wrangler d1 execute DB ${flag} --yes --file "${tmpFile}"`, {
      cwd: workerDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

// ── Resolve user ID ──────────────────────────────────────────────────

if (!userId && applyLocal) {
  try {
    const rows = d1query('--local', "SELECT id FROM users WHERE id != 'system' ORDER BY rowid LIMIT 1");
    if (rows?.[0]?.id) userId = rows[0].id;
  } catch { /* ignore */ }
  if (!userId) {
    console.error('ERROR: Could not determine user ID from local D1. Pass --user-id <id> explicitly.');
    process.exit(1);
  }
} else if (!userId) {
  userId = '<user-id>';
}

console.log(`Target user: ${userId}`);

// ── Read products from product_catalog ───────────────────────────────

const d1Flag = applyRemote ? '--remote' : '--local';

let products = [];
if (applyLocal || applyRemote) {
  const rows = d1query(d1Flag, `SELECT id, name, description FROM product_catalog WHERE user_id = '${esc(userId)}' ORDER BY sort_order ASC, name ASC`);
  if (!rows) {
    console.error('ERROR: Could not read product_catalog from D1.');
    process.exit(1);
  }
  products = rows.map(r => ({ id: r.id, name: r.name, description: r.description || '' }));
  console.log(`Found ${products.length} products in product_catalog`);
} else {
  console.log('Dry run mode — reading products from CSV fallback for preview.');
  const rootDir = resolve(__dirname, '../..');
  const csvFlagIdx = process.argv.indexOf('--csv');
  let csvPath;
  if (csvFlagIdx !== -1 && process.argv[csvFlagIdx + 1]) {
    csvPath = resolve(process.argv[csvFlagIdx + 1]);
  } else {
    const candidates = readdirSync(rootDir)
      .filter(f => f.startsWith('Products and Services Export') && f.endsWith('.csv'))
      .map(f => ({ name: f, mtime: statSync(resolve(rootDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (candidates.length === 0) {
      console.error('ERROR: No "Products and Services Export*.csv" found. Use --apply-local to read from D1, or --csv <path>.');
      process.exit(1);
    }
    csvPath = resolve(rootDir, candidates[0].name);
    console.log(`Using CSV: ${candidates[0].name}`);
  }
  const csv = readFileSync(csvPath, 'utf-8');
  const lines = csv.split('\n');
  const header = lines[0].split(',');
  const nameIdx = header.indexOf('Name');
  const descIdx = header.indexOf('Description');
  const activeIdx = header.indexOf('Active');
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const name = (cols[nameIdx] || '').trim();
    const active = (cols[activeIdx] || '').trim().toLowerCase();
    if (!name || active !== 'true') continue;
    products.push({ id: `dry-run-${i}`, name, description: (cols[descIdx] || '').trim() });
  }
  console.log(`Found ${products.length} active products from CSV`);
}

if (products.length === 0) {
  console.log('No products found. Nothing to do.');
  process.exit(0);
}


// ── Generate keywords in batches using AI ────────────────────────────

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

// ── Process all products ─────────────────────────────────────────────

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
    console.error('Aborting — will not apply partial keyword data.');
    process.exit(1);
  }

  // Rate limit
  if (i + BATCH_SIZE < products.length) {
    await new Promise(r => setTimeout(r, 1000));
  }
}

console.log(`\nGenerated keywords for ${allKeywords.length} products`);

// ── Build name→id map for matching AI results back to product rows ───

const nameToId = new Map();
for (const p of products) {
  nameToId.set(p.name, p.id);
}

// ── Build SQL: UPDATE product_catalog SET keywords WHERE id ──────────

const sqlLines = [
  '-- Auto-generated catalog keywords (writes to product_catalog.keywords)',
];

let matched = 0;
for (const item of allKeywords) {
  if (!item.name || !item.keywords) continue;
  const productId = nameToId.get(item.name);
  if (!productId) {
    console.warn(`  ⚠ No product_catalog match for "${item.name}" — skipping`);
    continue;
  }
  sqlLines.push(
    `UPDATE product_catalog SET keywords = '${esc(item.keywords)}', updated_at = datetime('now') WHERE id = '${esc(productId)}';`
  );
  matched++;
}

console.log(`Matched ${matched}/${allKeywords.length} keyword entries to product_catalog rows`);

const sql = sqlLines.join('\n');

// ── Execute or print ─────────────────────────────────────────────────

if (!applyLocal && !applyRemote) {
  console.log('\n--- SQL OUTPUT (dry run) ---\n');
  console.log(sql);
  console.log(`\n--- ${matched} UPDATE statements ---`);
  console.log('Run with --apply-local or --apply-remote to execute');
} else {
  const SQL_BATCH_SIZE = 50;
  const updateLines = sqlLines.slice(1); // skip comment line

  if (updateLines.length === 0) {
    console.log('No keyword updates to apply.');
    process.exit(0);
  }

  const totalBatches = Math.ceil(updateLines.length / SQL_BATCH_SIZE);

  for (let b = 0; b < updateLines.length; b += SQL_BATCH_SIZE) {
    const chunk = updateLines.slice(b, b + SQL_BATCH_SIZE);
    const batchNum = Math.floor(b / SQL_BATCH_SIZE) + 1;

    try {
      d1execFile(d1Flag, chunk.join('\n'));
      console.log(`  SQL batch ${batchNum}/${totalBatches} applied (${chunk.length} rows)`);
    } catch (err) {
      console.error(`  SQL batch ${batchNum} failed: ${err.message}`);
    }
  }

  console.log(`\n✅ Updated keywords for ${matched} products in product_catalog (${d1Flag.replace('--', '')})`);
}

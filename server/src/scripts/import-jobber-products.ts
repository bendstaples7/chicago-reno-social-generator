/**
 * Import Jobber products from a CSV export file into the jobber_products table.
 * Usage: npx tsx server/src/scripts/import-jobber-products.ts <path-to-csv>
 *
 * The CSV is expected to have columns:
 *   Name, Description, Category, Unit Price, ..., Active
 */
import fs from 'fs';
import path from 'path';
import pool from '../config/database.js';

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

async function importProducts(csvPath: string) {
  const resolved = path.resolve(csvPath);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(resolved, 'utf-8');
  // Handle multi-line quoted fields by joining lines inside quotes
  const lines: string[] = [];
  let buffer = '';
  let quoteCount = 0;
  for (const line of raw.split('\n')) {
    buffer += (buffer ? '\n' : '') + line;
    quoteCount += (line.match(/"/g) || []).length;
    if (quoteCount % 2 === 0) {
      lines.push(buffer);
      buffer = '';
      quoteCount = 0;
    }
  }
  if (buffer) lines.push(buffer);

  // Skip header
  const header = lines[0];
  console.log('CSV header:', header);
  const dataLines = lines.slice(1).filter((l) => l.trim().length > 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Clear existing imported products
    await client.query('DELETE FROM jobber_products');

    let imported = 0;
    let skipped = 0;

    for (const line of dataLines) {
      const fields = parseCsvLine(line);
      if (fields.length < 4) {
        skipped++;
        continue;
      }

      const name = fields[0];
      const description = fields[1] || '';
      const category = fields[2] || 'Service';
      const unitPrice = parseFloat(fields[3]) || 0;
      const active = fields.length >= 11 ? fields[10].toLowerCase() === 'true' : true;

      if (!name) {
        skipped++;
        continue;
      }

      await client.query(
        `INSERT INTO jobber_products (name, description, category, unit_price, active)
         VALUES ($1, $2, $3, $4, $5)`,
        [name, description, category, unitPrice, active],
      );
      imported++;
    }

    await client.query('COMMIT');
    console.log(`Import complete: ${imported} products imported, ${skipped} skipped.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Import failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: npx tsx server/src/scripts/import-jobber-products.ts <path-to-csv>');
  process.exit(1);
}

importProducts(csvPath).catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

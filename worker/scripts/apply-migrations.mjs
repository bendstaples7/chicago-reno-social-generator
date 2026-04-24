#!/usr/bin/env node
/**
 * Apply D1 migrations non-interactively for local development.
 * Reads migration files from src/migrations/, checks which have been applied
 * via wrangler's d1_migrations table, and applies any new ones.
 */
import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerDir = resolve(__dirname, '..');
const migrationsDir = resolve(workerDir, 'src', 'migrations');

function run(cmd) {
  return execSync(cmd, { cwd: workerDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function getAppliedMigrations() {
  try {
    const output = run('npx wrangler d1 execute DB --local --command "SELECT name FROM d1_migrations ORDER BY id ASC" --json');
    const parsed = JSON.parse(output);
    // Wrangler --json returns an array of result sets
    const names = new Set();
    for (const resultSet of parsed) {
      if (resultSet.results) {
        for (const row of resultSet.results) {
          if (row.name) names.add(row.name);
        }
      }
    }
    return names;
  } catch {
    // Try without --json flag (older wrangler versions)
    try {
      const output = run('npx wrangler d1 execute DB --local --command "SELECT name FROM d1_migrations ORDER BY id ASC"');
      const names = new Set();
      // Parse lines containing .sql filenames
      for (const line of output.split('\n')) {
        const match = line.match(/(\d{4}_[^\s"│|]+\.sql)/);
        if (match) names.add(match[1]);
      }
      return names;
    } catch {
      return new Set();
    }
  }
}

function getAllMigrations() {
  return readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();
}

const applied = getAppliedMigrations();
const all = getAllMigrations();
const pending = all.filter(m => !applied.has(m));

console.log(`[migrations] ${applied.size} already applied, ${all.length} total, ${pending.length} pending.`);

if (pending.length === 0) {
  console.log('[migrations] All migrations already applied.');
  process.exit(0);
}

console.log(`[migrations] Applying ${pending.length} migration(s)...`);

for (const migration of pending) {
  const filePath = resolve(migrationsDir, migration);
  try {
    run(`npx wrangler d1 execute DB --local --file "${filePath}"`);
    // Record in d1_migrations so wrangler's own tracker stays in sync
    const escapedName = migration.replace(/'/g, "''");
    run(`npx wrangler d1 execute DB --local --command "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${escapedName}')"`);
    console.log(`  ✅ ${migration}`);
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('duplicate column') || msg.includes('already exists') || msg.includes('UNIQUE constraint')) {
      try {
        const escapedName = migration.replace(/'/g, "''");
        run(`npx wrangler d1 execute DB --local --command "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${escapedName}')"`);
      } catch { /* ignore */ }
      console.log(`  ⏭️  ${migration} (already applied)`);
      continue;
    }
    console.error(`  ❌ ${migration}: ${msg}`);
    process.exit(1);
  }
}

console.log('[migrations] Done.');

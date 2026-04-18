/**
 * Bidirectional Jobber OAuth token sync between local and production D1.
 *
 * Called automatically by `npm run dev` before starting wrangler dev.
 * Requires wrangler to be authenticated (`wrangler login`).
 *
 * Logic:
 * - Reads tokens from both local and production D1
 * - Whichever has the newer updated_at wins and is copied to the other
 * - If only one side has tokens, copies to the other
 *
 * Gracefully skips if:
 * - Not authenticated with Cloudflare
 * - No network access
 * - No tokens in either D1
 */
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function queryTokens(flag) {
  try {
    const output = run(
      `npx wrangler d1 execute DB ${flag} --json --command "SELECT access_token, refresh_token, updated_at FROM jobber_tokens WHERE id = 'default'"`
    );
    const parsed = JSON.parse(output);
    const results = parsed[0]?.results || [];
    if (results.length === 0) return null;
    return results[0];
  } catch {
    return null;
  }
}

function upsertTokens(flag, accessToken, refreshToken) {
  const sql = `INSERT INTO jobber_tokens (id, access_token, refresh_token, updated_at) VALUES ('default', '${accessToken}', '${refreshToken}', datetime('now')) ON CONFLICT (id) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token, updated_at = excluded.updated_at;`;
  const tmpFile = join(tmpdir(), `sync-tokens-${Date.now()}.sql`);
  try {
    writeFileSync(tmpFile, sql, 'utf8');
    run(`npx wrangler d1 execute DB ${flag} --file "${tmpFile}"`);
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

try {
  console.log('[sync-tokens] Syncing Jobber tokens between local and production D1...');

  // Read from both sides
  const local = queryTokens('--local');

  let remote;
  try {
    remote = queryTokens('--remote');
  } catch {
    console.log('[sync-tokens] Could not reach production D1. Skipping.');
    process.exit(0);
  }

  if (!local && !remote) {
    console.log('[sync-tokens] No tokens in either local or production D1. Skipping.');
    process.exit(0);
  }

  if (!local && remote) {
    // Production has tokens, local doesn't — copy to local
    upsertTokens('--local', remote.access_token, remote.refresh_token);
    console.log('[sync-tokens] Copied tokens from production → local.');
  } else if (local && !remote) {
    // Local has tokens, production doesn't — copy to production
    upsertTokens('--remote', local.access_token, local.refresh_token);
    console.log('[sync-tokens] Copied tokens from local → production.');
  } else {
    // Both have tokens — newer wins
    const localTime = new Date(local.updated_at + 'Z').getTime();
    const remoteTime = new Date(remote.updated_at + 'Z').getTime();

    if (localTime > remoteTime) {
      upsertTokens('--remote', local.access_token, local.refresh_token);
      console.log('[sync-tokens] Local tokens are newer — pushed to production.');
    } else if (remoteTime > localTime) {
      upsertTokens('--local', remote.access_token, remote.refresh_token);
      console.log('[sync-tokens] Production tokens are newer — pulled to local.');
    } else {
      console.log('[sync-tokens] Tokens are in sync.');
    }
  }
} catch (err) {
  console.log(`[sync-tokens] Unexpected error: ${err.message}. Skipping.`);
  process.exit(0);
}

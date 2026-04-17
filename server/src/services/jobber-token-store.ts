/**
 * Persists Jobber OAuth tokens to PostgreSQL so they survive server restarts.
 *
 * On startup the JobberIntegration loads tokens from this store, falling back
 * to process.env when no DB row exists yet. After every successful token
 * refresh the new pair is written here immediately, so the next server start
 * always picks up the latest valid tokens.
 */

import { query } from '../config/database.js';

export class JobberTokenStore {
  /**
   * Load the most recent token pair from PostgreSQL.
   * Returns null if no tokens have been persisted yet or if the table
   * doesn't exist (migration not applied).
   */
  async load(): Promise<{ accessToken: string; refreshToken: string } | null> {
    try {
      const result = await query(
        "SELECT access_token, refresh_token FROM jobber_tokens WHERE id = 'default'",
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0] as { access_token: string; refresh_token: string };
      return { accessToken: row.access_token, refreshToken: row.refresh_token };
    } catch (err) {
      // Table may not exist yet (migration not applied) — treat as empty
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('does not exist')) {
        return null;
      }
      // Log but don't throw — caller will fall back to .env
      console.error('[JobberTokenStore] Failed to load tokens from DB:', message);
      return null;
    }
  }

  /**
   * Persist a token pair to PostgreSQL. Uses upsert so the first write
   * creates the row and subsequent writes update it.
   */
  async save(accessToken: string, refreshToken: string): Promise<void> {
    try {
      await query(
        `INSERT INTO jobber_tokens (id, access_token, refresh_token, updated_at)
         VALUES ('default', $1, $2, NOW())
         ON CONFLICT (id) DO UPDATE SET
           access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           updated_at = EXCLUDED.updated_at`,
        [accessToken, refreshToken],
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('does not exist')) {
        console.warn('[JobberTokenStore] jobber_tokens table not found — migration may not be applied yet');
        return;
      }
      // Re-throw so the caller knows persistence failed
      throw err;
    }
  }
}

/**
 * Persists Jobber OAuth tokens to D1 so they survive across worker cold starts.
 *
 * On each request the worker loads tokens from this store (falling back to
 * env/secrets when no DB row exists). After a successful token refresh the
 * new pair is written back here, so the next cold start picks up the latest
 * tokens automatically.
 */
export class JobberTokenStore {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Load the most recent token pair from D1.
   * Returns null if no tokens have been persisted yet.
   */
  async load(): Promise<{ accessToken: string; refreshToken: string } | null> {
    try {
      const row = await this.db.prepare(
        "SELECT access_token, refresh_token FROM jobber_tokens WHERE id = 'default'"
      ).first() as { access_token: string; refresh_token: string } | null;

      if (!row) return null;
      return { accessToken: row.access_token, refreshToken: row.refresh_token };
    } catch {
      // Table may not exist yet (migration not applied)
      return null;
    }
  }

  /**
   * Persist a token pair to D1. Uses upsert so the first write creates the
   * row and subsequent writes update it.
   */
  async save(accessToken: string, refreshToken: string): Promise<void> {
    try {
      await this.db.prepare(
        `INSERT INTO jobber_tokens (id, access_token, refresh_token, updated_at)
         VALUES ('default', ?, ?, datetime('now'))
         ON CONFLICT (id) DO UPDATE SET
           access_token = excluded.access_token,
           refresh_token = excluded.refresh_token,
           updated_at = excluded.updated_at`
      ).bind(accessToken, refreshToken).run();
    } catch (err) {
      console.error('[JobberTokenStore] Failed to persist tokens:', err);
    }
  }
}

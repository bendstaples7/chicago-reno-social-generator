import { Hono } from 'hono';
import type { Bindings } from '../bindings.js';
import type { User, SystemsStatusResponse } from 'shared';
import { sessionMiddleware } from '../middleware/session.js';
import { JobberTokenStore } from '../services/jobber-token-store.js';

const app = new Hono<{ Bindings: Bindings; Variables: { user: User } }>();

app.use('*', sessionMiddleware);

/**
 * GET /
 * Returns aggregated status of all external service connections.
 * Jobber: checks if valid OAuth tokens exist in D1.
 * Instagram: checks channel_connections for the authenticated user.
 */
app.get('/', async (c) => {
  const db = c.env.DB;
  const userId = c.get('user').id;

  // ── Jobber token availability (fail-closed: unavailable on error) ──
  let jobberAvailable = false;
  try {
    const tokenStore = new JobberTokenStore(db);
    const tokens = await tokenStore.load();
    jobberAvailable = tokens !== null;
  } catch {
    // D1 error — fail-closed, report unavailable
  }

  // ── Instagram channel status (fail-open: not_connected on error) ──
  let instagramStatus: SystemsStatusResponse['instagram'] = { status: 'not_connected' };
  try {
    const row = await db.prepare(
      "SELECT status, external_account_name FROM channel_connections WHERE user_id = ? AND channel_type = 'instagram' ORDER BY updated_at DESC LIMIT 1"
    ).bind(userId).first() as { status: string; external_account_name: string | null } | null;

    if (row) {
      const status = row.status === 'connected'
        ? 'connected' as const
        : row.status === 'expired'
          ? 'expired' as const
          : 'not_connected' as const;

      instagramStatus = {
        status,
        ...(row.external_account_name ? { accountName: row.external_account_name } : {}),
      };
    }
  } catch {
    // D1 error — fail-open, report not_connected
  }

  const response: SystemsStatusResponse = {
    jobber: { available: jobberAvailable },
    instagram: instagramStatus,
  };

  return c.json(response);
});

export default app;

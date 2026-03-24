import { Hono } from 'hono';
import type { Bindings } from '../bindings.js';
import type { User } from 'shared';
import { sessionMiddleware } from '../middleware/session.js';
import { ActivityLogService } from '../services/activity-log-service.js';

const app = new Hono<{ Bindings: Bindings; Variables: { user: User } }>();

app.use('*', sessionMiddleware);

/**
 * GET /
 * Returns paginated activity log entries for the authenticated user.
 */
app.get('/', async (c) => {
  const userId = c.get('user').id;
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20', 10) || 20));

  const activityLogService = new ActivityLogService(c.env.DB);
  const entries = await activityLogService.getEntries(userId, { page, limit });
  return c.json({ entries, page, limit });
});

export default app;

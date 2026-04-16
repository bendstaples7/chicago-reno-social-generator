import { Hono } from 'hono';
import type { Bindings } from '../bindings.js';
import { JobberWebhookService, type JobberWebhookPayload } from '../services/jobber-webhook-service.js';
import { ActivityLogService } from '../services/index.js';

const app = new Hono<{ Bindings: Bindings }>();

/**
 * POST /jobber
 *
 * Receives Jobber webhook events. No session auth — verified via HMAC.
 * Responds immediately, processes via waitUntil for async handling.
 */
app.post('/jobber', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('x-jobber-hmac-sha256') || '';

  const activityLog = new ActivityLogService(c.env.DB);
  const webhookService = new JobberWebhookService(c.env.DB, activityLog, {
    accessToken: c.env.JOBBER_ACCESS_TOKEN || '',
    clientSecret: c.env.JOBBER_CLIENT_SECRET || '',
    clientId: c.env.JOBBER_CLIENT_ID || '',
    refreshToken: c.env.JOBBER_REFRESH_TOKEN || '',
  });

  // Verify HMAC signature
  if (c.env.JOBBER_CLIENT_SECRET) {
    if (!signature || !(await webhookService.verifySignature(rawBody, signature))) {
      return c.json({ error: 'Invalid signature' }, 401);
    }
  }

  let payload: JobberWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as JobberWebhookPayload;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!payload?.data?.webHookEvent?.topic || !payload?.data?.webHookEvent?.itemId) {
    return c.json({ error: 'Invalid webhook payload' }, 400);
  }

  // Process asynchronously via waitUntil (keeps worker alive after response)
  c.executionCtx.waitUntil(
    webhookService.processWebhook(payload).catch((err) => {
      console.error('Webhook processing error:', err);
    })
  );

  return c.json({ received: true }, 200);
});

/**
 * POST /backfill
 *
 * One-time backfill: fetches all existing requests from Jobber API,
 * then fetches full details for each and stores in the webhook table.
 * Protected by JOBBER_CLIENT_SECRET in the Authorization header.
 */
app.post('/backfill', async (c) => {
  // Simple secret-based auth for this admin endpoint
  const authHeader = c.req.header('Authorization') || '';
  const secret = c.env.JOBBER_CLIENT_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Prevent concurrent backfills — check if one ran recently
  const db = c.env.DB;
  try {
    const recent = await db.prepare(
      `SELECT COUNT(*) as count FROM jobber_webhook_requests WHERE topic = 'BACKFILL' AND received_at > datetime('now', '-5 minutes')`
    ).first() as { count: number } | null;
    if ((recent?.count ?? 0) > 0) {
      return c.json({ error: 'Backfill ran recently. Wait 5 minutes before retrying.' }, 429);
    }
  } catch { /* table may not exist yet, proceed */ }

  const activityLog = new ActivityLogService(db);
  const webhookService = new JobberWebhookService(db, activityLog, {
    accessToken: c.env.JOBBER_ACCESS_TOKEN || '',
    clientSecret: c.env.JOBBER_CLIENT_SECRET || '',
    clientId: c.env.JOBBER_CLIENT_ID || '',
    refreshToken: c.env.JOBBER_REFRESH_TOKEN || '',
  });

  const result = await webhookService.backfillFromApi(c.env.JOBBER_ACCESS_TOKEN || '');
  return c.json({ message: 'Backfill complete', ...result });
});

export default app;

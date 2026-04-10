import { Router, type Request, type Response, type NextFunction } from 'express';
import { JobberWebhookService, type JobberWebhookPayload } from '../services/jobber-webhook-service.js';
import { ActivityLogService } from '../services/index.js';

const router = Router();
const activityLog = new ActivityLogService();
const webhookService = new JobberWebhookService(activityLog);

/**
 * Middleware to capture the raw body for HMAC verification.
 * Express's json() parser consumes the body, so we store the raw string
 * on the request before parsing.
 */
function rawBodyCapture(req: Request, _res: Response, next: NextFunction): void {
  let data = '';
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => { data += chunk; });
  req.on('end', () => {
    (req as Request & { rawBody: string }).rawBody = data;
    try {
      req.body = JSON.parse(data);
    } catch {
      req.body = {};
    }
    next();
  });
}

/**
 * POST /api/webhooks/jobber
 *
 * Receives Jobber webhook events. No session auth required — verified via
 * HMAC signature in the X-Jobber-Hmac-SHA256 header.
 *
 * Must respond within 1 second per Jobber's requirements, so we acknowledge
 * immediately and process asynchronously.
 */
router.post('/jobber', rawBodyCapture, (req: Request, res: Response) => {
  const rawBody = (req as Request & { rawBody: string }).rawBody || '';
  const signature = req.headers['x-jobber-hmac-sha256'] as string | undefined;

  // Verify HMAC signature — fail closed if secret is not configured
  if (!process.env.JOBBER_CLIENT_SECRET) {
    console.warn('Jobber webhook rejected: JOBBER_CLIENT_SECRET not configured');
    res.status(503).json({ error: 'Webhook secret not configured' });
    return;
  }
  if (!signature || !webhookService.verifySignature(rawBody, signature)) {
    console.warn('Jobber webhook signature verification failed');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  const payload = req.body as JobberWebhookPayload;

  // Validate payload structure
  if (!payload?.data?.webHookEvent?.topic || !payload?.data?.webHookEvent?.itemId) {
    res.status(400).json({ error: 'Invalid webhook payload' });
    return;
  }

  // Respond immediately (Jobber requires < 1 second response)
  res.status(200).json({ received: true });

  // Process asynchronously
  webhookService.processWebhook(payload).catch((err) => {
    console.error('Webhook processing error:', err);
  });
});

export default router;
export { webhookService };

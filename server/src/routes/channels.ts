import { Router } from 'express';
import crypto from 'node:crypto';
import { InstagramChannel } from '../services/index.js';
import { sessionMiddleware } from '../middleware/session.js';
import { query } from '../config/database.js';
import type { ChannelConnection } from 'shared';

const router = Router();
const instagramChannel = new InstagramChannel();

// All channel routes require authentication
router.use(sessionMiddleware);

/**
 * GET /channels
 * List connected channels for the authenticated user.
 */
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, user_id, channel_type, external_account_id, external_account_name,
              access_token_encrypted, token_expires_at, status, created_at, updated_at
       FROM channel_connections
       WHERE user_id = $1`,
      [req.user!.id],
    );

    const channels: ChannelConnection[] = result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      userId: row.user_id as string,
      channelType: row.channel_type as string,
      externalAccountId: row.external_account_id as string,
      externalAccountName: row.external_account_name as string,
      accessTokenEncrypted: row.access_token_encrypted as string,
      tokenExpiresAt: new Date(row.token_expires_at as string),
      status: row.status as ChannelConnection['status'],
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    }));

    res.json({ channels });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /channels/instagram/connect
 * Connect Instagram using the Facebook Page Access Token from .env.
 * If INSTAGRAM_CLIENT_ID is set, starts OAuth flow instead.
 */
router.post('/instagram/connect', async (req, res, next) => {
  try {
    const pageToken = process.env.FB_PAGE_ACCESS_TOKEN;
    const igAccountId = process.env.IG_BUSINESS_ACCOUNT_ID;

    // Direct token mode: use pre-configured Page Access Token
    if (pageToken && igAccountId) {
      const userId = req.user!.id;

      // Fetch the IG username for display
      let accountName = 'Instagram Account';
      try {
        const profileRes = await fetch(
          `https://graph.facebook.com/v25.0/${igAccountId}?fields=username,name&access_token=${pageToken}`,
        );
        if (profileRes.ok) {
          const profile = (await profileRes.json()) as { username?: string; name?: string };
          accountName = profile.username ?? profile.name ?? accountName;
        }
      } catch {
        // Best-effort
      }

      const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // 60 days

      // Remove any existing connection for this user+channel, then insert fresh
      await query(
        `DELETE FROM channel_connections WHERE user_id = $1 AND channel_type = 'instagram'`,
        [userId],
      );

      const result = await query(
        `INSERT INTO channel_connections (user_id, channel_type, external_account_id, external_account_name, access_token_encrypted, token_expires_at, status)
         VALUES ($1, 'instagram', $2, $3, $4, $5, 'connected')
         RETURNING id, user_id, channel_type, external_account_id, external_account_name, status, created_at, updated_at`,
        [userId, igAccountId, accountName, pageToken, expiresAt],
      );

      const row = result.rows[0];
      res.json({
        connected: true,
        channel: {
          id: row.id as string,
          userId: row.user_id as string,
          channelType: row.channel_type as string,
          externalAccountId: row.external_account_id as string,
          externalAccountName: row.external_account_name as string,
          status: row.status as string,
          createdAt: new Date(row.created_at as string),
          updatedAt: new Date(row.updated_at as string),
        },
      });
      return;
    }

    // OAuth mode: start Instagram OAuth flow
    const clientId = process.env.INSTAGRAM_CLIENT_ID;
    if (!clientId) {
      res.status(400).json({ error: 'Instagram is not configured. Set FB_PAGE_ACCESS_TOKEN or INSTAGRAM_CLIENT_ID in .env' });
      return;
    }

    const state = crypto.randomBytes(32).toString('hex');
    const authorizationUrl = instagramChannel.getAuthorizationUrl(state);
    res.json({ authorizationUrl, state });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /channels/instagram/callback
 * Handle Instagram OAuth callback.
 */
router.get('/instagram/callback', async (req, res, next) => {
  try {
    const code = req.query.code as string;
    const state = req.query.state as string;
    const connection = await instagramChannel.handleAuthCallback(code, req.user!.id);
    res.json(connection);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /channels/:id
 * Disconnect a channel.
 */
router.delete('/:id', async (req, res, next) => {
  try {
    // Verify the channel belongs to the authenticated user before disconnecting
    const check = await query(
      'SELECT id FROM channel_connections WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user!.id],
    );
    if (check.rows.length === 0) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }
    await instagramChannel.disconnect(req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;

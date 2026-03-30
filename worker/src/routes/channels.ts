import { Hono } from 'hono';
import type { Bindings } from '../bindings.js';
import type { User, ChannelConnection } from 'shared';
import { sessionMiddleware } from '../middleware/session.js';
import { InstagramChannel, encrypt as encryptToken } from '../services/instagram-channel.js';
import { PlatformError } from '../errors/index.js';

const app = new Hono<{ Bindings: Bindings; Variables: { user: User } }>();

app.use('*', sessionMiddleware);

// Refresh threshold: refresh tokens that expire within 7 days
const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * GET /
 * List connected channels for the authenticated user.
 * Automatically refreshes Instagram tokens nearing expiration and
 * marks expired connections.
 */
app.get('/', async (c) => {
  const db = c.env.DB;
  const result = await db.prepare(
    'SELECT id, user_id, channel_type, external_account_id, external_account_name, token_expires_at, status, created_at, updated_at FROM channel_connections WHERE user_id = ?'
  ).bind(c.get('user').id).all();

  const channels: Array<Record<string, unknown>> = [];

  for (const row of result.results as any[]) {
    let status = row.status as string;

    // Check token expiry for connected channels
    if (status === 'connected' && row.token_expires_at) {
      const expiresAt = new Date(row.token_expires_at as string).getTime();
      const now = Date.now();

      if (expiresAt < now) {
        // Token has expired — mark as expired
        await db.prepare(
          "UPDATE channel_connections SET status = 'expired', updated_at = datetime('now') WHERE id = ?"
        ).bind(row.id).run();
        status = 'expired';
      } else if (expiresAt - now < REFRESH_THRESHOLD_MS && row.channel_type === 'instagram') {
        // Token expiring soon — attempt auto-refresh
        try {
          const instagramChannel = new InstagramChannel({
            db,
            encryptionKey: c.env.CHANNEL_ENCRYPTION_KEY,
            publicUrl: c.env.S3_PUBLIC_URL,
            clientSecret: c.env.INSTAGRAM_CLIENT_SECRET,
          });
          const refreshed = await instagramChannel.refreshToken(row.id as string);
          if (refreshed) {
            channels.push({
              id: refreshed.id,
              userId: refreshed.userId,
              channelType: refreshed.channelType,
              externalAccountId: refreshed.externalAccountId,
              externalAccountName: refreshed.externalAccountName,
              status: refreshed.status,
              createdAt: refreshed.createdAt,
              updatedAt: refreshed.updatedAt,
            });
            continue;
          }
        } catch {
          // Refresh failed — still show current status
        }
      }
    }

    channels.push({
      id: row.id as string,
      userId: row.user_id as string,
      channelType: row.channel_type as string,
      externalAccountId: row.external_account_id as string,
      externalAccountName: row.external_account_name as string,
      status,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    });
  }

  return c.json({ channels });
});

/**
 * POST /instagram/connect
 * Connect Instagram using the Facebook Page Access Token from env.
 * If INSTAGRAM_CLIENT_ID is set, starts OAuth flow instead.
 */
app.post('/instagram/connect', async (c) => {
  const pageToken = c.env.FB_PAGE_ACCESS_TOKEN;
  const igAccountId = c.env.IG_BUSINESS_ACCOUNT_ID;
  const db = c.env.DB;

  // Direct token mode: use pre-configured Page Access Token
  if (pageToken && igAccountId) {
    const userId = c.get('user').id;

    // Fetch the IG username for display
    let accountName = 'Instagram Account';
    try {
      const profileRes = await fetch(
        'https://graph.facebook.com/v25.0/' + igAccountId + '?fields=username,name&access_token=' + pageToken,
      );
      if (profileRes.ok) {
        const profile = (await profileRes.json()) as { username?: string; name?: string };
        accountName = profile.username ?? profile.name ?? accountName;
      }
    } catch {
      // Best-effort
    }

    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days

    // Remove any existing connection for this user+channel, then insert fresh — use batch for atomicity
    const id = crypto.randomUUID();
    const encryptedToken = await encryptToken(pageToken, c.env.CHANNEL_ENCRYPTION_KEY);

    await db.batch([
      db.prepare(
        "DELETE FROM channel_connections WHERE user_id = ? AND channel_type = 'instagram'"
      ).bind(userId),
      db.prepare(
        "INSERT INTO channel_connections (id, user_id, channel_type, external_account_id, external_account_name, access_token_encrypted, token_expires_at, status) VALUES (?, ?, 'instagram', ?, ?, ?, ?, 'connected')"
      ).bind(id, userId, igAccountId, accountName, encryptedToken, expiresAt),
    ]);

    const row = await db.prepare(
      'SELECT id, user_id, channel_type, external_account_id, external_account_name, status, created_at, updated_at FROM channel_connections WHERE id = ?'
    ).bind(id).first() as any;

    return c.json({
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
  }

  // OAuth mode: start Instagram OAuth flow
  const instagramChannel = new InstagramChannel({
    db,
    encryptionKey: c.env.CHANNEL_ENCRYPTION_KEY,
    publicUrl: c.env.S3_PUBLIC_URL,
    clientSecret: c.env.INSTAGRAM_CLIENT_SECRET,
  });

  const state = crypto.randomUUID();
  // Persist state for CSRF verification in callback — fail-closed if insert fails
  try {
    await db.prepare(
      "INSERT INTO oauth_states (id, user_id, created_at) VALUES (?, ?, datetime('now'))"
    ).bind(state, c.get('user').id).run();
  } catch (err) {
    throw new PlatformError({
      severity: 'error',
      component: 'InstagramChannel',
      operation: 'connect',
      description: 'Failed to initialize OAuth flow. Please try again.',
      recommendedActions: ['Try connecting again'],
    });
  }
  const authorizationUrl = instagramChannel.getAuthorizationUrl(state);
  return c.json({ authorizationUrl, state });
});

/**
 * GET /instagram/callback
 * Handle Instagram OAuth callback.
 */
app.get('/instagram/callback', async (c) => {
  const code = c.req.query('code') || '';
  const state = c.req.query('state') || '';

  // Verify OAuth state to prevent CSRF
  if (state) {
    const stateRow = await c.env.DB.prepare(
      'SELECT id FROM oauth_states WHERE id = ? AND user_id = ?'
    ).bind(state, c.get('user').id).first();

    if (!stateRow) {
      return c.json({ error: 'Invalid or expired OAuth state. Please try connecting again.' }, 403);
    }

    // Clean up used state
    await c.env.DB.prepare('DELETE FROM oauth_states WHERE id = ?').bind(state).run();
  }

  const instagramChannel = new InstagramChannel({
    db: c.env.DB,
    encryptionKey: c.env.CHANNEL_ENCRYPTION_KEY,
    publicUrl: c.env.S3_PUBLIC_URL,
    clientSecret: c.env.INSTAGRAM_CLIENT_SECRET,
  });
  const connection = await instagramChannel.handleAuthCallback(code, c.get('user').id);
  return c.json(connection);
});

/**
 * POST /instagram/refresh/:id
 * Manually refresh an Instagram token.
 */
app.post('/instagram/refresh/:id', async (c) => {
  const db = c.env.DB;
  const channelId = c.req.param('id');
  const userId = c.get('user').id;

  // Verify ownership
  const check = await db.prepare(
    "SELECT id FROM channel_connections WHERE id = ? AND user_id = ? AND channel_type = 'instagram'"
  ).bind(channelId, userId).first();

  if (!check) {
    return c.json({ error: 'Channel not found' }, 404);
  }

  const instagramChannel = new InstagramChannel({
    db,
    encryptionKey: c.env.CHANNEL_ENCRYPTION_KEY,
    publicUrl: c.env.S3_PUBLIC_URL,
    clientSecret: c.env.INSTAGRAM_CLIENT_SECRET,
  });

  const refreshed = await instagramChannel.refreshToken(channelId);
  if (!refreshed) {
    return c.json({ error: 'Token refresh failed. Please reconnect your Instagram account.' }, 400);
  }

  return c.json({ channel: refreshed });
});

/**
 * DELETE /:id
 * Disconnect a channel.
 */
app.delete('/:id', async (c) => {
  const db = c.env.DB;
  const channelId = c.req.param('id');
  const userId = c.get('user').id;

  // Verify the channel belongs to the authenticated user and get its type
  const check = await db.prepare(
    'SELECT id, channel_type FROM channel_connections WHERE id = ? AND user_id = ?'
  ).bind(channelId, userId).first() as any;

  if (!check) {
    return c.json({ error: 'Channel not found' }, 404);
  }

  if (check.channel_type === 'instagram') {
    const instagramChannel = new InstagramChannel({
      db,
      encryptionKey: c.env.CHANNEL_ENCRYPTION_KEY,
      publicUrl: c.env.S3_PUBLIC_URL,
      clientSecret: c.env.INSTAGRAM_CLIENT_SECRET,
    });
    await instagramChannel.disconnect(channelId);
  } else {
    // Generic disconnect for unsupported channel types
    await db.prepare(
      "UPDATE channel_connections SET status = 'disconnected', access_token_encrypted = NULL, updated_at = datetime('now') WHERE id = ?"
    ).bind(channelId).run();
  }

  return c.json({ success: true });
});

export default app;

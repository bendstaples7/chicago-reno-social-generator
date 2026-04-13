import { query } from '../config/database.js';
import { PlatformError } from '../errors/index.js';
import { ContentType, classifyContentType, extractHashtags } from 'shared';

const INSTAGRAM_GRAPH_URL = 'https://graph.facebook.com/v25.0';

/** Fields we request from the Instagram media endpoint */
const MEDIA_FIELDS = 'id,caption,media_type,timestamp,permalink,thumbnail_url,media_url';

/** Maximum posts to fetch per sync */
const SYNC_LIMIT = 50;

/** Timeout for Instagram API requests */
const SYNC_TIMEOUT_MS = 10_000;

interface InstagramMediaItem {
  id: string;
  caption?: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  timestamp: string;
  permalink: string;
  thumbnail_url?: string;
  media_url?: string;
}

interface SyncResult {
  synced: number;
  skipped: number;
  errors: string[];
}

export class InstagramSyncService {
  /** Minimum interval between syncs per user (5 minutes) */
  private static readonly SYNC_COOLDOWN_MS = 5 * 60 * 1000;

  /**
   * Sync recent Instagram posts into the local posts table.
   * Fetches media from the Instagram Graph API, skips posts already synced
   * (matched by external_post_id), and inserts new ones.
   * Skips if the last sync for this user was less than 5 minutes ago.
   */
  async syncRecentPosts(userId: string): Promise<SyncResult> {
    // Check cooldown using the most recent instagram_sync post timestamp
    const cooldownResult = await query(
      `SELECT MAX(created_at) AS last_sync FROM posts WHERE user_id = $1 AND source = 'instagram_sync'`,
      [userId],
    );
    const lastSync = cooldownResult.rows[0]?.last_sync
      ? new Date(cooldownResult.rows[0].last_sync as string).getTime()
      : 0;
    if (Date.now() - lastSync < InstagramSyncService.SYNC_COOLDOWN_MS) {
      return { synced: 0, skipped: 0, errors: [] };
    }
    // Get the active Instagram connection for this user
    const connResult = await query(
      `SELECT id, access_token_encrypted, external_account_id
       FROM channel_connections
       WHERE user_id = $1 AND channel_type = 'instagram' AND status = 'connected'
       LIMIT 1`,
      [userId],
    );

    if (connResult.rows.length === 0) {
      throw new PlatformError({
        severity: 'warning',
        component: 'InstagramSyncService',
        operation: 'syncRecentPosts',
        description: 'No connected Instagram account found. Connect your Instagram account in Settings first.',
        recommendedActions: ['Go to Settings and connect your Instagram account'],
      });
    }

    const conn = connResult.rows[0];
    const connectionId = conn.id as string;
    const igUserId = conn.external_account_id as string;

    // Decrypt the access token — or use it directly if stored in plain text
    // (direct-token mode stores the FB_PAGE_ACCESS_TOKEN as-is, not encrypted)
    let accessToken: string;
    const rawToken = conn.access_token_encrypted as string;
    const colonCount = (rawToken.match(/:/g) || []).length;

    if (colonCount === 2) {
      // Encrypted format: iv:authTag:ciphertext
      try {
        const { decrypt } = await import('./instagram-channel.js');
        accessToken = decrypt(rawToken);
      } catch {
        throw new PlatformError({
          severity: 'error',
          component: 'InstagramSyncService',
          operation: 'syncRecentPosts',
          description: 'Failed to decrypt Instagram access token.',
          recommendedActions: ['Reconnect your Instagram account in Settings'],
        });
      }
    } else {
      // Plain text token (direct-token mode)
      accessToken = rawToken;
    }

    // Fetch recent media from Instagram (with timeout)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
    let response: Response;
    try {
      const url = `${INSTAGRAM_GRAPH_URL}/${igUserId}/media?fields=${MEDIA_FIELDS}&limit=${SYNC_LIMIT}`;
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === 'AbortError') {
        throw new PlatformError({
          severity: 'error',
          component: 'InstagramSyncService',
          operation: 'syncRecentPosts',
          description: `Instagram API request timed out after ${SYNC_TIMEOUT_MS / 1000}s.`,
          recommendedActions: ['Try again later', 'Check your network connection'],
        });
      }
      throw err;
    }
    clearTimeout(timer);

    if (!response.ok) {
      const body = await response.text();
      throw new PlatformError({
        severity: 'error',
        component: 'InstagramSyncService',
        operation: 'syncRecentPosts',
        description: `Instagram API error (${response.status}): ${body.substring(0, 200)}`,
        recommendedActions: ['Check your Instagram connection', 'Try refreshing your token in Settings'],
      });
    }

    const data = await response.json() as { data: InstagramMediaItem[] };
    const igPosts = data.data || [];

    if (igPosts.length === 0) {
      return { synced: 0, skipped: 0, errors: [] };
    }

    // Get existing external_post_ids to skip duplicates
    const existingResult = await query(
      `SELECT external_post_id FROM posts
       WHERE user_id = $1 AND external_post_id IS NOT NULL`,
      [userId],
    );
    const existingIds = new Set(existingResult.rows.map((r) => r.external_post_id as string));

    let synced = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const igPost of igPosts) {
      if (existingIds.has(igPost.id)) {
        skipped++;
        continue;
      }

      try {
        const caption = igPost.caption || '';
        const contentType = classifyContentType(caption);
        const hashtags = extractHashtags(caption);
        // Strip hashtags from caption for cleaner storage
        const cleanCaption = caption.replace(/#[\w]+/g, '').trim();

        await query(
          `INSERT INTO posts (user_id, channel_connection_id, content_type, caption, hashtags_json, status, external_post_id, source, published_at)
           VALUES ($1, $2, $3, $4, $5, 'published', $6, 'instagram_sync', $7)`,
          [
            userId,
            connectionId,
            contentType,
            cleanCaption,
            JSON.stringify(hashtags),
            igPost.id,
            new Date(igPost.timestamp).toISOString(),
          ],
        );
        synced++;
      } catch (err) {
        errors.push(`Failed to sync post ${igPost.id}: ${(err as Error).message}`);
      }
    }

    return { synced, skipped, errors };
  }
}

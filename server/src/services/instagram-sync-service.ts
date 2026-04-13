import { query } from '../config/database.js';
import { PlatformError } from '../errors/index.js';
import { ContentType } from 'shared';
import type { Post } from 'shared';

const INSTAGRAM_GRAPH_URL = 'https://graph.facebook.com/v25.0';

/** Fields we request from the Instagram media endpoint */
const MEDIA_FIELDS = 'id,caption,media_type,timestamp,permalink,thumbnail_url,media_url';

/** Maximum posts to fetch per sync */
const SYNC_LIMIT = 50;

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

/**
 * Classifies an Instagram post caption into a ContentType using keyword heuristics.
 * Falls back to Education as the most generic type.
 */
function classifyContentType(caption: string): ContentType {
  const lower = (caption || '').toLowerCase();

  // Before & After — transformation language
  const beforeAfterKeywords = [
    'before and after', 'before & after', 'transformation',
    'the before', 'the after', 'swipe to see', 'what a difference',
    'from this to this', 'project reveal', 'reveal day',
  ];
  if (beforeAfterKeywords.some((kw) => lower.includes(kw))) {
    return ContentType.BeforeAfter;
  }

  // Testimonial — review/feedback language
  const testimonialKeywords = [
    'review', 'testimonial', 'feedback', 'thank you for the kind words',
    'what our client', 'client said', 'customer said', '⭐', 'stars',
    'happy client', 'happy customer', 'loved working with',
  ];
  if (testimonialKeywords.some((kw) => lower.includes(kw))) {
    return ContentType.Testimonial;
  }

  // Personal Brand — team/people language
  const personalBrandKeywords = [
    'meet the team', 'team member', 'behind the scenes', 'our crew',
    'employee spotlight', 'team spotlight', 'day in the life',
  ];
  if (personalBrandKeywords.some((kw) => lower.includes(kw))) {
    return ContentType.PersonalBrand;
  }

  // Seasonal Event — holiday/seasonal language
  const seasonalKeywords = [
    'happy holidays', 'merry christmas', 'happy new year', 'spring',
    'summer', 'fall', 'winter', 'thanksgiving', 'memorial day',
    'labor day', '4th of july', 'fourth of july', 'valentine',
    'mother\'s day', 'father\'s day', 'seasonal',
  ];
  if (seasonalKeywords.some((kw) => lower.includes(kw))) {
    return ContentType.SeasonalEvent;
  }

  // Default to Education (tips, how-to, informational)
  return ContentType.Education;
}

/**
 * Extract hashtags from a caption string.
 */
function extractHashtags(caption: string): string[] {
  const matches = (caption || '').match(/#[\w]+/g);
  return matches ? matches.map((tag) => tag.slice(1)) : [];
}

export class InstagramSyncService {
  /**
   * Sync recent Instagram posts into the local posts table.
   * Fetches media from the Instagram Graph API, skips posts already synced
   * (matched by external_post_id), and inserts new ones.
   */
  async syncRecentPosts(userId: string): Promise<SyncResult> {
    // Get the active Instagram connection for this user
    const connResult = await query(
      `SELECT id, access_token_encrypted, platform_user_id
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
    const igUserId = conn.platform_user_id as string;

    // Decrypt the access token
    let accessToken: string;
    try {
      const crypto = await import('node:crypto');
      const encryptedText = conn.access_token_encrypted as string;
      const parts = encryptedText.split(':');
      const key = process.env.CHANNEL_ENCRYPTION_KEY;
      if (!key) throw new Error('No encryption key');
      const keyBuf = Buffer.from(key, 'hex');
      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = Buffer.from(parts[2], 'hex');
      const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv);
      decipher.setAuthTag(authTag);
      accessToken = decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
    } catch {
      throw new PlatformError({
        severity: 'error',
        component: 'InstagramSyncService',
        operation: 'syncRecentPosts',
        description: 'Failed to decrypt Instagram access token.',
        recommendedActions: ['Reconnect your Instagram account in Settings'],
      });
    }

    // Fetch recent media from Instagram
    const url = `${INSTAGRAM_GRAPH_URL}/${igUserId}/media?fields=${MEDIA_FIELDS}&limit=${SYNC_LIMIT}&access_token=${accessToken}`;
    const response = await fetch(url);

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
       WHERE user_id = $1 AND source = 'instagram_sync' AND external_post_id IS NOT NULL`,
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

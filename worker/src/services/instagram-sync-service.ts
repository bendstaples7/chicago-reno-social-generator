import { PlatformError } from '../errors/index.js';
import { ContentType } from 'shared';

const INSTAGRAM_GRAPH_URL = 'https://graph.facebook.com/v25.0';
const MEDIA_FIELDS = 'id,caption,media_type,timestamp,permalink,thumbnail_url,media_url';
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

function classifyContentType(caption: string): ContentType {
  const lower = (caption || '').toLowerCase();

  const beforeAfterKeywords = [
    'before and after', 'before & after', 'transformation',
    'the before', 'the after', 'swipe to see', 'what a difference',
    'from this to this', 'project reveal', 'reveal day',
  ];
  if (beforeAfterKeywords.some((kw) => lower.includes(kw))) return ContentType.BeforeAfter;

  const testimonialKeywords = [
    'review', 'testimonial', 'feedback', 'thank you for the kind words',
    'what our client', 'client said', 'customer said', '⭐', 'stars',
    'happy client', 'happy customer', 'loved working with',
  ];
  if (testimonialKeywords.some((kw) => lower.includes(kw))) return ContentType.Testimonial;

  const personalBrandKeywords = [
    'meet the team', 'team member', 'behind the scenes', 'our crew',
    'employee spotlight', 'team spotlight', 'day in the life',
  ];
  if (personalBrandKeywords.some((kw) => lower.includes(kw))) return ContentType.PersonalBrand;

  const seasonalKeywords = [
    'happy holidays', 'merry christmas', 'happy new year', 'spring',
    'summer', 'fall', 'winter', 'thanksgiving', 'memorial day',
    'labor day', '4th of july', 'fourth of july', 'valentine',
    "mother's day", "father's day", 'seasonal',
  ];
  if (seasonalKeywords.some((kw) => lower.includes(kw))) return ContentType.SeasonalEvent;

  return ContentType.Education;
}

function extractHashtags(caption: string): string[] {
  const matches = (caption || '').match(/#[\w]+/g);
  return matches ? matches.map((tag) => tag.slice(1)) : [];
}

// Web Crypto decrypt helper (matches instagram-channel.ts)
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function decryptToken(encryptedText: string, keyHex: string): Promise<string> {
  const parts = encryptedText.split(':');
  if (parts.length !== 2) throw new Error('Invalid encrypted format');
  const iv = hexToBytes(parts[0]);
  const ciphertext = hexToBytes(parts[1]);
  const keyBytes = hexToBytes(keyHex);
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

export class InstagramSyncService {
  private readonly db: D1Database;
  private readonly encryptionKey: string;

  constructor(db: D1Database, encryptionKey: string) {
    this.db = db;
    this.encryptionKey = encryptionKey;
  }

  async syncRecentPosts(userId: string): Promise<SyncResult> {
    const conn = await this.db.prepare(
      "SELECT id, access_token_encrypted, platform_user_id FROM channel_connections WHERE user_id = ? AND channel_type = 'instagram' AND status = 'connected' LIMIT 1"
    ).bind(userId).first() as any;

    if (!conn) {
      throw new PlatformError({
        severity: 'warning',
        component: 'InstagramSyncService',
        operation: 'syncRecentPosts',
        description: 'No connected Instagram account found. Connect your Instagram account in Settings first.',
        recommendedActions: ['Go to Settings and connect your Instagram account'],
      });
    }

    const connectionId = conn.id as string;
    const igUserId = conn.platform_user_id as string;

    let accessToken: string;
    try {
      accessToken = await decryptToken(conn.access_token_encrypted as string, this.encryptionKey);
    } catch {
      throw new PlatformError({
        severity: 'error',
        component: 'InstagramSyncService',
        operation: 'syncRecentPosts',
        description: 'Failed to decrypt Instagram access token.',
        recommendedActions: ['Reconnect your Instagram account in Settings'],
      });
    }

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

    const existingResult = await this.db.prepare(
      "SELECT external_post_id FROM posts WHERE user_id = ? AND source = 'instagram_sync' AND external_post_id IS NOT NULL"
    ).bind(userId).all();
    const existingIds = new Set((existingResult.results as any[]).map((r) => r.external_post_id as string));

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
        const cleanCaption = caption.replace(/#[\w]+/g, '').trim();
        const id = crypto.randomUUID();

        await this.db.prepare(
          "INSERT INTO posts (id, user_id, channel_connection_id, content_type, caption, hashtags_json, status, external_post_id, source, published_at) VALUES (?, ?, ?, ?, ?, ?, 'published', ?, 'instagram_sync', ?)"
        ).bind(
          id, userId, connectionId, contentType, cleanCaption,
          JSON.stringify(hashtags), igPost.id, new Date(igPost.timestamp).toISOString(),
        ).run();
        synced++;
      } catch (err) {
        errors.push(`Failed to sync post ${igPost.id}: ${(err as Error).message}`);
      }
    }

    return { synced, skipped, errors };
  }
}

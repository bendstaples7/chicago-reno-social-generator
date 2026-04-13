import { PlatformError } from '../errors/index.js';
import { ContentType, classifyContentType, extractHashtags } from 'shared';

const INSTAGRAM_GRAPH_URL = 'https://graph.facebook.com/v25.0';
const MEDIA_FIELDS = 'id,caption,media_type,timestamp,permalink,thumbnail_url,media_url';
const SYNC_LIMIT = 50;
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
  let iv: Uint8Array;
  let ciphertext: Uint8Array;

  if (parts.length === 2) {
    // Worker format: iv:ciphertext (authTag appended to ciphertext by Web Crypto)
    iv = hexToBytes(parts[0]);
    ciphertext = hexToBytes(parts[1]);
  } else if (parts.length === 3) {
    // Server format: iv:authTag:ciphertext (authTag separate)
    iv = hexToBytes(parts[0]);
    const authTag = hexToBytes(parts[1]);
    const encrypted = hexToBytes(parts[2]);
    // Concatenate ciphertext + authTag for Web Crypto (expects them combined)
    ciphertext = new Uint8Array(encrypted.length + authTag.length);
    ciphertext.set(encrypted);
    ciphertext.set(authTag, encrypted.length);
  } else {
    throw new Error('Invalid encrypted format');
  }

  const keyBytes = hexToBytes(keyHex);
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

export class InstagramSyncService {
  private static readonly SYNC_COOLDOWN_MS = 5 * 60 * 1000;
  /** In-memory record of last sync attempt per user (covers no-new-posts case) */
  private static lastAttemptByUser = new Map<string, number>();

  private readonly db: D1Database;
  private readonly encryptionKey: string;

  constructor(db: D1Database, encryptionKey: string) {
    this.db = db;
    this.encryptionKey = encryptionKey;
  }

  async syncRecentPosts(userId: string): Promise<SyncResult> {
    const now = Date.now();
    const lastAttempt = InstagramSyncService.lastAttemptByUser.get(userId) ?? 0;
    if (now - lastAttempt < InstagramSyncService.SYNC_COOLDOWN_MS) {
      return { synced: 0, skipped: 0, errors: [] };
    }
    InstagramSyncService.lastAttemptByUser.set(userId, now);
    const conn = await this.db.prepare(
      "SELECT id, access_token_encrypted, external_account_id FROM channel_connections WHERE user_id = ? AND channel_type = 'instagram' AND status = 'connected' LIMIT 1"
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
    const igUserId = conn.external_account_id as string;

    let accessToken: string;
    const rawToken = conn.access_token_encrypted as string;
    const colonCount = (rawToken.match(/:/g) || []).length;

    if ((colonCount === 1 || colonCount === 2) && rawToken.length > 50) {
      // Encrypted format: iv:ciphertext (worker) or iv:authTag:ciphertext (server)
      try {
        accessToken = await decryptToken(rawToken, this.encryptionKey);
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

    const existingResult = await this.db.prepare(
      "SELECT external_post_id FROM posts WHERE user_id = ? AND external_post_id IS NOT NULL"
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

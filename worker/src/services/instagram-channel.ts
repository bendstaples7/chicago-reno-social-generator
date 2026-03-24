import { PlatformError } from '../errors/index.js';
import type {
  ChannelInterface,
  ChannelConnection,
  ChannelConstraints,
  FormattedPost,
  PublishResult,
  ValidationResult,
  Post,
  PostStatus,
} from 'shared';

const INSTAGRAM_AUTH_URL = 'https://api.instagram.com/oauth/authorize';
const INSTAGRAM_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const INSTAGRAM_GRAPH_URL = 'https://graph.facebook.com/v25.0';

// Web Crypto helpers
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

async function encrypt(text: string, keyHex: string): Promise<string> {
  const keyBytes = hexToBytes(keyHex);
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return bytesToHex(iv) + ':' + bytesToHex(new Uint8Array(ciphertext));
}

async function decrypt(encryptedText: string, keyHex: string): Promise<string> {
  const parts = encryptedText.split(':');
  if (parts.length !== 2) throw new Error('Invalid encrypted format');
  const iv = hexToBytes(parts[0]);
  const ciphertext = hexToBytes(parts[1]);
  const keyBytes = hexToBytes(keyHex);
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

export class InstagramChannel implements ChannelInterface {
  readonly channelType = 'instagram';
  private readonly db: D1Database;
  private readonly encryptionKey: string;
  private readonly publicUrl: string;

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  private readonly constraints: ChannelConstraints = {
    maxCaptionLength: 2200,
    maxHashtags: 30,
    maxCarouselImages: 10,
    maxReelDuration: 90,
    supportedMediaTypes: ['image/jpeg', 'image/png', 'video/mp4'],
    recommendedDimensions: {
      square: { width: 1080, height: 1080 },
      portrait: { width: 1080, height: 1350 },
      landscape: { width: 1080, height: 566 },
    },
  };

  constructor(config: {
    db: D1Database;
    encryptionKey: string;
    publicUrl: string;
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
  }) {
    this.db = config.db;
    this.encryptionKey = config.encryptionKey;
    this.publicUrl = config.publicUrl;
    this.clientId = config.clientId ?? '';
    this.clientSecret = config.clientSecret ?? '';
    this.redirectUri = config.redirectUri ?? '';

    if (!this.encryptionKey) {
      throw new PlatformError({
        severity: 'error',
        component: 'InstagramChannel',
        operation: 'encryption',
        description: 'Channel encryption key is not configured.',
        recommendedActions: ['Set the CHANNEL_ENCRYPTION_KEY environment variable'],
      });
    }
  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: 'instagram_basic,instagram_content_publish',
      response_type: 'code',
      state,
    });
    return INSTAGRAM_AUTH_URL + '?' + params.toString();
  }

  async handleAuthCallback(code: string, userId: string): Promise<ChannelConnection> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri,
      code,
    });

    const tokenResponse = await fetch(INSTAGRAM_TOKEN_URL, { method: 'POST', body });

    if (!tokenResponse.ok) {
      throw new PlatformError({
        severity: 'error',
        component: 'InstagramChannel',
        operation: 'handleAuthCallback',
        description: 'Failed to exchange authorization code for an Instagram access token.',
        recommendedActions: ['Try connecting your Instagram account again'],
      });
    }

    const tokenData = (await tokenResponse.json()) as { access_token: string; user_id: string };

    const profileResponse = await fetch(
      INSTAGRAM_GRAPH_URL + '/me?fields=id,username&access_token=' + tokenData.access_token,
    );

    let accountName = 'Instagram User';
    if (profileResponse.ok) {
      const profile = (await profileResponse.json()) as { id: string; username: string };
      accountName = profile.username;
    }

    const encryptedToken = await encrypt(tokenData.access_token, this.encryptionKey);
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

    // Atomic DELETE + INSERT via batch
    const id = crypto.randomUUID();
    await this.db.batch([
      this.db.prepare(
        "DELETE FROM channel_connections WHERE user_id = ? AND channel_type = 'instagram'"
      ).bind(userId),
      this.db.prepare(
        "INSERT INTO channel_connections (id, user_id, channel_type, external_account_id, external_account_name, access_token_encrypted, token_expires_at, status) VALUES (?, ?, 'instagram', ?, ?, ?, ?, 'connected')"
      ).bind(id, userId, tokenData.user_id, accountName, encryptedToken, expiresAt),
    ]);

    const row = await this.db.prepare(
      'SELECT id, user_id, channel_type, external_account_id, external_account_name, access_token_encrypted, token_expires_at, status, created_at, updated_at FROM channel_connections WHERE id = ?'
    ).bind(id).first() as any;

    return this.mapConnectionRow(row);
  }

  async disconnect(connectionId: string): Promise<void> {
    const row = await this.db.prepare(
      "SELECT access_token_encrypted FROM channel_connections WHERE id = ? AND channel_type = 'instagram'"
    ).bind(connectionId).first() as any;

    if (!row) {
      throw new PlatformError({
        severity: 'error',
        component: 'InstagramChannel',
        operation: 'disconnect',
        description: 'The Instagram channel connection was not found.',
        recommendedActions: ['Verify the connection exists on your dashboard'],
      });
    }

    try {
      const encryptedToken = row.access_token_encrypted as string;
      if (encryptedToken) {
        let token: string | null;
        try {
          token = await decrypt(encryptedToken, this.encryptionKey);
        } catch {
          // Cannot decrypt — skip revocation rather than sending ciphertext to Instagram
          token = null;
        }
        if (token) {
          await fetch(INSTAGRAM_GRAPH_URL + '/me/permissions?access_token=' + token, { method: 'DELETE' });
        }
      }
    } catch { /* best-effort */ }

    await this.db.prepare(
      "UPDATE channel_connections SET status = 'disconnected', access_token_encrypted = NULL, updated_at = datetime('now') WHERE id = ?"
    ).bind(connectionId).run();
  }

  async formatPost(post: Post): Promise<FormattedPost> {
    const mediaResult = await this.db.prepare(
      'SELECT mi.storage_key, mi.mime_type FROM post_media pm JOIN media_items mi ON mi.id = pm.media_item_id WHERE pm.post_id = ? ORDER BY pm.display_order ASC'
    ).bind(post.id).all();

    const mediaUrls = (mediaResult.results as any[]).map(
      (row) => this.publicUrl + '/' + (row.storage_key as string),
    );
    const mimeTypes = (mediaResult.results as any[]).map(
      (row) => row.mime_type as string,
    );

    const hashtags: string[] = post.hashtagsJson ? JSON.parse(post.hashtagsJson) : [];
    const caption = post.caption ?? '';

    let formatType = 'IMAGE';
    if (mimeTypes.some((t: string) => t === 'video/mp4')) {
      formatType = 'REELS';
    } else if (mediaUrls.length > 1) {
      formatType = 'CAROUSEL';
    }

    return {
      postId: post.id,
      channelType: this.channelType,
      caption,
      hashtags,
      mediaUrls,
      metadata: { formatType, mimeTypes },
    };
  }

  async validatePost(post: Post): Promise<ValidationResult> {
    const violations: string[] = [];
    const caption = post.caption ?? '';
    const hashtags: string[] = post.hashtagsJson ? JSON.parse(post.hashtagsJson) : [];

    if (caption.length > this.constraints.maxCaptionLength) {
      violations.push('Caption exceeds the ' + this.constraints.maxCaptionLength + ' character limit (' + caption.length + ' characters).');
    }
    if (hashtags.length > this.constraints.maxHashtags) {
      violations.push('Too many hashtags: ' + hashtags.length + ' provided, maximum is ' + this.constraints.maxHashtags + '.');
    }

    const mediaResult = await this.db.prepare(
      'SELECT mi.mime_type, mi.file_size_bytes FROM post_media pm JOIN media_items mi ON mi.id = pm.media_item_id WHERE pm.post_id = ? ORDER BY pm.display_order ASC'
    ).bind(post.id).all();

    const mediaItems = mediaResult.results as any[];
    const imageCount = mediaItems.filter((m) => (m.mime_type as string) !== 'video/mp4').length;

    if (imageCount > this.constraints.maxCarouselImages) {
      violations.push('Too many carousel images: ' + imageCount + ' provided, maximum is ' + this.constraints.maxCarouselImages + '.');
    }

    for (const item of mediaItems) {
      const mimeType = item.mime_type as string;
      if (!this.constraints.supportedMediaTypes.includes(mimeType)) {
        violations.push('Unsupported media type: ' + mimeType + '.');
      }
    }

    return { valid: violations.length === 0, violations };
  }

  async publish(formattedPost: FormattedPost): Promise<PublishResult> {
    const connRow = await this.db.prepare(
      "SELECT cc.access_token_encrypted, cc.external_account_id FROM channel_connections cc WHERE cc.id = (SELECT channel_connection_id FROM posts WHERE id = ?) AND cc.status = 'connected'"
    ).bind(formattedPost.postId).first() as any;

    if (!connRow) {
      return { success: false, error: 'No active Instagram connection found for this post.' };
    }

    const rawToken = connRow.access_token_encrypted as string;
    let accessToken: string;
    try {
      accessToken = await decrypt(rawToken, this.encryptionKey);
    } catch {
      accessToken = rawToken;
    }
    const igUserId = connRow.external_account_id as string;
    const formatType = (formattedPost.metadata.formatType as string) ?? 'IMAGE';
    const fullCaption = formattedPost.hashtags.length > 0
      ? formattedPost.caption + '\n\n' + formattedPost.hashtags.join(' ')
      : formattedPost.caption;

    try {
      if (formatType === 'CAROUSEL') {
        return await this.publishCarousel(igUserId, accessToken, fullCaption, formattedPost.mediaUrls);
      }

      const mediaType = formatType === 'REELS' ? 'REELS' : 'IMAGE';
      const mediaField = formatType === 'REELS' ? 'video_url' : 'image_url';

      const createResponse = await fetch(INSTAGRAM_GRAPH_URL + '/' + igUserId + '/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [mediaField]: formattedPost.mediaUrls[0],
          caption: fullCaption,
          media_type: mediaType,
          access_token: accessToken,
        }),
      });

      if (!createResponse.ok) {
        const errorData = await createResponse.text();
        return { success: false, error: 'Instagram API error: ' + errorData };
      }

      const createData = (await createResponse.json()) as { id: string };

      const publishResponse = await fetch(INSTAGRAM_GRAPH_URL + '/' + igUserId + '/media_publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: createData.id, access_token: accessToken }),
      });

      if (!publishResponse.ok) {
        const errorData = await publishResponse.text();
        return { success: false, error: 'Instagram publish error: ' + errorData };
      }

      const publishData = (await publishResponse.json()) as { id: string };
      return { success: true, externalPostId: publishData.id };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown publishing error' };
    }
  }

  async getPostStatus(externalPostId: string): Promise<PostStatus> {
    try {
      const connRow = await this.db.prepare(
        "SELECT access_token_encrypted FROM channel_connections WHERE channel_type = 'instagram' AND status = 'connected' ORDER BY updated_at DESC LIMIT 1"
      ).first() as any;

      if (!connRow) return 'failed';

      const rawToken = connRow.access_token_encrypted as string;
      let accessToken: string;
      try {
        accessToken = await decrypt(rawToken, this.encryptionKey);
      } catch {
        accessToken = rawToken;
      }

      const response = await fetch(
        INSTAGRAM_GRAPH_URL + '/' + externalPostId + '?fields=id,timestamp&access_token=' + accessToken,
      );

      return response.ok ? 'published' : 'failed';
    } catch {
      return 'failed';
    }
  }

  getConstraints(): ChannelConstraints {
    return this.constraints;
  }

  private async publishCarousel(igUserId: string, accessToken: string, caption: string, mediaUrls: string[]): Promise<PublishResult> {
    const childIds: string[] = [];
    for (const url of mediaUrls) {
      const resp = await fetch(INSTAGRAM_GRAPH_URL + '/' + igUserId + '/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: url, is_carousel_item: true, access_token: accessToken }),
      });
      if (!resp.ok) {
        const errorData = await resp.text();
        return { success: false, error: 'Instagram carousel item error: ' + errorData };
      }
      const data = (await resp.json()) as { id: string };
      childIds.push(data.id);
    }

    const carouselResp = await fetch(INSTAGRAM_GRAPH_URL + '/' + igUserId + '/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_type: 'CAROUSEL', caption, children: childIds, access_token: accessToken }),
    });
    if (!carouselResp.ok) {
      const errorData = await carouselResp.text();
      return { success: false, error: 'Instagram carousel error: ' + errorData };
    }
    const carouselData = (await carouselResp.json()) as { id: string };

    const publishResp = await fetch(INSTAGRAM_GRAPH_URL + '/' + igUserId + '/media_publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: carouselData.id, access_token: accessToken }),
    });
    if (!publishResp.ok) {
      const errorData = await publishResp.text();
      return { success: false, error: 'Instagram carousel publish error: ' + errorData };
    }
    const publishData = (await publishResp.json()) as { id: string };
    return { success: true, externalPostId: publishData.id };
  }

  private mapConnectionRow(row: Record<string, unknown>): ChannelConnection {
    return {
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
    };
  }
}

import crypto from 'node:crypto';
import { query } from '../config/database.js';
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

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.CHANNEL_ENCRYPTION_KEY;
  if (!key) {
    throw new PlatformError({
      severity: 'error',
      component: 'InstagramChannel',
      operation: 'encryption',
      description: 'Channel encryption key is not configured.',
      recommendedActions: ['Set the CHANNEL_ENCRYPTION_KEY environment variable'],
    });
  }
  return Buffer.from(key, 'hex');
}

function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decrypt(encryptedText: string): string {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export class InstagramChannel implements ChannelInterface {
  readonly channelType = 'instagram';

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

  constructor(config?: { clientId?: string; clientSecret?: string; redirectUri?: string }) {
    this.clientId = config?.clientId ?? process.env.INSTAGRAM_CLIENT_ID ?? '';
    this.clientSecret = config?.clientSecret ?? process.env.INSTAGRAM_CLIENT_SECRET ?? '';
    this.redirectUri = config?.redirectUri ?? process.env.INSTAGRAM_REDIRECT_URI ?? '';
  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: 'instagram_basic,instagram_content_publish',
      response_type: 'code',
      state,
    });
    return `${INSTAGRAM_AUTH_URL}?${params.toString()}`;
  }

  async handleAuthCallback(code: string, userId: string): Promise<ChannelConnection> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri,
      code,
    });

    const tokenResponse = await fetch(INSTAGRAM_TOKEN_URL, {
      method: 'POST',
      body,
    });

    if (!tokenResponse.ok) {
      throw new PlatformError({
        severity: 'error',
        component: 'InstagramChannel',
        operation: 'handleAuthCallback',
        description: 'Failed to exchange authorization code for an Instagram access token.',
        recommendedActions: ['Try connecting your Instagram account again'],
      });
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      user_id: string;
    };

    // Fetch account info
    const profileResponse = await fetch(
      `${INSTAGRAM_GRAPH_URL}/me?fields=id,username&access_token=${tokenData.access_token}`,
    );

    let accountName = 'Instagram User';
    if (profileResponse.ok) {
      const profile = (await profileResponse.json()) as { id: string; username: string };
      accountName = profile.username;
    }

    const encryptedToken = encrypt(tokenData.access_token);
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // 60 days

    // Remove any existing connection for this user+channel, then insert fresh
    await query(
      `DELETE FROM channel_connections WHERE user_id = $1 AND channel_type = 'instagram'`,
      [userId],
    );

    const result = await query(
      `INSERT INTO channel_connections (user_id, channel_type, external_account_id, external_account_name, access_token_encrypted, token_expires_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'connected')
       RETURNING id, user_id, channel_type, external_account_id, external_account_name, access_token_encrypted, token_expires_at, status, created_at, updated_at`,
      [userId, 'instagram', tokenData.user_id, accountName, encryptedToken, expiresAt],
    );

    return this.mapConnectionRow(result.rows[0]);
  }

  async disconnect(connectionId: string): Promise<void> {
    const result = await query(
      `SELECT access_token_encrypted FROM channel_connections WHERE id = $1 AND channel_type = 'instagram'`,
      [connectionId],
    );

    if (result.rows.length === 0) {
      throw new PlatformError({
        severity: 'error',
        component: 'InstagramChannel',
        operation: 'disconnect',
        description: 'The Instagram channel connection was not found.',
        recommendedActions: ['Verify the connection exists on your dashboard'],
      });
    }

    // Attempt to revoke the token via Instagram API (best-effort)
    try {
      const encryptedToken = result.rows[0].access_token_encrypted as string;
      if (encryptedToken) {
        let token: string;
        try {
          token = decrypt(encryptedToken);
        } catch {
          token = encryptedToken;
        }
        await fetch(
          `${INSTAGRAM_GRAPH_URL}/me/permissions?access_token=${token}`,
          { method: 'DELETE' },
        );
      }
    } catch {
      // Token revocation is best-effort; proceed with local cleanup
    }

    await query(
      `UPDATE channel_connections SET status = 'disconnected', access_token_encrypted = NULL, updated_at = NOW() WHERE id = $1`,
      [connectionId],
    );
  }

  async formatPost(post: Post): Promise<FormattedPost> {
    // Fetch media items for this post
    const mediaResult = await query(
      `SELECT mi.storage_key, mi.mime_type
       FROM post_media pm
       JOIN media_items mi ON mi.id = pm.media_item_id
       WHERE pm.post_id = $1
       ORDER BY pm.display_order ASC`,
      [post.id],
    );

    const publicUrl = process.env.S3_PUBLIC_URL || '';
    const mediaUrls = mediaResult.rows.map(
      (row: Record<string, unknown>) => `${publicUrl}/${row.storage_key as string}`,
    );
    const mimeTypes = mediaResult.rows.map(
      (row: Record<string, unknown>) => row.mime_type as string,
    );

    const hashtags: string[] = post.hashtagsJson ? JSON.parse(post.hashtagsJson) : [];
    const caption = post.caption ?? '';

    // Determine format type based on media
    let formatType: string = 'IMAGE';
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
      metadata: {
        formatType,
        mimeTypes,
      },
    };
  }

  async validatePost(post: Post): Promise<ValidationResult> {
    const violations: string[] = [];
    const caption = post.caption ?? '';
    const hashtags: string[] = post.hashtagsJson ? JSON.parse(post.hashtagsJson) : [];

    if (caption.length > this.constraints.maxCaptionLength) {
      violations.push(
        `Caption exceeds the ${this.constraints.maxCaptionLength} character limit (${caption.length} characters).`,
      );
    }

    if (hashtags.length > this.constraints.maxHashtags) {
      violations.push(
        `Too many hashtags: ${hashtags.length} provided, maximum is ${this.constraints.maxHashtags}.`,
      );
    }

    // Fetch media for additional checks
    const mediaResult = await query(
      `SELECT mi.mime_type, mi.file_size_bytes
       FROM post_media pm
       JOIN media_items mi ON mi.id = pm.media_item_id
       WHERE pm.post_id = $1
       ORDER BY pm.display_order ASC`,
      [post.id],
    );

    const mediaItems = mediaResult.rows as Array<Record<string, unknown>>;
    const imageCount = mediaItems.filter(
      (m) => (m.mime_type as string) !== 'video/mp4',
    ).length;
    const hasVideo = mediaItems.some((m) => (m.mime_type as string) === 'video/mp4');

    if (imageCount > this.constraints.maxCarouselImages) {
      violations.push(
        `Too many carousel images: ${imageCount} provided, maximum is ${this.constraints.maxCarouselImages}.`,
      );
    }

    // Check for unsupported media types
    for (const item of mediaItems) {
      const mimeType = item.mime_type as string;
      if (!this.constraints.supportedMediaTypes.includes(mimeType)) {
        violations.push(`Unsupported media type: ${mimeType}.`);
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  async publish(formattedPost: FormattedPost): Promise<PublishResult> {
    // Get the connection to retrieve the access token
    const connResult = await query(
      `SELECT access_token_encrypted, external_account_id FROM channel_connections
       WHERE id = (SELECT channel_connection_id FROM posts WHERE id = $1)
       AND status = 'connected'`,
      [formattedPost.postId],
    );

    if (connResult.rows.length === 0) {
      return {
        success: false,
        error: 'No active Instagram connection found for this post.',
      };
    }

    const rawToken = connResult.rows[0].access_token_encrypted as string;
    // Token may be plain text (direct connect) or encrypted (OAuth flow)
    let accessToken: string;
    try {
      accessToken = decrypt(rawToken);
    } catch {
      accessToken = rawToken; // Plain text token from direct connect
    }
    const igUserId = connResult.rows[0].external_account_id as string;
    const formatType = (formattedPost.metadata.formatType as string) ?? 'IMAGE';
    const fullCaption = formattedPost.hashtags.length > 0
      ? `${formattedPost.caption}\n\n${formattedPost.hashtags.join(' ')}`
      : formattedPost.caption;

    try {
      if (formatType === 'CAROUSEL') {
        return await this.publishCarousel(igUserId, accessToken, fullCaption, formattedPost.mediaUrls);
      }

      // Single image or reel
      const mediaType = formatType === 'REELS' ? 'REELS' : 'IMAGE';
      const mediaField = formatType === 'REELS' ? 'video_url' : 'image_url';

      const createResponse = await fetch(
        `${INSTAGRAM_GRAPH_URL}/${igUserId}/media`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            [mediaField]: formattedPost.mediaUrls[0],
            caption: fullCaption,
            media_type: mediaType,
            access_token: accessToken,
          }),
        },
      );

      if (!createResponse.ok) {
        const errorData = await createResponse.text();
        return { success: false, error: `Instagram API error: ${errorData}` };
      }

      const createData = (await createResponse.json()) as { id: string };

      // Publish the container
      const publishResponse = await fetch(
        `${INSTAGRAM_GRAPH_URL}/${igUserId}/media_publish`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            creation_id: createData.id,
            access_token: accessToken,
          }),
        },
      );

      if (!publishResponse.ok) {
        const errorData = await publishResponse.text();
        return { success: false, error: `Instagram publish error: ${errorData}` };
      }

      const publishData = (await publishResponse.json()) as { id: string };
      return { success: true, externalPostId: publishData.id };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown publishing error',
      };
    }
  }

  async getPostStatus(externalPostId: string): Promise<PostStatus> {
    try {
      // We need a token — get the most recent connected account
      const connResult = await query(
        `SELECT access_token_encrypted FROM channel_connections
         WHERE channel_type = 'instagram' AND status = 'connected'
         ORDER BY updated_at DESC LIMIT 1`,
      );

      if (connResult.rows.length === 0) {
        return 'failed';
      }

      const rawToken = connResult.rows[0].access_token_encrypted as string;
      let accessToken: string;
      try {
        accessToken = decrypt(rawToken);
      } catch {
        accessToken = rawToken;
      }

      const response = await fetch(
        `${INSTAGRAM_GRAPH_URL}/${externalPostId}?fields=id,timestamp&access_token=${accessToken}`,
      );

      if (response.ok) {
        return 'published';
      }

      return 'failed';
    } catch {
      return 'failed';
    }
  }

  getConstraints(): ChannelConstraints {
    return this.constraints;
  }

  // ── Private helpers ──────────────────────────────────────────

  private async publishCarousel(
    igUserId: string,
    accessToken: string,
    caption: string,
    mediaUrls: string[],
  ): Promise<PublishResult> {
    // Create individual media containers
    const childIds: string[] = [];
    for (const url of mediaUrls) {
      const resp = await fetch(`${INSTAGRAM_GRAPH_URL}/${igUserId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: url,
          is_carousel_item: true,
          access_token: accessToken,
        }),
      });

      if (!resp.ok) {
        const errorData = await resp.text();
        return { success: false, error: `Instagram carousel item error: ${errorData}` };
      }

      const data = (await resp.json()) as { id: string };
      childIds.push(data.id);
    }

    // Create carousel container
    const carouselResp = await fetch(`${INSTAGRAM_GRAPH_URL}/${igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'CAROUSEL',
        caption,
        children: childIds,
        access_token: accessToken,
      }),
    });

    if (!carouselResp.ok) {
      const errorData = await carouselResp.text();
      return { success: false, error: `Instagram carousel error: ${errorData}` };
    }

    const carouselData = (await carouselResp.json()) as { id: string };

    // Publish
    const publishResp = await fetch(`${INSTAGRAM_GRAPH_URL}/${igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: carouselData.id,
        access_token: accessToken,
      }),
    });

    if (!publishResp.ok) {
      const errorData = await publishResp.text();
      return { success: false, error: `Instagram carousel publish error: ${errorData}` };
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

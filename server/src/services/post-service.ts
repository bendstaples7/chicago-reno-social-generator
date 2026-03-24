import { query, getClient } from '../config/database.js';
import { PlatformError } from '../errors/index.js';
import type { Post, PostStatus, ContentType, PostMedia, PaginationParams } from 'shared';

/** Valid state transitions for the post status state machine */
const VALID_TRANSITIONS: Record<string, PostStatus[]> = {
  draft: ['awaiting_approval'],
  awaiting_approval: ['approved', 'draft'],
  approved: ['publishing'],
  publishing: ['published', 'failed'],
  failed: ['publishing', 'draft'],
};

export interface CreatePostParams {
  userId: string;
  channelConnectionId: string;
  contentType: ContentType;
  caption?: string;
  hashtags?: string[];
  templateFields?: Record<string, string>;
  mediaItemIds?: string[];
}

export interface UpdatePostParams {
  caption?: string;
  hashtags?: string[];
  contentType?: ContentType;
  channelConnectionId?: string;
  templateFields?: Record<string, string>;
  mediaItemIds?: string[];
}

export class PostService {
  /**
   * Create a new post with optional media attachments.
   * The post starts in 'draft' status.
   */
  async create(params: CreatePostParams): Promise<Post> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const hashtagsJson = params.hashtags ? JSON.stringify(params.hashtags) : null;
      const templateFields = params.templateFields ? JSON.stringify(params.templateFields) : null;

      const result = await client.query(
        `INSERT INTO posts (user_id, channel_connection_id, content_type, caption, hashtags_json, status, template_fields)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6)
         RETURNING id, user_id, channel_connection_id, content_type, caption, hashtags_json, status, external_post_id, template_fields, created_at, updated_at, published_at`,
        [params.userId, params.channelConnectionId, params.contentType, params.caption ?? null, hashtagsJson, templateFields],
      );

      const post = this.mapRow(result.rows[0]);

      if (params.mediaItemIds && params.mediaItemIds.length > 0) {
        await this.attachMedia(client, post.id, params.mediaItemIds);
      }

      await client.query('COMMIT');
      return post;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get a single post by ID, scoped to the user.
   */
  async getById(postId: string, userId: string): Promise<Post> {
    const result = await query(
      `SELECT id, user_id, channel_connection_id, content_type, caption, hashtags_json, status, external_post_id, template_fields, created_at, updated_at, published_at
       FROM posts
       WHERE id = $1 AND user_id = $2`,
      [postId, userId],
    );

    if (result.rows.length === 0) {
      throw new PlatformError({
        severity: 'error',
        component: 'PostService',
        operation: 'getById',
        description: 'The post was not found or you do not have permission to view it.',
        recommendedActions: ['Verify the post exists in your dashboard'],
      });
    }

    return this.mapRow(result.rows[0]);
  }

  /**
   * List posts for a user with pagination and optional status filter.
   */
  async list(userId: string, pagination: PaginationParams, statusFilter?: PostStatus): Promise<Post[]> {
    const offset = (pagination.page - 1) * pagination.limit;

    let sql = `SELECT id, user_id, channel_connection_id, content_type, caption, hashtags_json, status, external_post_id, template_fields, created_at, updated_at, published_at
       FROM posts
       WHERE user_id = $1`;
    const params: unknown[] = [userId];

    if (statusFilter) {
      params.push(statusFilter);
      sql += ` AND status = $${params.length}`;
    }

    params.push(pagination.limit, offset);
    sql += ` ORDER BY updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await query(sql, params);
    return result.rows.map((row: Record<string, unknown>) => this.mapRow(row));
  }

  /**
   * Update post fields. Only drafts can be freely edited.
   */
  async update(postId: string, userId: string, updates: UpdatePostParams): Promise<Post> {
    const existing = await this.getById(postId, userId);

    if (existing.status !== 'draft') {
      throw new PlatformError({
        severity: 'warning',
        component: 'PostService',
        operation: 'update',
        description: 'Only draft posts can be edited. Change the post status to draft first.',
        recommendedActions: ['Move the post back to draft status before editing'],
      });
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const setClauses: string[] = ['updated_at = NOW()'];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (updates.caption !== undefined) {
        setClauses.push(`caption = $${paramIndex++}`);
        values.push(updates.caption);
      }
      if (updates.hashtags !== undefined) {
        setClauses.push(`hashtags_json = $${paramIndex++}`);
        values.push(JSON.stringify(updates.hashtags));
      }
      if (updates.contentType !== undefined) {
        setClauses.push(`content_type = $${paramIndex++}`);
        values.push(updates.contentType);
      }
      if (updates.channelConnectionId !== undefined) {
        setClauses.push(`channel_connection_id = $${paramIndex++}`);
        values.push(updates.channelConnectionId);
      }
      if (updates.templateFields !== undefined) {
        setClauses.push(`template_fields = $${paramIndex++}`);
        values.push(JSON.stringify(updates.templateFields));
      }

      values.push(postId, userId);
      const result = await client.query(
        `UPDATE posts SET ${setClauses.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex}
         RETURNING id, user_id, channel_connection_id, content_type, caption, hashtags_json, status, external_post_id, template_fields, created_at, updated_at, published_at`,
        values,
      );

      if (updates.mediaItemIds !== undefined) {
        await client.query(`DELETE FROM post_media WHERE post_id = $1`, [postId]);
        if (updates.mediaItemIds.length > 0) {
          await this.attachMedia(client, postId, updates.mediaItemIds);
        }
      }

      await client.query('COMMIT');
      return this.mapRow(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Transition a post to a new status, enforcing the state machine.
   * Rejects invalid transitions with PlatformError.
   */
  async transitionStatus(postId: string, userId: string, newStatus: PostStatus): Promise<Post> {
    const post = await this.getById(postId, userId);
    const allowed = VALID_TRANSITIONS[post.status];

    if (!allowed || !allowed.includes(newStatus)) {
      throw new PlatformError({
        severity: 'error',
        component: 'PostService',
        operation: 'transitionStatus',
        description: `Cannot transition post from '${post.status}' to '${newStatus}'. This status change is not allowed.`,
        recommendedActions: [
          `Valid transitions from '${post.status}': ${allowed ? allowed.join(', ') : 'none'}`,
        ],
      });
    }

    const publishedClause = newStatus === 'published' ? ', published_at = NOW()' : '';

    const result = await query(
      `UPDATE posts SET status = $1, updated_at = NOW()${publishedClause}
       WHERE id = $2 AND user_id = $3
       RETURNING id, user_id, channel_connection_id, content_type, caption, hashtags_json, status, external_post_id, template_fields, created_at, updated_at, published_at`,
      [newStatus, postId, userId],
    );

    return this.mapRow(result.rows[0]);
  }

  /**
   * Get media items attached to a post, ordered by display_order.
   */
  async getPostMedia(postId: string): Promise<PostMedia[]> {
    const result = await query(
      `SELECT id, post_id, media_item_id, display_order
       FROM post_media
       WHERE post_id = $1
       ORDER BY display_order ASC`,
      [postId],
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      postId: row.post_id as string,
      mediaItemId: row.media_item_id as string,
      displayOrder: row.display_order as number,
    }));
  }

  // ── Private helpers ──────────────────────────────────────────

  private async attachMedia(
    client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
    postId: string,
    mediaItemIds: string[],
  ): Promise<void> {
    for (let i = 0; i < mediaItemIds.length; i++) {
      await client.query(
        `INSERT INTO post_media (post_id, media_item_id, display_order) VALUES ($1, $2, $3)`,
        [postId, mediaItemIds[i], i],
      );
    }
  }

  private mapRow(row: Record<string, unknown>): Post {
    let templateFields: Record<string, string> | undefined;
    if (row.template_fields) {
      templateFields = typeof row.template_fields === 'string'
        ? JSON.parse(row.template_fields as string)
        : row.template_fields as Record<string, string>;
    }

    return {
      id: row.id as string,
      userId: row.user_id as string,
      channelConnectionId: row.channel_connection_id as string,
      contentType: row.content_type as ContentType,
      caption: (row.caption as string) ?? '',
      hashtagsJson: (row.hashtags_json as string) ?? '[]',
      status: row.status as PostStatus,
      externalPostId: (row.external_post_id as string) ?? undefined,
      templateFields,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
      publishedAt: row.published_at ? new Date(row.published_at as string) : undefined,
    };
  }
}

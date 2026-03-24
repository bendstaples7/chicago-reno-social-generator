import crypto from 'node:crypto';
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import s3Client, { MEDIA_BUCKET } from '../config/storage.js';
import { query } from '../config/database.js';
import { PlatformError } from '../errors/index.js';
import type { MediaItem, PaginationParams, GeneratedImage } from 'shared';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'video/mp4'];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export class MediaService {
  /**
   * Upload a media file. Validates format and size, stores binary in S3,
   * metadata in PostgreSQL. Returns the created MediaItem.
   */
  async upload(file: UploadedFile, userId: string): Promise<MediaItem> {
    this.validateFile(file);

    const storageKey = `media/${userId}/${crypto.randomUUID()}-${file.originalname}`;
    const thumbnailUrl = `/media/thumbnail/${storageKey}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: MEDIA_BUCKET,
        Key: storageKey,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    const result = await query(
      `INSERT INTO media_items (user_id, filename, mime_type, file_size_bytes, storage_key, thumbnail_url, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'uploaded')
       RETURNING id, user_id, filename, mime_type, file_size_bytes, storage_key, thumbnail_url, source, ai_description, width, height, created_at`,
      [userId, file.originalname, file.mimetype, file.size, storageKey, thumbnailUrl],
    );

    return this.mapRow(result.rows[0]);
  }

  /**
   * Store an AI-generated image in the media library.
   * Tags it with source='ai_generated' and the original description.
   */
  async storeGenerated(image: GeneratedImage, userId: string): Promise<MediaItem> {
    let buffer: Buffer;

    if (image.url.startsWith('data:')) {
      // Base64 data URI from GPT-Image-1
      const commaIdx = image.url.indexOf(',');
      if (commaIdx === -1) {
        throw new PlatformError({
          severity: 'error',
          component: 'MediaService',
          operation: 'storeGenerated',
          description: 'Invalid base64 data URI.',
          recommendedActions: ['Try generating the image again'],
        });
      }
      buffer = Buffer.from(image.url.substring(commaIdx + 1), 'base64');
    } else {
      // Regular URL (legacy DALL-E style)
      const response = await fetch(image.url);
      if (!response.ok) {
        throw new PlatformError({
          severity: 'error',
          component: 'MediaService',
          operation: 'storeGenerated',
          description: 'Failed to download the generated image for storage.',
          recommendedActions: ['Try generating the image again'],
        });
      }
      buffer = Buffer.from(await response.arrayBuffer());
    }

    const mimeType = image.format === 'png' ? 'image/png' : image.format === 'webp' ? 'image/webp' : 'image/jpeg';
    const ext = image.format === 'png' ? 'png' : image.format === 'webp' ? 'webp' : 'jpg';
    const filename = `ai-generated-${crypto.randomUUID()}.${ext}`;
    const storageKey = `media/${userId}/${filename}`;
    const thumbnailUrl = `/media/thumbnail/${storageKey}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: MEDIA_BUCKET,
        Key: storageKey,
        Body: buffer,
        ContentType: mimeType,
      }),
    );

    const result = await query(
      `INSERT INTO media_items (user_id, filename, mime_type, file_size_bytes, storage_key, thumbnail_url, source, ai_description, width, height)
       VALUES ($1, $2, $3, $4, $5, $6, 'ai_generated', $7, $8, $9)
       RETURNING id, user_id, filename, mime_type, file_size_bytes, storage_key, thumbnail_url, source, ai_description, width, height, created_at`,
      [userId, filename, mimeType, buffer.length, storageKey, thumbnailUrl, image.description, image.width, image.height],
    );

    return this.mapRow(result.rows[0]);
  }

  /**
   * Delete a media file from S3 and PostgreSQL.
   */
  async delete(mediaId: string, userId: string): Promise<void> {
    const result = await query(
      `SELECT storage_key FROM media_items WHERE id = $1 AND user_id = $2`,
      [mediaId, userId],
    );

    if (result.rows.length === 0) {
      throw new PlatformError({
        severity: 'error',
        component: 'MediaService',
        operation: 'delete',
        description: 'The media item was not found or you do not have permission to delete it.',
        recommendedActions: ['Verify the media item exists in your library'],
      });
    }

    const storageKey = result.rows[0].storage_key as string;

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: MEDIA_BUCKET,
        Key: storageKey,
      }),
    );

    await query(`DELETE FROM media_items WHERE id = $1 AND user_id = $2`, [mediaId, userId]);
  }

  /**
   * List all media for a user with pagination and source labels.
   */
  async list(userId: string, pagination: PaginationParams): Promise<MediaItem[]> {
    const offset = (pagination.page - 1) * pagination.limit;

    const result = await query(
      `SELECT id, user_id, filename, mime_type, file_size_bytes, storage_key, thumbnail_url, source, ai_description, width, height, created_at
       FROM media_items
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, pagination.limit, offset],
    );

    return result.rows.map((row: Record<string, unknown>) => this.mapRow(row));
  }

  /**
   * Get a single media item by ID.
   */
  async getById(mediaId: string, userId: string): Promise<MediaItem | null> {
    const result = await query(
      `SELECT id, user_id, filename, mime_type, file_size_bytes, storage_key, thumbnail_url, source, ai_description, width, height, created_at
       FROM media_items
       WHERE id = $1 AND user_id = $2`,
      [mediaId, userId],
    );

    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  // ── Private helpers ──────────────────────────────────────────

  private validateFile(file: UploadedFile): void {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new PlatformError({
        severity: 'warning',
        component: 'MediaService',
        operation: 'upload',
        description: `This file format is not supported. The platform accepts JPEG, PNG, and MP4 files.`,
        recommendedActions: ['Convert the file to JPEG, PNG, or MP4 and try again'],
      });
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new PlatformError({
        severity: 'warning',
        component: 'MediaService',
        operation: 'upload',
        description: 'The file exceeds the 50 MB size limit.',
        recommendedActions: ['Reduce the file size and try again'],
      });
    }
  }

  private mapRow(row: Record<string, unknown>): MediaItem {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      filename: row.filename as string,
      mimeType: row.mime_type as string,
      fileSizeBytes: row.file_size_bytes as number,
      storageKey: row.storage_key as string,
      thumbnailUrl: row.thumbnail_url as string,
      source: row.source as MediaItem['source'],
      aiDescription: (row.ai_description as string) ?? undefined,
      width: (row.width as number) ?? 0,
      height: (row.height as number) ?? 0,
      createdAt: new Date(row.created_at as string),
    };
  }
}

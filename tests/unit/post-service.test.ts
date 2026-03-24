import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Post } from '../../shared/src/types/post.js';
import { ContentType } from '../../shared/src/types/enums.js';

const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();

vi.mock('../../server/src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn().mockResolvedValue({
    query: (...args: unknown[]) => mockClientQuery(...args),
    release: () => mockClientRelease(),
  }),
}));

import { PostService } from '../../server/src/services/post-service.js';
import { query, getClient } from '../../server/src/config/database.js';
import { PlatformError } from '../../server/src/errors/platform-error.js';

const mockedQuery = vi.mocked(query);

const NOW = '2024-06-15T10:00:00Z';

function makePostRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'post-1',
    user_id: 'user-1',
    channel_connection_id: 'chan-1',
    content_type: 'education',
    caption: 'Test caption',
    hashtags_json: '["#reno"]',
    status: 'draft',
    external_post_id: null,
    template_fields: null,
    created_at: NOW,
    updated_at: NOW,
    published_at: null,
    ...overrides,
  };
}

describe('PostService', () => {
  let service: PostService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
    service = new PostService();
  });

  describe('create()', () => {
    it('creates a draft post and returns it', async () => {
      const row = makePostRow();
      mockClientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [row] }) // INSERT
        .mockResolvedValueOnce(undefined); // COMMIT

      const post = await service.create({
        userId: 'user-1',
        channelConnectionId: 'chan-1',
        contentType: ContentType.Education,
        caption: 'Test caption',
        hashtags: ['#reno'],
      });

      expect(post.id).toBe('post-1');
      expect(post.status).toBe('draft');
      expect(post.contentType).toBe('education');
      expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO posts'),
        expect.any(Array),
      );
      expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
    });

    it('attaches media items when provided', async () => {
      const row = makePostRow();
      mockClientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [row] }) // INSERT post
        .mockResolvedValueOnce(undefined) // INSERT post_media 1
        .mockResolvedValueOnce(undefined) // INSERT post_media 2
        .mockResolvedValueOnce(undefined); // COMMIT

      await service.create({
        userId: 'user-1',
        channelConnectionId: 'chan-1',
        contentType: ContentType.Education,
        mediaItemIds: ['media-1', 'media-2'],
      });

      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO post_media'),
        ['post-1', 'media-1', 0],
      );
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO post_media'),
        ['post-1', 'media-2', 1],
      );
    });

    it('rolls back on error', async () => {
      mockClientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(new Error('db error')); // INSERT fails

      await expect(
        service.create({
          userId: 'user-1',
          channelConnectionId: 'chan-1',
          contentType: ContentType.Education,
        }),
      ).rejects.toThrow('db error');

      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalled();
    });
  });

  describe('getById()', () => {
    it('returns the post when found', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [makePostRow()] } as never);

      const post = await service.getById('post-1', 'user-1');

      expect(post.id).toBe('post-1');
      expect(post.userId).toBe('user-1');
    });

    it('throws PlatformError when not found', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] } as never);

      await expect(service.getById('missing', 'user-1')).rejects.toThrow(PlatformError);
    });
  });

  describe('list()', () => {
    it('returns posts with pagination', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [makePostRow(), makePostRow({ id: 'post-2' })],
      } as never);

      const posts = await service.list('user-1', { page: 1, limit: 10 });

      expect(posts).toHaveLength(2);
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        ['user-1', 10, 0],
      );
    });

    it('applies status filter when provided', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] } as never);

      await service.list('user-1', { page: 1, limit: 10 }, 'draft');

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('AND status = $2'),
        ['user-1', 'draft', 10, 0],
      );
    });
  });

  describe('transitionStatus()', () => {
    const validTransitions: [string, string][] = [
      ['draft', 'awaiting_approval'],
      ['awaiting_approval', 'approved'],
      ['awaiting_approval', 'draft'],
      ['approved', 'publishing'],
      ['publishing', 'published'],
      ['publishing', 'failed'],
      ['failed', 'publishing'],
      ['failed', 'draft'],
    ];

    it.each(validTransitions)(
      'allows transition from %s to %s',
      async (from, to) => {
        // getById call
        mockedQuery.mockResolvedValueOnce({
          rows: [makePostRow({ status: from })],
        } as never);
        // UPDATE call
        mockedQuery.mockResolvedValueOnce({
          rows: [makePostRow({ status: to })],
        } as never);

        const post = await service.transitionStatus('post-1', 'user-1', to as any);
        expect(post.status).toBe(to);
      },
    );

    const invalidTransitions: [string, string][] = [
      ['draft', 'approved'],
      ['draft', 'publishing'],
      ['draft', 'published'],
      ['draft', 'failed'],
      ['awaiting_approval', 'publishing'],
      ['awaiting_approval', 'published'],
      ['awaiting_approval', 'failed'],
      ['approved', 'draft'],
      ['approved', 'awaiting_approval'],
      ['approved', 'published'],
      ['approved', 'failed'],
      ['publishing', 'draft'],
      ['publishing', 'awaiting_approval'],
      ['publishing', 'approved'],
      ['published', 'draft'],
      ['published', 'awaiting_approval'],
      ['published', 'approved'],
      ['published', 'publishing'],
      ['published', 'failed'],
      ['failed', 'awaiting_approval'],
      ['failed', 'approved'],
      ['failed', 'published'],
    ];

    it.each(invalidTransitions)(
      'rejects transition from %s to %s',
      async (from, to) => {
        mockedQuery.mockResolvedValueOnce({
          rows: [makePostRow({ status: from })],
        } as never);

        await expect(
          service.transitionStatus('post-1', 'user-1', to as any),
        ).rejects.toThrow(PlatformError);
      },
    );

    it('sets published_at when transitioning to published', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [makePostRow({ status: 'publishing' })],
      } as never);
      mockedQuery.mockResolvedValueOnce({
        rows: [makePostRow({ status: 'published', published_at: NOW })],
      } as never);

      await service.transitionStatus('post-1', 'user-1', 'published');

      expect(mockedQuery).toHaveBeenLastCalledWith(
        expect.stringContaining('published_at = NOW()'),
        ['published', 'post-1', 'user-1'],
      );
    });
  });

  describe('update()', () => {
    it('throws when post is not a draft', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [makePostRow({ status: 'awaiting_approval' })],
      } as never);

      await expect(
        service.update('post-1', 'user-1', { caption: 'new' }),
      ).rejects.toThrow(PlatformError);
    });
  });

  describe('getPostMedia()', () => {
    it('returns media items ordered by display_order', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [
          { id: 'pm-1', post_id: 'post-1', media_item_id: 'media-1', display_order: 0 },
          { id: 'pm-2', post_id: 'post-1', media_item_id: 'media-2', display_order: 1 },
        ],
      } as never);

      const media = await service.getPostMedia('post-1');

      expect(media).toHaveLength(2);
      expect(media[0].mediaItemId).toBe('media-1');
      expect(media[0].displayOrder).toBe(0);
      expect(media[1].displayOrder).toBe(1);
    });
  });

  describe('mapRow()', () => {
    it('parses template_fields from JSONB', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [makePostRow({ template_fields: { topic_title: 'Flooring' } })],
      } as never);

      const post = await service.getById('post-1', 'user-1');
      expect(post.templateFields).toEqual({ topic_title: 'Flooring' });
    });

    it('handles null template_fields', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [makePostRow({ template_fields: null })],
      } as never);

      const post = await service.getById('post-1', 'user-1');
      expect(post.templateFields).toBeUndefined();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1, configurePrepareResults } from './helpers/mock-d1.js';
import type { MockD1Database } from './helpers/mock-d1.js';
import { InstagramChannel } from '../../worker/src/services/instagram-channel.js';
import type { Post } from '../../shared/src/types/index.js';

const ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-1',
    userId: 'user-1',
    channelConnectionId: 'conn-1',
    contentType: 'education' as Post['contentType'],
    caption: 'A great renovation tip!',
    hashtagsJson: JSON.stringify(['#renovation', '#home']),
    status: 'draft' as Post['status'],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('InstagramChannel', () => {
  let db: MockD1Database;
  let channel: InstagramChannel;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockD1();
    channel = new InstagramChannel({
      db: db as unknown as D1Database,
      encryptionKey: ENCRYPTION_KEY,
      publicUrl: '',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'https://example.com/callback',
    });
  });

  describe('getAuthorizationUrl()', () => {
    it('returns a valid Instagram OAuth URL with all required params', () => {
      const url = channel.getAuthorizationUrl('test-state-123');

      expect(url).toContain('https://api.instagram.com/oauth/authorize');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('redirect_uri=');
      expect(url).toContain('state=test-state-123');
      expect(url).toContain('response_type=code');
      expect(url).toContain('scope=instagram_basic');
    });

    it('includes the content publish scope', () => {
      const url = channel.getAuthorizationUrl('s');
      expect(url).toContain('instagram_content_publish');
    });
  });

  describe('getConstraints()', () => {
    it('returns correct maxCaptionLength', () => {
      expect(channel.getConstraints().maxCaptionLength).toBe(2200);
    });

    it('returns correct maxHashtags', () => {
      expect(channel.getConstraints().maxHashtags).toBe(30);
    });

    it('returns correct maxCarouselImages', () => {
      expect(channel.getConstraints().maxCarouselImages).toBe(10);
    });

    it('returns correct maxReelDuration', () => {
      expect(channel.getConstraints().maxReelDuration).toBe(90);
    });

    it('returns correct supportedMediaTypes', () => {
      expect(channel.getConstraints().supportedMediaTypes).toEqual([
        'image/jpeg',
        'image/png',
        'video/mp4',
      ]);
    });

    it('returns correct recommended dimensions', () => {
      const dims = channel.getConstraints().recommendedDimensions;
      expect(dims.square).toEqual({ width: 1080, height: 1080 });
      expect(dims.portrait).toEqual({ width: 1080, height: 1350 });
      expect(dims.landscape).toEqual({ width: 1080, height: 566 });
    });
  });

  describe('validatePost()', () => {
    it('returns valid for a post within all constraints', async () => {
      configurePrepareResults(db, [
        { all: { results: [{ mime_type: 'image/jpeg', file_size_bytes: 1000 }] } },
      ]);

      const post = makePost();
      const result = await channel.validatePost(post);

      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('catches caption exceeding 2200 characters', async () => {
      configurePrepareResults(db, [{ all: { results: [] } }]);

      const post = makePost({ caption: 'x'.repeat(2201) });
      const result = await channel.validatePost(post);

      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(1);
      expect(result.violations[0]).toContain('2200');
    });

    it('catches too many hashtags', async () => {
      configurePrepareResults(db, [{ all: { results: [] } }]);

      const hashtags = Array.from({ length: 31 }, (_, i) => '#tag' + i);
      const post = makePost({ hashtagsJson: JSON.stringify(hashtags) });
      const result = await channel.validatePost(post);

      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes('hashtag'))).toBe(true);
    });

    it('catches too many carousel images', async () => {
      const rows = Array.from({ length: 11 }, () => ({
        mime_type: 'image/jpeg',
        file_size_bytes: 1000,
      }));
      configurePrepareResults(db, [{ all: { results: rows } }]);

      const post = makePost();
      const result = await channel.validatePost(post);

      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes('carousel'))).toBe(true);
    });

    it('catches unsupported media types', async () => {
      configurePrepareResults(db, [
        { all: { results: [{ mime_type: 'image/gif', file_size_bytes: 1000 }] } },
      ]);

      const post = makePost();
      const result = await channel.validatePost(post);

      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes('Unsupported'))).toBe(true);
    });

    it('returns valid when post has no caption and no hashtags', async () => {
      configurePrepareResults(db, [{ all: { results: [] } }]);

      const post = makePost({ caption: '', hashtagsJson: '[]' });
      const result = await channel.validatePost(post);

      expect(result.valid).toBe(true);
    });
  });

  describe('disconnect()', () => {
    it('updates the connection status to disconnected and clears the token', async () => {
      // Mock: find the connection, then update
      configurePrepareResults(db, [
        { first: { access_token_encrypted: null } },
        { run: { success: true } },
      ]);

      await channel.disconnect('conn-1');

      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE channel_connections'),
      );
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("status = 'disconnected'"),
      );
    });

    it('throws PlatformError when connection not found', async () => {
      configurePrepareResults(db, [{ first: null }]);

      await expect(channel.disconnect('missing')).rejects.toThrow('not found');
    });
  });

  describe('formatPost()', () => {
    it('builds correct structure for a single image post', async () => {
      configurePrepareResults(db, [
        { all: { results: [{ storage_key: 'media/user-1/photo.jpg', mime_type: 'image/jpeg' }] } },
      ]);

      const post = makePost();
      const formatted = await channel.formatPost(post);

      expect(formatted.postId).toBe('post-1');
      expect(formatted.channelType).toBe('instagram');
      expect(formatted.caption).toBe('A great renovation tip!');
      expect(formatted.hashtags).toEqual(['#renovation', '#home']);
      expect(formatted.mediaUrls).toEqual(['/media/user-1/photo.jpg']);
      expect(formatted.metadata.formatType).toBe('IMAGE');
    });

    it('detects carousel format for multiple images', async () => {
      configurePrepareResults(db, [
        {
          all: {
            results: [
              { storage_key: 'media/user-1/a.jpg', mime_type: 'image/jpeg' },
              { storage_key: 'media/user-1/b.png', mime_type: 'image/png' },
            ],
          },
        },
      ]);

      const post = makePost();
      const formatted = await channel.formatPost(post);

      expect(formatted.metadata.formatType).toBe('CAROUSEL');
      expect(formatted.mediaUrls).toHaveLength(2);
    });

    it('detects reel format for video', async () => {
      configurePrepareResults(db, [
        { all: { results: [{ storage_key: 'media/user-1/clip.mp4', mime_type: 'video/mp4' }] } },
      ]);

      const post = makePost();
      const formatted = await channel.formatPost(post);

      expect(formatted.metadata.formatType).toBe('REELS');
    });

    it('handles post with no hashtags', async () => {
      configurePrepareResults(db, [{ all: { results: [] } }]);

      const post = makePost({ hashtagsJson: '' });
      const formatted = await channel.formatPost(post);

      expect(formatted.hashtags).toEqual([]);
    });
  });

  describe('channelType', () => {
    it('is instagram', () => {
      expect(channel.channelType).toBe('instagram');
    });
  });
});

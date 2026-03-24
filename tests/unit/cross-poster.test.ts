import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/src/config/database.js', () => ({
  query: vi.fn(),
}));

import { CrossPoster } from '../../server/src/services/cross-poster.js';
import { PlatformError } from '../../server/src/errors/index.js';
import { query } from '../../server/src/config/database.js';
import type { Post, FormattedPost, PublishResult, ChannelInterface } from '../../shared/src/types/index.js';

const mockedQuery = vi.mocked(query);

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-1',
    userId: 'user-1',
    channelConnectionId: 'conn-1',
    contentType: 'education' as Post['contentType'],
    caption: 'A great renovation tip!',
    hashtagsJson: JSON.stringify(['#renovation', '#home']),
    status: 'approved' as Post['status'],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeFormattedPost(overrides: Partial<FormattedPost> = {}): FormattedPost {
  return {
    postId: 'post-1',
    channelType: 'instagram',
    caption: 'A great renovation tip!',
    hashtags: ['#renovation', '#home'],
    mediaUrls: ['media/photo.jpg'],
    metadata: { formatType: 'IMAGE' },
    ...overrides,
  };
}

function createMocks() {
  const post = makePost();
  const formatted = makeFormattedPost();

  const postService = {
    getById: vi.fn().mockResolvedValue(post),
    transitionStatus: vi.fn().mockResolvedValue(post),
  };

  const approvalService = {
    isApproved: vi.fn().mockResolvedValue(true),
  };

  const channel: ChannelInterface = {
    channelType: 'instagram',
    getAuthorizationUrl: vi.fn(),
    handleAuthCallback: vi.fn(),
    disconnect: vi.fn(),
    formatPost: vi.fn().mockResolvedValue(formatted),
    validatePost: vi.fn(),
    publish: vi.fn().mockResolvedValue({ success: true, externalPostId: 'ig-123' } as PublishResult),
    getPostStatus: vi.fn(),
    getConstraints: vi.fn(),
  };

  const activityLog = {
    log: vi.fn().mockResolvedValue(undefined),
    getEntries: vi.fn(),
  };

  const delayFn = vi.fn().mockResolvedValue(undefined);

  return { postService, approvalService, channel, activityLog, delayFn, post, formatted };
}

describe('CrossPoster', () => {
  let mocks: ReturnType<typeof createMocks>;
  let crossPoster: CrossPoster;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);
    mocks = createMocks();
    crossPoster = new CrossPoster({
      postService: mocks.postService as any,
      approvalService: mocks.approvalService as any,
      channel: mocks.channel,
      activityLog: mocks.activityLog as any,
      delayFn: mocks.delayFn,
    });
  });

  describe('publish()', () => {
    it('rejects unapproved posts', async () => {
      mocks.approvalService.isApproved.mockResolvedValue(false);

      await expect(crossPoster.publish('post-1', 'user-1')).rejects.toThrow(PlatformError);
      await expect(crossPoster.publish('post-1', 'user-1')).rejects.toThrow('not been approved');

      // Should not attempt to publish
      expect(mocks.channel.publish).not.toHaveBeenCalled();
      expect(mocks.postService.transitionStatus).not.toHaveBeenCalled();
    });

    it('completes successful publish flow: approval → format → publish → status update', async () => {
      const result = await crossPoster.publish('post-1', 'user-1');

      expect(result.success).toBe(true);
      expect(result.externalPostId).toBe('ig-123');

      // Verify flow order
      expect(mocks.postService.getById).toHaveBeenCalledWith('post-1', 'user-1');
      expect(mocks.approvalService.isApproved).toHaveBeenCalledWith('post-1');
      expect(mocks.postService.transitionStatus).toHaveBeenCalledWith('post-1', 'user-1', 'publishing');
      expect(mocks.channel.formatPost).toHaveBeenCalledWith(mocks.post);
      expect(mocks.channel.publish).toHaveBeenCalledWith(mocks.formatted);
      expect(mocks.postService.transitionStatus).toHaveBeenCalledWith('post-1', 'user-1', 'published');
    });

    it('sets post status to published on success', async () => {
      await crossPoster.publish('post-1', 'user-1');

      const transitionCalls = mocks.postService.transitionStatus.mock.calls;
      expect(transitionCalls[0]).toEqual(['post-1', 'user-1', 'publishing']);
      expect(transitionCalls[1]).toEqual(['post-1', 'user-1', 'published']);
    });

    it('updates external_post_id in DB on success', async () => {
      await crossPoster.publish('post-1', 'user-1');

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('external_post_id'),
        ['ig-123', 'post-1'],
      );
    });

    it('logs success to ActivityLog', async () => {
      await crossPoster.publish('post-1', 'user-1');

      expect(mocks.activityLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          component: 'CrossPoster',
          operation: 'publish',
          severity: 'info',
          description: expect.stringContaining('published successfully'),
        }),
      );
    });

    it('retries on transient failure up to 3 times', async () => {
      const publishMock = vi.mocked(mocks.channel.publish);
      publishMock
        .mockResolvedValueOnce({ success: false, error: 'Network timeout' })
        .mockResolvedValueOnce({ success: false, error: 'Network timeout' })
        .mockResolvedValueOnce({ success: false, error: 'Network timeout' })
        .mockResolvedValueOnce({ success: true, externalPostId: 'ig-456' });

      const result = await crossPoster.publish('post-1', 'user-1');

      expect(result.success).toBe(true);
      expect(publishMock).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    it('uses exponential backoff delays (1s, 2s, 4s)', async () => {
      const publishMock = vi.mocked(mocks.channel.publish);
      publishMock
        .mockResolvedValueOnce({ success: false, error: 'Network timeout' })
        .mockResolvedValueOnce({ success: false, error: 'Network timeout' })
        .mockResolvedValueOnce({ success: false, error: 'Network timeout' })
        .mockResolvedValueOnce({ success: true, externalPostId: 'ig-456' });

      await crossPoster.publish('post-1', 'user-1');

      expect(mocks.delayFn).toHaveBeenCalledTimes(3);
      expect(mocks.delayFn).toHaveBeenNthCalledWith(1, 1000);
      expect(mocks.delayFn).toHaveBeenNthCalledWith(2, 2000);
      expect(mocks.delayFn).toHaveBeenNthCalledWith(3, 4000);
    });

    it('fails after all retries exhausted', async () => {
      const publishMock = vi.mocked(mocks.channel.publish);
      publishMock.mockResolvedValue({ success: false, error: 'Server error' });

      await expect(crossPoster.publish('post-1', 'user-1')).rejects.toThrow(PlatformError);
      await expect(crossPoster.publish('post-1', 'user-1')).rejects.toThrow('Publishing failed');
    });

    it('sets post status to failed after exhausted retries', async () => {
      const publishMock = vi.mocked(mocks.channel.publish);
      publishMock.mockResolvedValue({ success: false, error: 'Server error' });

      try {
        await crossPoster.publish('post-1', 'user-1');
      } catch {
        // expected
      }

      expect(mocks.postService.transitionStatus).toHaveBeenCalledWith('post-1', 'user-1', 'failed');
    });

    it('logs failure to ActivityLog after exhausted retries', async () => {
      const publishMock = vi.mocked(mocks.channel.publish);
      publishMock.mockResolvedValue({ success: false, error: 'Server error' });

      try {
        await crossPoster.publish('post-1', 'user-1');
      } catch {
        // expected
      }

      expect(mocks.activityLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          component: 'CrossPoster',
          operation: 'publish',
          severity: 'error',
          description: expect.stringContaining('failed to publish'),
        }),
      );
    });

    it('does not retry permanent errors (auth/invalid)', async () => {
      const publishMock = vi.mocked(mocks.channel.publish);
      publishMock.mockResolvedValue({ success: false, error: 'Unauthorized: invalid token' });

      try {
        await crossPoster.publish('post-1', 'user-1');
      } catch {
        // expected
      }

      // Only 1 attempt, no retries for permanent errors
      expect(publishMock).toHaveBeenCalledTimes(1);
      expect(mocks.delayFn).not.toHaveBeenCalled();
    });

    it('does not retry on invalid content errors', async () => {
      const publishMock = vi.mocked(mocks.channel.publish);
      publishMock.mockResolvedValue({ success: false, error: 'Invalid media format' });

      try {
        await crossPoster.publish('post-1', 'user-1');
      } catch {
        // expected
      }

      expect(publishMock).toHaveBeenCalledTimes(1);
    });
  });
});

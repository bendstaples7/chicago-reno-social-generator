import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/src/config/database.js', () => ({
  query: vi.fn(),
}));

import { PublishApprovalService } from '../../server/src/services/publish-approval-service.js';
import { query } from '../../server/src/config/database.js';
import { PlatformError } from '../../server/src/errors/platform-error.js';

const mockedQuery = vi.mocked(query);

describe('PublishApprovalService', () => {
  let service: PublishApprovalService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PublishApprovalService();
  });

  describe('getMode()', () => {
    it('always returns manual_review in v1', async () => {
      const mode = await service.getMode('user-1');
      expect(mode).toBe('manual_review');
    });

    it('returns manual_review regardless of userId', async () => {
      const mode1 = await service.getMode('user-1');
      const mode2 = await service.getMode('user-999');
      expect(mode1).toBe('manual_review');
      expect(mode2).toBe('manual_review');
    });
  });

  describe('approve()', () => {
    it('approves a post in awaiting_approval status', async () => {
      mockedQuery
        .mockResolvedValueOnce({ rows: [{ id: 'post-1', status: 'awaiting_approval' }] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      await expect(service.approve('post-1', 'user-1')).resolves.toBeUndefined();

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, status FROM posts'),
        ['post-1', 'user-1'],
      );
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'approved'"),
        ['post-1', 'user-1'],
      );
    });

    it('throws PlatformError when post is not found', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] } as never);

      try {
        await service.approve('missing', 'user-1');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(PlatformError);
        expect((err as PlatformError).description).toMatch(/not found/);
      }
    });

    it('throws PlatformError when post is in draft status', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'post-1', status: 'draft' }] } as never);

      await expect(service.approve('post-1', 'user-1')).rejects.toThrow(PlatformError);
    });

    it('throws PlatformError when post is already approved', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'post-1', status: 'approved' }] } as never);

      await expect(service.approve('post-1', 'user-1')).rejects.toThrow(PlatformError);
    });

    it('throws PlatformError when post is in published status', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'post-1', status: 'published' }] } as never);

      await expect(service.approve('post-1', 'user-1')).rejects.toThrow(PlatformError);
    });

    it('throws PlatformError when post is in failed status', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'post-1', status: 'failed' }] } as never);

      await expect(service.approve('post-1', 'user-1')).rejects.toThrow(PlatformError);
    });

    it('includes descriptive error message for wrong status', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'post-1', status: 'draft' }] } as never);

      try {
        await service.approve('post-1', 'user-1');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(PlatformError);
        const pe = err as PlatformError;
        expect(pe.description).toContain('draft');
        expect(pe.description).toContain('awaiting_approval');
        expect(pe.recommendedActions.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('isApproved()', () => {
    it('returns true when post status is approved', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [{ status: 'approved' }] } as never);

      const result = await service.isApproved('post-1');
      expect(result).toBe(true);
    });

    it('returns false when post status is draft', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [{ status: 'draft' }] } as never);

      const result = await service.isApproved('post-1');
      expect(result).toBe(false);
    });

    it('returns false when post status is awaiting_approval', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [{ status: 'awaiting_approval' }] } as never);

      const result = await service.isApproved('post-1');
      expect(result).toBe(false);
    });

    it('returns false when post status is published', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [{ status: 'published' }] } as never);

      const result = await service.isApproved('post-1');
      expect(result).toBe(false);
    });

    it('returns false when post status is failed', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [{ status: 'failed' }] } as never);

      const result = await service.isApproved('post-1');
      expect(result).toBe(false);
    });

    it('returns false when post does not exist', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] } as never);

      const result = await service.isApproved('missing');
      expect(result).toBe(false);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1, configurePrepareResults } from './helpers/mock-d1.js';
import type { MockD1Database } from './helpers/mock-d1.js';
import { PublishApprovalService } from '../../worker/src/services/publish-approval-service.js';
import { PlatformError } from '../../worker/src/errors/platform-error.js';

describe('PublishApprovalService', () => {
  let db: MockD1Database;
  let service: PublishApprovalService;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockD1();
    service = new PublishApprovalService(db as unknown as D1Database);
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
      configurePrepareResults(db, [
        { first: { id: 'post-1', status: 'awaiting_approval' } },
        { run: { success: true } },
      ]);

      await expect(service.approve('post-1', 'user-1')).resolves.toBeUndefined();

      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, status FROM posts'),
      );
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'approved'"),
      );
    });

    it('throws PlatformError when post is not found', async () => {
      configurePrepareResults(db, [{ first: null }]);

      try {
        await service.approve('missing', 'user-1');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(PlatformError);
        expect((err as PlatformError).description).toMatch(/not found/);
      }
    });

    it('throws PlatformError when post is in draft status', async () => {
      configurePrepareResults(db, [{ first: { id: 'post-1', status: 'draft' } }]);

      await expect(service.approve('post-1', 'user-1')).rejects.toThrow(PlatformError);
    });

    it('throws PlatformError when post is already approved', async () => {
      configurePrepareResults(db, [{ first: { id: 'post-1', status: 'approved' } }]);

      await expect(service.approve('post-1', 'user-1')).rejects.toThrow(PlatformError);
    });

    it('throws PlatformError when post is in published status', async () => {
      configurePrepareResults(db, [{ first: { id: 'post-1', status: 'published' } }]);

      await expect(service.approve('post-1', 'user-1')).rejects.toThrow(PlatformError);
    });

    it('throws PlatformError when post is in failed status', async () => {
      configurePrepareResults(db, [{ first: { id: 'post-1', status: 'failed' } }]);

      await expect(service.approve('post-1', 'user-1')).rejects.toThrow(PlatformError);
    });

    it('includes descriptive error message for wrong status', async () => {
      configurePrepareResults(db, [{ first: { id: 'post-1', status: 'draft' } }]);

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
      configurePrepareResults(db, [{ first: { status: 'approved' } }]);

      const result = await service.isApproved('post-1');
      expect(result).toBe(true);
    });

    it('returns false when post status is draft', async () => {
      configurePrepareResults(db, [{ first: { status: 'draft' } }]);

      const result = await service.isApproved('post-1');
      expect(result).toBe(false);
    });

    it('returns false when post status is awaiting_approval', async () => {
      configurePrepareResults(db, [{ first: { status: 'awaiting_approval' } }]);

      const result = await service.isApproved('post-1');
      expect(result).toBe(false);
    });

    it('returns false when post status is published', async () => {
      configurePrepareResults(db, [{ first: { status: 'published' } }]);

      const result = await service.isApproved('post-1');
      expect(result).toBe(false);
    });

    it('returns false when post status is failed', async () => {
      configurePrepareResults(db, [{ first: { status: 'failed' } }]);

      const result = await service.isApproved('post-1');
      expect(result).toBe(false);
    });

    it('returns false when post does not exist', async () => {
      configurePrepareResults(db, [{ first: null }]);

      const result = await service.isApproved('missing');
      expect(result).toBe(false);
    });
  });
});

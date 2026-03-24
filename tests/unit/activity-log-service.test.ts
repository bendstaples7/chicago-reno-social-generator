import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActivityLogEntry } from '../../shared/src/types/activity-log.js';

// Mock the database module before importing the service
vi.mock('../../server/src/config/database.js', () => ({
  query: vi.fn(),
}));

import { ActivityLogService } from '../../server/src/services/activity-log-service.js';
import { query } from '../../server/src/config/database.js';

const mockedQuery = vi.mocked(query);

describe('ActivityLogService', () => {
  let service: ActivityLogService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ActivityLogService();
  });

  describe('log()', () => {
    it('inserts an entry with all fields into the database', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

      await service.log({
        userId: 'user-123',
        component: 'CrossPoster',
        operation: 'publish',
        severity: 'error',
        description: 'Publishing failed after retries.',
        recommendedAction: 'Retry manually',
      });

      expect(mockedQuery).toHaveBeenCalledOnce();
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO activity_log_entries'),
        ['user-123', 'CrossPoster', 'publish', 'error', 'Publishing failed after retries.', 'Retry manually'],
      );
    });

    it('passes null for recommendedAction when not provided', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

      await service.log({
        userId: 'user-456',
        component: 'MediaService',
        operation: 'upload',
        severity: 'info',
        description: 'File uploaded successfully.',
      });

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO activity_log_entries'),
        ['user-456', 'MediaService', 'upload', 'info', 'File uploaded successfully.', null],
      );
    });

    it('propagates database errors', async () => {
      mockedQuery.mockRejectedValueOnce(new Error('connection refused'));

      await expect(
        service.log({
          userId: 'user-789',
          component: 'AuthModule',
          operation: 'login',
          severity: 'warning',
          description: 'Slow login.',
        }),
      ).rejects.toThrow('connection refused');
    });
  });

  describe('getEntries()', () => {
    it('returns mapped entries ordered by created_at DESC', async () => {
      const now = new Date('2024-06-15T10:00:00Z');
      mockedQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'entry-1',
            user_id: 'user-123',
            component: 'CrossPoster',
            operation: 'publish',
            severity: 'error',
            description: 'Publish failed.',
            recommended_action: 'Retry',
            created_at: now.toISOString(),
          },
        ],
      } as never);

      const entries = await service.getEntries('user-123', { page: 1, limit: 10 });

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        ['user-123', 10, 0],
      );

      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual<ActivityLogEntry>({
        id: 'entry-1',
        userId: 'user-123',
        component: 'CrossPoster',
        operation: 'publish',
        severity: 'error',
        description: 'Publish failed.',
        recommendedAction: 'Retry',
        createdAt: now,
      });
    });

    it('calculates correct offset for pagination', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] } as never);

      await service.getEntries('user-123', { page: 3, limit: 20 });

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $2 OFFSET $3'),
        ['user-123', 20, 40],
      );
    });

    it('maps recommendedAction to undefined when DB returns null', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'entry-2',
            user_id: 'user-123',
            component: 'MediaService',
            operation: 'upload',
            severity: 'info',
            description: 'Upload complete.',
            recommended_action: null,
            created_at: '2024-06-15T10:00:00Z',
          },
        ],
      } as never);

      const entries = await service.getEntries('user-123', { page: 1, limit: 10 });

      expect(entries[0].recommendedAction).toBeUndefined();
    });

    it('returns empty array when no entries exist', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] } as never);

      const entries = await service.getEntries('user-999', { page: 1, limit: 10 });

      expect(entries).toEqual([]);
    });
  });
});

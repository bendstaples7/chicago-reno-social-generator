import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActivityLogEntry } from '../../shared/src/types/activity-log.js';
import { createMockD1, configurePrepareResults } from './helpers/mock-d1.js';
import type { MockD1Database } from './helpers/mock-d1.js';
import { ActivityLogService } from '../../worker/src/services/activity-log-service.js';

describe('ActivityLogService', () => {
  let db: MockD1Database;
  let service: ActivityLogService;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockD1();
    service = new ActivityLogService(db as unknown as D1Database);
  });

  describe('log()', () => {
    it('inserts an entry with all fields into the database', async () => {
      configurePrepareResults(db, [{ run: { success: true } }]);

      await service.log({
        userId: 'user-123',
        component: 'CrossPoster',
        operation: 'publish',
        severity: 'error',
        description: 'Publishing failed after retries.',
        recommendedAction: 'Retry manually',
      });

      expect(db.prepare).toHaveBeenCalledOnce();
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO activity_log_entries'),
      );
      // Verify bind was called with the right values (id is generated, so skip it)
      const stmt = db._stmts[0];
      expect(stmt.bind).toHaveBeenCalledWith(
        expect.any(String), // generated UUID
        'user-123',
        'CrossPoster',
        'publish',
        'error',
        'Publishing failed after retries.',
        'Retry manually',
      );
    });

    it('passes null for recommendedAction when not provided', async () => {
      configurePrepareResults(db, [{ run: { success: true } }]);

      await service.log({
        userId: 'user-456',
        component: 'MediaService',
        operation: 'upload',
        severity: 'info',
        description: 'File uploaded successfully.',
      });

      const stmt = db._stmts[0];
      expect(stmt.bind).toHaveBeenCalledWith(
        expect.any(String),
        'user-456',
        'MediaService',
        'upload',
        'info',
        'File uploaded successfully.',
        null,
      );
    });

    it('propagates database errors', async () => {
      configurePrepareResults(db, [{ run: { success: true } }]);
      // Override run to reject
      db._stmts.length = 0;
      db.prepare.mockImplementation(() => {
        const stmt = {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn(),
          all: vi.fn(),
          run: vi.fn().mockRejectedValue(new Error('connection refused')),
          raw: vi.fn(),
        };
        db._stmts.push(stmt as any);
        return stmt;
      });

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
      configurePrepareResults(db, [
        {
          all: {
            results: [
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
          },
        },
      ]);

      const entries = await service.getEntries('user-123', { page: 1, limit: 10 });

      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
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
      configurePrepareResults(db, [{ all: { results: [] } }]);

      await service.getEntries('user-123', { page: 3, limit: 20 });

      // bind should be called with userId, limit, offset
      const stmt = db._stmts[0];
      expect(stmt.bind).toHaveBeenCalledWith('user-123', 20, 40);
    });

    it('maps recommendedAction to undefined when DB returns null', async () => {
      configurePrepareResults(db, [
        {
          all: {
            results: [
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
          },
        },
      ]);

      const entries = await service.getEntries('user-123', { page: 1, limit: 10 });

      expect(entries[0].recommendedAction).toBeUndefined();
    });

    it('returns empty array when no entries exist', async () => {
      configurePrepareResults(db, [{ all: { results: [] } }]);

      const entries = await service.getEntries('user-999', { page: 1, limit: 10 });

      expect(entries).toEqual([]);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module before importing the service
vi.mock('../../server/src/config/database.js', () => ({
  query: vi.fn(),
}));

import { AuthService } from '../../server/src/services/auth-service.js';
import { PlatformError } from '../../server/src/errors/platform-error.js';
import { query } from '../../server/src/config/database.js';

const mockedQuery = vi.mocked(query);

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuthService();
  });

  describe('initiateAuth()', () => {
    it('rejects empty email', async () => {
      await expect(service.initiateAuth('')).rejects.toThrow(PlatformError);
    });

    it('rejects non-chicago-reno.com email', async () => {
      await expect(service.initiateAuth('user@gmail.com')).rejects.toThrow(
        'Only @chicago-reno.com email addresses can access this platform.',
      );
    });

    it('rejects email with partial domain match', async () => {
      await expect(service.initiateAuth('user@not-chicago-reno.com')).rejects.toThrow(PlatformError);
    });

    it('accepts valid @chicago-reno.com email (case-insensitive)', async () => {
      const userId = 'user-uuid-1';
      mockedQuery
        .mockResolvedValueOnce({
          rows: [{
            id: userId,
            email: 'alice@chicago-reno.com',
            name: 'alice',
            created_at: '2024-01-01T00:00:00Z',
            last_active_at: '2024-01-01T00:00:00Z',
          }],
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never) // user_settings upsert
        .mockResolvedValueOnce({ rows: [] } as never); // session insert

      const result = await service.initiateAuth('Alice@Chicago-Reno.COM');

      expect(result.user.email).toBe('alice@chicago-reno.com');
      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe('string');
    });

    it('creates user_settings row on first login', async () => {
      mockedQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 'user-1', email: 'bob@chicago-reno.com', name: 'bob',
            created_at: '2024-01-01T00:00:00Z', last_active_at: '2024-01-01T00:00:00Z',
          }],
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      await service.initiateAuth('bob@chicago-reno.com');

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_settings'),
        ['user-1'],
      );
    });
  });

  describe('verifySession()', () => {
    it('returns null for empty token', async () => {
      const result = await service.verifySession('');
      expect(result).toBeNull();
    });

    it('returns null for non-existent token', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] } as never);
      const result = await service.verifySession('bad-token');
      expect(result).toBeNull();
    });

    it('returns null and deletes expired session', async () => {
      const expired = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago
      mockedQuery
        .mockResolvedValueOnce({
          rows: [{
            session_id: 'sess-1', last_active_at: expired,
            id: 'user-1', email: 'a@chicago-reno.com', name: 'a',
            created_at: '2024-01-01T00:00:00Z', user_last_active: expired,
          }],
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never); // DELETE

      const result = await service.verifySession('some-token');
      expect(result).toBeNull();
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM sessions'),
        ['sess-1'],
      );
    });

    it('returns user and touches session for valid token', async () => {
      const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
      mockedQuery
        .mockResolvedValueOnce({
          rows: [{
            session_id: 'sess-2', last_active_at: recent,
            id: 'user-2', email: 'b@chicago-reno.com', name: 'b',
            created_at: '2024-01-01T00:00:00Z', user_last_active: recent,
          }],
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never); // UPDATE

      const result = await service.verifySession('valid-token');
      expect(result).not.toBeNull();
      expect(result!.email).toBe('b@chicago-reno.com');
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sessions SET last_active_at'),
        ['sess-2'],
      );
    });
  });

  describe('logout()', () => {
    it('deletes the session by token', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] } as never);
      await service.logout('my-token');
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM sessions WHERE token'),
        ['my-token'],
      );
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/src/config/database.js', () => ({
  query: vi.fn(),
}));

import { UserSettingsService } from '../../server/src/services/user-settings-service.js';
import { PlatformError } from '../../server/src/errors/platform-error.js';
import { query } from '../../server/src/config/database.js';
import { AdvisorMode } from 'shared';

const mockedQuery = vi.mocked(query);

describe('UserSettingsService', () => {
  let service: UserSettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UserSettingsService();
  });

  describe('getSettings()', () => {
    it('returns user settings mapped from DB row', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{
          id: 'settings-1',
          user_id: 'user-1',
          advisor_mode: 'manual',
          approval_mode: 'manual_review',
          updated_at: '2024-06-01T00:00:00Z',
        }],
      } as never);

      const settings = await service.getSettings('user-1');

      expect(settings.id).toBe('settings-1');
      expect(settings.userId).toBe('user-1');
      expect(settings.advisorMode).toBe(AdvisorMode.Manual);
      expect(settings.approvalMode).toBe('manual_review');
      expect(settings.updatedAt).toBeInstanceOf(Date);
    });

    it('throws PlatformError when settings not found', async () => {
      mockedQuery.mockResolvedValue({ rows: [] } as never);

      await expect(service.getSettings('nonexistent')).rejects.toThrow(PlatformError);
      await expect(service.getSettings('nonexistent')).rejects.toThrow('User settings not found');
    });
  });

  describe('updateSettings()', () => {
    it('updates advisor_mode successfully', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{
          id: 'settings-1',
          user_id: 'user-1',
          advisor_mode: 'smart',
          approval_mode: 'manual_review',
          updated_at: '2024-06-01T12:00:00Z',
        }],
      } as never);

      const result = await service.updateSettings('user-1', { advisorMode: AdvisorMode.Smart });

      expect(result.advisorMode).toBe('smart');
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE user_settings'),
        ['smart', 'user-1'],
      );
    });

    it('updates approval_mode to manual_review', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{
          id: 'settings-1',
          user_id: 'user-1',
          advisor_mode: 'manual',
          approval_mode: 'manual_review',
          updated_at: '2024-06-01T12:00:00Z',
        }],
      } as never);

      const result = await service.updateSettings('user-1', { approvalMode: 'manual_review' });

      expect(result.approvalMode).toBe('manual_review');
    });

    it('blocks auto_publish mode with PlatformError', async () => {
      await expect(
        service.updateSettings('user-1', { approvalMode: 'auto_publish' }),
      ).rejects.toThrow(PlatformError);

      await expect(
        service.updateSettings('user-1', { approvalMode: 'auto_publish' }),
      ).rejects.toThrow('Auto-publish mode is not available in v1');

      // Should not have made any DB calls
      expect(mockedQuery).not.toHaveBeenCalled();
    });

    it('rejects invalid advisor_mode', async () => {
      await expect(
        service.updateSettings('user-1', { advisorMode: 'invalid_mode' as AdvisorMode }),
      ).rejects.toThrow(PlatformError);

      await expect(
        service.updateSettings('user-1', { advisorMode: 'invalid_mode' as AdvisorMode }),
      ).rejects.toThrow('Invalid advisor mode');
    });

    it('returns current settings when no updates provided', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{
          id: 'settings-1',
          user_id: 'user-1',
          advisor_mode: 'manual',
          approval_mode: 'manual_review',
          updated_at: '2024-06-01T00:00:00Z',
        }],
      } as never);

      const result = await service.updateSettings('user-1', {});

      expect(result.advisorMode).toBe('manual');
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['user-1'],
      );
    });

    it('throws PlatformError when user settings row not found on update', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] } as never);

      await expect(
        service.updateSettings('nonexistent', { advisorMode: AdvisorMode.Random }),
      ).rejects.toThrow(PlatformError);
    });
  });
});

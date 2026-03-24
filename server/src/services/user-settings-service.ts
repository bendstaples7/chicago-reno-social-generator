import { query } from '../config/database.js';
import { PlatformError } from '../errors/index.js';
import { AdvisorMode } from 'shared';
import type { UserSettings, ApprovalMode } from 'shared';

const VALID_ADVISOR_MODES = Object.values(AdvisorMode) as string[];

export class UserSettingsService {
  /**
   * Retrieve user settings from the user_settings table.
   * Returns a UserSettings object mapped from snake_case DB columns.
   */
  async getSettings(userId: string): Promise<UserSettings> {
    const result = await query(
      `SELECT id, user_id, advisor_mode, approval_mode, updated_at
       FROM user_settings
       WHERE user_id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      throw new PlatformError({
        severity: 'error',
        component: 'UserSettingsService',
        operation: 'getSettings',
        description: 'User settings not found. Please log in again to initialize your settings.',
        recommendedActions: ['Log out and log back in to create default settings'],
      });
    }

    const row = result.rows[0];
    return {
      id: row.id as string,
      userId: row.user_id as string,
      advisorMode: row.advisor_mode as AdvisorMode,
      approvalMode: row.approval_mode as ApprovalMode,
      updatedAt: new Date(row.updated_at as string),
    };
  }

  /**
   * Update advisor_mode and/or approval_mode for a user.
   * Blocks auto_publish mode in v1 and validates advisor_mode values.
   */
  async updateSettings(
    userId: string,
    updates: { advisorMode?: AdvisorMode; approvalMode?: ApprovalMode },
  ): Promise<UserSettings> {
    if (updates.approvalMode === 'auto_publish') {
      throw new PlatformError({
        severity: 'error',
        component: 'UserSettingsService',
        operation: 'updateSettings',
        description: 'Auto-publish mode is not available in v1. All posts require manual review before publishing.',
        recommendedActions: ['Keep the approval mode set to manual review'],
      });
    }

    if (updates.advisorMode && !VALID_ADVISOR_MODES.includes(updates.advisorMode)) {
      throw new PlatformError({
        severity: 'error',
        component: 'UserSettingsService',
        operation: 'updateSettings',
        description: `Invalid advisor mode: "${updates.advisorMode}". Valid modes are: ${VALID_ADVISOR_MODES.join(', ')}.`,
        recommendedActions: ['Select a valid advisor mode: smart, random, or manual'],
      });
    }

    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (updates.advisorMode !== undefined) {
      setClauses.push(`advisor_mode = $${paramIndex++}`);
      params.push(updates.advisorMode);
    }

    if (updates.approvalMode !== undefined) {
      setClauses.push(`approval_mode = $${paramIndex++}`);
      params.push(updates.approvalMode);
    }

    if (setClauses.length === 0) {
      return this.getSettings(userId);
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(userId);

    const result = await query(
      `UPDATE user_settings
       SET ${setClauses.join(', ')}
       WHERE user_id = $${paramIndex}
       RETURNING id, user_id, advisor_mode, approval_mode, updated_at`,
      params,
    );

    if (result.rows.length === 0) {
      throw new PlatformError({
        severity: 'error',
        component: 'UserSettingsService',
        operation: 'updateSettings',
        description: 'User settings not found. Please log in again to initialize your settings.',
        recommendedActions: ['Log out and log back in to create default settings'],
      });
    }

    const row = result.rows[0];
    return {
      id: row.id as string,
      userId: row.user_id as string,
      advisorMode: row.advisor_mode as AdvisorMode,
      approvalMode: row.approval_mode as ApprovalMode,
      updatedAt: new Date(row.updated_at as string),
    };
  }
}

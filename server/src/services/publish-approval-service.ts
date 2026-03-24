import { query } from '../config/database.js';
import { PlatformError } from '../errors/index.js';
import type { ApprovalMode, PostStatus } from 'shared';

export class PublishApprovalService {
  /**
   * Get the current approval mode for a user.
   * Always returns 'manual_review' in v1.
   */
  async getMode(_userId: string): Promise<ApprovalMode> {
    return 'manual_review';
  }

  /**
   * Approve a post for publishing.
   * The post must be in 'awaiting_approval' status.
   */
  async approve(postId: string, userId: string): Promise<void> {
    const result = await query(
      `SELECT id, status FROM posts WHERE id = $1 AND user_id = $2`,
      [postId, userId],
    );

    if (result.rows.length === 0) {
      throw new PlatformError({
        severity: 'error',
        component: 'PublishApprovalService',
        operation: 'approve',
        description: 'The post was not found or you do not have permission to approve it.',
        recommendedActions: ['Verify the post exists in your dashboard'],
      });
    }

    const currentStatus = result.rows[0].status as PostStatus;

    if (currentStatus !== 'awaiting_approval') {
      throw new PlatformError({
        severity: 'error',
        component: 'PublishApprovalService',
        operation: 'approve',
        description: `Cannot approve a post with status '${currentStatus}'. Only posts in 'awaiting_approval' status can be approved.`,
        recommendedActions: ['Submit the post for review before approving it'],
      });
    }

    await query(
      `UPDATE posts SET status = 'approved', updated_at = NOW() WHERE id = $1 AND user_id = $2`,
      [postId, userId],
    );
  }

  /**
   * Check if a post is approved for publishing.
   */
  async isApproved(postId: string): Promise<boolean> {
    const result = await query(
      `SELECT status FROM posts WHERE id = $1`,
      [postId],
    );

    if (result.rows.length === 0) {
      return false;
    }

    return (result.rows[0].status as PostStatus) === 'approved';
  }
}

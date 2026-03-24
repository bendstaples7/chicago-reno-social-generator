import { PlatformError } from '../errors/index.js';
import type { ApprovalMode, PostStatus } from 'shared';

export class PublishApprovalService {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async getMode(_userId: string): Promise<ApprovalMode> {
    return 'manual_review';
  }

  async approve(postId: string, userId: string): Promise<void> {
    // Atomic: only approve if currently awaiting_approval
    const result = await this.db.prepare(
      "UPDATE posts SET status = 'approved', updated_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'awaiting_approval'"
    ).bind(postId, userId).run();

    if ((result.meta?.changes ?? 0) === 0) {
      // Check if post exists to give a better error message
      const row = await this.db.prepare(
        'SELECT id, status FROM posts WHERE id = ? AND user_id = ?'
      ).bind(postId, userId).first() as any;

      if (!row) {
        throw new PlatformError({
          severity: 'error',
          component: 'PublishApprovalService',
          operation: 'approve',
          description: 'The post was not found or you do not have permission to approve it.',
          recommendedActions: ['Verify the post exists in your dashboard'],
        });
      }

      throw new PlatformError({
        severity: 'error',
        component: 'PublishApprovalService',
        operation: 'approve',
        description: 'Cannot approve a post with status \'' + (row.status as string) + '\'. Only posts in \'awaiting_approval\' status can be approved.',
        recommendedActions: ['Submit the post for review before approving it'],
      });
    }
  }

  async isApproved(postId: string): Promise<boolean> {
    const row = await this.db.prepare(
      'SELECT status FROM posts WHERE id = ?'
    ).bind(postId).first() as any;

    if (!row) return false;
    return (row.status as PostStatus) === 'approved';
  }

  /**
   * Atomically transition a post from 'approved' to 'publishing'.
   * Returns true if the transition succeeded, false if the post was not in 'approved' status.
   */
  async markPublishingIfApproved(postId: string, userId: string): Promise<boolean> {
    const result = await this.db.prepare(
      "UPDATE posts SET status = 'publishing', updated_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'approved'"
    ).bind(postId, userId).run();

    return (result.meta?.changes ?? 0) > 0;
  }
}

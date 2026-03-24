import { Router } from 'express';
import { sessionMiddleware } from '../middleware/session.js';
import { ActivityLogService } from '../services/index.js';

const router = Router();
const activityLogService = new ActivityLogService();

/**
 * GET /activity-log
 * Returns paginated activity log entries for the authenticated user.
 */
router.get('/', sessionMiddleware, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));

    const entries = await activityLogService.getEntries(userId, { page, limit });
    res.json({ entries, page, limit });
  } catch (err) {
    next(err);
  }
});

export default router;

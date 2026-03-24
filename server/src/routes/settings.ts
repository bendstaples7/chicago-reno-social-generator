import { Router } from 'express';
import { sessionMiddleware } from '../middleware/session.js';
import { ContentAdvisor, UserSettingsService } from '../services/index.js';
import type { AdvisorMode, ApprovalMode } from 'shared';

const router = Router();
const contentAdvisor = new ContentAdvisor();
const userSettingsService = new UserSettingsService();

/**
 * GET /content-advisor/suggest
 * Returns a content type suggestion based on the user's current advisor mode.
 * Returns null if the user is in Manual mode.
 */
router.get('/content-advisor/suggest', sessionMiddleware, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const settings = await userSettingsService.getSettings(userId);
    const suggestion = await contentAdvisor.suggest(userId, settings.advisorMode);
    res.json({ suggestion });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /settings
 * Returns the authenticated user's settings.
 */
router.get('/settings', sessionMiddleware, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const settings = await userSettingsService.getSettings(userId);
    res.json({ settings });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /settings
 * Updates the authenticated user's advisor mode and/or approval mode.
 */
router.put('/settings', sessionMiddleware, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { advisorMode, approvalMode } = req.body as {
      advisorMode?: AdvisorMode;
      approvalMode?: ApprovalMode;
    };
    const settings = await userSettingsService.updateSettings(userId, { advisorMode, approvalMode });
    res.json({ settings });
  } catch (err) {
    next(err);
  }
});

export default router;

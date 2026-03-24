import { Router } from 'express';
import { ContentIdeasService } from '../services/content-ideas-service.js';
import { sessionMiddleware } from '../middleware/session.js';
import { PlatformError } from '../errors/index.js';
import type { ContentType } from 'shared';

const router = Router();
const service = new ContentIdeasService();

router.use(sessionMiddleware);

/** GET /content-ideas?contentType=education — get unused ideas */
router.get('/', async (req, res, next) => {
  try {
    const contentType = req.query.contentType as string;
    if (!contentType) {
      throw new PlatformError({
        severity: 'warning',
        component: 'ContentIdeas',
        operation: 'list',
        description: 'contentType query parameter is required.',
        recommendedActions: ['Provide a contentType'],
      });
    }
    const ideas = await service.getUnused(req.user!.id, contentType as ContentType);
    res.json({ ideas });
  } catch (err) {
    next(err);
  }
});

/** POST /content-ideas/generate — generate a new batch */
router.post('/generate', async (req, res, next) => {
  try {
    const { contentType } = req.body as { contentType?: string };
    if (!contentType) {
      throw new PlatformError({
        severity: 'warning',
        component: 'ContentIdeas',
        operation: 'generate',
        description: 'contentType is required in the request body.',
        recommendedActions: ['Provide a contentType'],
      });
    }
    const ideas = await service.generateBatch(req.user!.id, contentType as ContentType);
    res.json({ ideas });
  } catch (err) {
    next(err);
  }
});

/** POST /content-ideas/:id/use — mark an idea as used */
router.post('/:id/use', async (req, res, next) => {
  try {
    const idea = await service.markUsed(req.params.id, req.user!.id);
    if (!idea) {
      throw new PlatformError({
        severity: 'warning',
        component: 'ContentIdeas',
        operation: 'markUsed',
        description: 'Idea not found.',
        recommendedActions: ['Check the idea ID'],
      });
    }
    res.json({ idea });
  } catch (err) {
    next(err);
  }
});

/** DELETE /content-ideas/:id — dismiss/delete an idea */
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await service.deleteIdea(req.params.id, req.user!.id);
    if (!deleted) {
      throw new PlatformError({
        severity: 'warning',
        component: 'ContentIdeas',
        operation: 'delete',
        description: 'Idea not found.',
        recommendedActions: ['Check the idea ID'],
      });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;

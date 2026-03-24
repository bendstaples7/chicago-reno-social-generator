import { Router } from 'express';
import { MediaService } from '../services/media-service.js';
import { ImageGenerator } from '../services/image-generator.js';
import { sessionMiddleware } from '../middleware/session.js';
import { PlatformError } from '../errors/index.js';
import type { ImageGenerationRequest, GeneratedImage } from 'shared';

const router = Router();
const mediaService = new MediaService();
const imageGenerator = new ImageGenerator();

// All media routes require authentication
router.use(sessionMiddleware);

/**
 * GET /media
 * List media library for the authenticated user.
 */
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const items = await mediaService.list(req.user!.id, { page, limit });
    res.json({ items, page, limit });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /media/upload
 * Upload a media file (expects raw body with Content-Type header).
 * In production this would use multer or similar; here we read the raw buffer.
 */
router.post('/upload', async (req, res, next) => {
  try {
    const contentType = req.headers['content-type'] || '';
    const filename = (req.headers['x-filename'] as string) || 'upload';
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const buffer = Buffer.concat(chunks);

    const item = await mediaService.upload(
      {
        originalname: filename,
        mimetype: contentType.split(';')[0].trim(),
        size: buffer.length,
        buffer,
      },
      req.user!.id,
    );

    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /media/generate
 * Generate AI images from a text description.
 * If 'topic' is provided instead of 'description', first converts the topic
 * into a visual scene description via GPT.
 */
router.post('/generate', async (req, res, next) => {
  try {
    const body = req.body as Partial<ImageGenerationRequest> & { topic?: string };

    let description = (body.description || '').trim();

    // If a topic is provided, convert it to a visual scene description first
    if (body.topic && body.topic.trim().length > 0) {
      description = await imageGenerator.describeScene(body.topic.trim());
    }

    if (!description || description.length === 0) {
      throw new PlatformError({
        severity: 'warning',
        component: 'ImageGenerator',
        operation: 'generate',
        description: 'A text description or topic is required to generate images.',
        recommendedActions: ['Provide a description or topic'],
      });
    }

    const images = await imageGenerator.generate({
      description,
      style: body.style,
      count: body.count,
    });

    res.json({ images });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /media/temp/save-generated
 * Save an AI-generated image to the media library.
 * Expects a GeneratedImage payload in the request body.
 */
router.post('/temp/save-generated', async (req, res, next) => {
  try {
    const body = req.body as Partial<GeneratedImage>;

    if (!body.url || !body.format || !body.width || !body.height || !body.description) {
      throw new PlatformError({
        severity: 'warning',
        component: 'MediaService',
        operation: 'storeGenerated',
        description: 'Missing required fields for saving the generated image.',
        recommendedActions: ['Provide url, format, width, height, and description'],
      });
    }

    const item = await mediaService.storeGenerated(body as GeneratedImage, req.user!.id);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /media/:id
 * Delete a media item from the library.
 */
router.delete('/:id', async (req, res, next) => {
  try {
    await mediaService.delete(req.params.id, req.user!.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;

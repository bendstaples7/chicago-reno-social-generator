import { Hono } from 'hono';
import type { Bindings } from '../bindings.js';
import type { User, ImageGenerationRequest, GeneratedImage } from 'shared';
import { sessionMiddleware } from '../middleware/session.js';
import { MediaService } from '../services/media-service.js';
import { ImageGenerator } from '../services/image-generator.js';
import { PlatformError } from '../errors/index.js';

const app = new Hono<{ Bindings: Bindings; Variables: { user: User } }>();

app.use('*', sessionMiddleware);

/**
 * GET /
 * List media library for the authenticated user.
 */
app.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20', 10) || 20));
  const mediaService = new MediaService(c.env.DB, c.env.R2_BUCKET);
  const items = await mediaService.list(c.get('user').id, { page, limit });
  return c.json({ items, page, limit });
});

/**
 * POST /upload
 * Upload a media file (expects raw body with Content-Type header).
 */
app.post('/upload', async (c) => {
  const contentType = c.req.header('Content-Type') || '';
  const filename = c.req.header('X-Filename') || 'upload';
  const buffer = await c.req.arrayBuffer();

  const mediaService = new MediaService(c.env.DB, c.env.R2_BUCKET);
  const item = await mediaService.upload(
    {
      originalname: filename,
      mimetype: contentType.split(';')[0].trim(),
      size: buffer.byteLength,
      buffer,
    },
    c.get('user').id,
  );

  return c.json(item, 201);
});

/**
 * POST /generate
 * Enqueue an image generation job to the Cloudflare Queue.
 * Returns a jobId for polling.
 */
app.post('/generate', async (c) => {
  const body = await c.req.json() as Partial<ImageGenerationRequest> & { topic?: string };
  const userId = c.get('user').id;

  let description = (body.description || '').trim();

  // If a topic is provided, convert it to a visual scene description first
  if (body.topic && body.topic.trim().length > 0) {
    const imageGenerator = new ImageGenerator(c.env.AI_TEXT_API_KEY);
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

  const jobId = crypto.randomUUID();
  const sanitizedCount = Math.min(4, Math.max(1, Math.floor(Number(body.count) || 1)));

  // Create job record in D1
  await c.env.DB.prepare(
    'INSERT INTO image_generation_jobs (id, user_id, status, description, style, count, topic) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(jobId, userId, 'queued', description, body.style || null, sanitizedCount, body.topic || null).run();

  // Enqueue the job — clean up DB row on failure
  try {
    await c.env.IMAGE_QUEUE.send({
      jobId,
      userId,
      request: {
        description,
        style: body.style,
        count: sanitizedCount,
      },
    });
  } catch (err) {
    await c.env.DB.prepare(
      "UPDATE image_generation_jobs SET status = 'failed', error = 'Failed to enqueue job', updated_at = datetime('now') WHERE id = ?"
    ).bind(jobId).run();
    throw err;
  }

  return c.json({ jobId });
});

/**
 * GET /generate-status/:jobId
 * Poll for image generation job status.
 */
app.get('/generate-status/:jobId', async (c) => {
  const jobId = c.req.param('jobId');
  const userId = c.get('user').id;

  const row = await c.env.DB.prepare(
    'SELECT id, user_id, status, description, style, result_media_id, error, created_at, updated_at FROM image_generation_jobs WHERE id = ? AND user_id = ?'
  ).bind(jobId, userId).first() as any;

  if (!row) {
    throw new PlatformError({
      severity: 'error',
      component: 'ImageGenerator',
      operation: 'generateStatus',
      description: 'Image generation job not found.',
      recommendedActions: ['Check the job ID'],
    });
  }

  const result: Record<string, unknown> = {
    jobId: row.id,
    status: row.status,
    description: row.description,
    error: row.error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  // If completed, include the resulting media item
  if (row.status === 'completed' && row.result_media_id) {
    const mediaService = new MediaService(c.env.DB, c.env.R2_BUCKET);
    const mediaItem = await mediaService.getById(row.result_media_id, userId);
    if (mediaItem) {
      result.mediaItem = mediaItem;
    }
  }

  return c.json(result);
});

/**
 * POST /temp/save-generated
 * Save an AI-generated image to the media library.
 */
app.post('/temp/save-generated', async (c) => {
  const body = await c.req.json() as Partial<GeneratedImage>;

  if (!body.url || !body.format || !body.width || !body.height || !body.description) {
    throw new PlatformError({
      severity: 'warning',
      component: 'MediaService',
      operation: 'storeGenerated',
      description: 'Missing required fields for saving the generated image.',
      recommendedActions: ['Provide url, format, width, height, and description'],
    });
  }

  const mediaService = new MediaService(c.env.DB, c.env.R2_BUCKET);
  const item = await mediaService.storeGenerated(body as GeneratedImage, c.get('user').id);
  return c.json(item, 201);
});

/**
 * DELETE /:id
 * Delete a media item from the library.
 */
app.delete('/:id', async (c) => {
  const mediaService = new MediaService(c.env.DB, c.env.R2_BUCKET);
  await mediaService.delete(c.req.param('id'), c.get('user').id);
  return c.json({ success: true });
});

export default app;

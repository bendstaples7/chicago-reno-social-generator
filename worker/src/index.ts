import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Bindings } from './bindings.js';
import { errorHandler } from './middleware/error-handler.js';
import { handleImageQueue } from './queue/image-consumer.js';
import type { ImageJobMessage } from './queue/image-consumer.js';
import authRoutes from './routes/auth.js';
import mediaRoutes from './routes/media.js';
import postRoutes from './routes/posts.js';
import channelRoutes from './routes/channels.js';
import contentRoutes from './routes/content.js';
import settingsRoutes from './routes/settings.js';
import activityLogRoutes from './routes/activity-log.js';
import contentIdeasRoutes from './routes/content-ideas.js';

const app = new Hono<{ Bindings: Bindings }>();

// Default 10 MB body size limit for non-upload routes
app.use('*', bodyLimit({ maxSize: 10 * 1024 * 1024 }));

// Override with 50 MB limit for media upload endpoints
app.use('/api/media/*', bodyLimit({ maxSize: 50 * 1024 * 1024 }));

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// API routes
app.route('/api/auth', authRoutes);
app.route('/api/media', mediaRoutes);
app.route('/api/posts', postRoutes);
app.route('/api/channels', channelRoutes);
app.route('/api', contentRoutes);
app.route('/api', settingsRoutes);
app.route('/api/activity-log', activityLogRoutes);
app.route('/api/content-ideas', contentIdeasRoutes);

// Error handler (must be registered after routes)
app.onError(errorHandler);

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<ImageJobMessage>, env: Bindings): Promise<void> {
    await handleImageQueue(batch, env);
  },
};

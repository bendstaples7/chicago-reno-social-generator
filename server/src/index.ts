import './env.js';
import express from 'express';
import { errorHandler, setActivityLogService } from './middleware/error-handler.js';
import { ActivityLogService } from './services/index.js';
import authRoutes from './routes/auth.js';
import mediaRoutes from './routes/media.js';
import contentRoutes from './routes/content.js';
import settingsRoutes from './routes/settings.js';
import postRoutes from './routes/posts.js';
import channelRoutes from './routes/channels.js';
import activityLogRoutes from './routes/activity-log.js';
import contentIdeasRoutes from './routes/content-ideas.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3001;

// Create singleton ActivityLogService and wire into error middleware
const activityLogService = new ActivityLogService();
setActivityLogService(activityLogService);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api', contentRoutes);
app.use('/api', settingsRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/activity-log', activityLogRoutes);
app.use('/api/content-ideas', contentIdeasRoutes);

// Error-handling middleware must be registered AFTER all routes
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;

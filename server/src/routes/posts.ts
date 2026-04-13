import { Router } from 'express';
import {
  PostService,
  PublishApprovalService,
  InstagramChannel,
  ActivityLogService,
  CrossPoster,
  ContentAdvisor,
  MediaService,
  UserSettingsService,
} from '../services/index.js';
import { sessionMiddleware } from '../middleware/session.js';
import type { PostStatus } from 'shared';

const router = Router();
const postService = new PostService();
const approvalService = new PublishApprovalService();
const instagramChannel = new InstagramChannel();
const activityLog = new ActivityLogService();
const crossPoster = new CrossPoster({ postService, approvalService, channel: instagramChannel, activityLog });
const contentAdvisor = new ContentAdvisor();
const mediaService = new MediaService();
const userSettingsService = new UserSettingsService();

// All post routes require authentication
router.use(sessionMiddleware);

/**
 * GET /posts
 * List posts for the authenticated user with optional status filter.
 */
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const status = req.query.status as PostStatus | undefined;
    const posts = await postService.list(req.user!.id, { page, limit }, status);
    res.json({ posts, page, limit });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /posts/:id
 * Get a single post by ID.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const post = await postService.getById(req.params.id, req.user!.id);
    res.json(post);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /posts/quick-start
 * Initialize the quick-post workflow. Returns content advisor suggestion,
 * media thumbnails, and smart defaults in a single response.
 * Also triggers a non-blocking Instagram sync so the advisor has fresh data.
 */
router.post('/quick-start', async (req, res, next) => {
  try {
    const userId = req.user!.id;

    // Fire-and-forget Instagram sync so the advisor has up-to-date post history
    // on subsequent visits. The sync won't complete before this response returns,
    // but new posts will be available next time. Rate-limited to once per 5 minutes.
    import('../services/instagram-sync-service.js')
      .then(({ InstagramSyncService }) => new InstagramSyncService().syncRecentPosts(userId))
      .catch((err) => {
        // Don't log expected warnings (e.g., no Instagram account connected) as errors
        if (err && err.severity === 'warning') return;
        console.error('[InstagramSync] Background sync failed for user %s:', userId, err);
      });

    // Fetch user settings to determine advisor mode
    const settings = await userSettingsService.getSettings(userId);

    // Run advisor suggestion and media list in parallel
    const [suggestion, mediaThumbnails] = await Promise.all([
      contentAdvisor.suggest(userId, settings.advisorMode),
      mediaService.list(userId, { page: 1, limit: 20 }),
    ]);

    // Get Instagram constraints for smart defaults
    const constraints = instagramChannel.getConstraints();

    // Pre-select content type: use advisor suggestion if available, otherwise null
    const preSelectedContentType = suggestion?.contentType ?? null;

    res.json({
      suggestion,
      mediaThumbnails,
      defaults: {
        contentType: preSelectedContentType,
        hashtagCount: constraints.maxHashtags,
        instagramFormat: {
          recommendedDimensions: constraints.recommendedDimensions,
          maxCaptionLength: constraints.maxCaptionLength,
          maxCarouselImages: constraints.maxCarouselImages,
          maxReelDuration: constraints.maxReelDuration,
          supportedMediaTypes: constraints.supportedMediaTypes,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /posts
 * Create a new post.
 */
router.post('/', async (req, res, next) => {
  try {
    const { channelConnectionId, contentType, caption, hashtags, templateFields, mediaItemIds } = req.body;
    const post = await postService.create({
      userId: req.user!.id,
      channelConnectionId: channelConnectionId || null,
      contentType,
      caption,
      hashtags,
      templateFields,
      mediaItemIds,
    });
    res.status(201).json(post);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /posts/:id
 * Update an existing post.
 */
router.put('/:id', async (req, res, next) => {
  try {
    const { caption, hashtags, contentType, channelConnectionId, templateFields, mediaItemIds } = req.body;
    const post = await postService.update(req.params.id, req.user!.id, {
      caption,
      hashtags,
      contentType,
      channelConnectionId,
      templateFields,
      mediaItemIds,
    });
    res.json(post);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /posts/:id/approve
 * Approve a post for publishing. Transitions draft → awaiting_approval first if needed.
 */
router.post('/:id/approve', async (req, res, next) => {
  try {
    const postId = req.params.id;
    const userId = req.user!.id;

    // If the post is still a draft, transition to awaiting_approval first
    const post = await postService.getById(postId, userId);
    if (post.status === 'draft') {
      await postService.transitionStatus(postId, userId, 'awaiting_approval');
    }

    await approvalService.approve(postId, userId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /posts/:id/publish
 * Publish a post to its target channel.
 */
router.post('/:id/publish', async (req, res, next) => {
  try {
    const result = await crossPoster.publish(req.params.id, req.user!.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /posts/:id/preview
 * Get a formatted preview of how the post will appear on Instagram.
 */
router.get('/:id/preview', async (req, res, next) => {
  try {
    const post = await postService.getById(req.params.id, req.user!.id);
    const formatted = await instagramChannel.formatPost(post);
    res.json(formatted);
  } catch (err) {
    next(err);
  }
});

export default router;

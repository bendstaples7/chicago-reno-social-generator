import { Hono } from 'hono';
import type { Bindings } from '../bindings.js';
import type { User, ContentGeneratorInput, HolidayEntry } from 'shared';
import { ContentType } from 'shared';
import { sessionMiddleware } from '../middleware/session.js';
import { ContentGenerator, getAllTemplates } from '../services/index.js';
import { PlatformError } from '../errors/index.js';

const app = new Hono<{ Bindings: Bindings; Variables: { user: User } }>();

/**
 * GET /content-types
 * Returns all available content types with their template definitions.
 * Public endpoint (no auth required).
 */
app.get('/content-types', (c) => {
  const templates = getAllTemplates();
  return c.json({ contentTypes: templates });
});

/**
 * GET /holidays
 * Returns upcoming holidays and seasonal events.
 */
app.get('/holidays', (c) => {
  const holidays = getUpcomingHolidays();
  return c.json({ holidays });
});

/**
 * POST /posts/:id/generate-content
 * Generate caption and hashtags for an existing post.
 */
app.post('/posts/:id/generate-content', sessionMiddleware, async (c) => {
  const postId = c.req.param('id');
  const userId = c.get('user').id;
  const db = c.env.DB;

  // Fetch the post
  const post = await db.prepare(
    'SELECT id, content_type, caption, template_fields FROM posts WHERE id = ? AND user_id = ?'
  ).bind(postId, userId).first() as any;

  if (!post) {
    throw new PlatformError({
      severity: 'error',
      component: 'ContentGenerator',
      operation: 'generate',
      description: 'The post was not found or you do not have permission to access it.',
      recommendedActions: ['Verify the post exists on your dashboard'],
    });
  }

  const contentType = post.content_type as ContentType;

  // Fetch media attached to this post
  const mediaResult = await db.prepare(
    'SELECT mi.id, mi.user_id, mi.filename, mi.mime_type, mi.file_size_bytes, mi.storage_key, mi.thumbnail_url, mi.source, mi.ai_description, mi.width, mi.height, mi.created_at FROM media_items mi JOIN post_media pm ON pm.media_item_id = mi.id WHERE pm.post_id = ? ORDER BY pm.display_order'
  ).bind(postId).all();

  const media = (mediaResult.results as any[]).map((row) => ({
    id: row.id as string,
    userId: row.user_id as string,
    filename: row.filename as string,
    mimeType: row.mime_type as string,
    fileSizeBytes: row.file_size_bytes as number,
    storageKey: row.storage_key as string,
    thumbnailUrl: row.thumbnail_url as string,
    source: row.source as 'uploaded' | 'ai_generated',
    aiDescription: (row.ai_description as string) ?? undefined,
    width: (row.width as number) ?? 0,
    height: (row.height as number) ?? 0,
    createdAt: new Date(row.created_at as string),
  }));

  // Build generator input
  const body = await c.req.json().catch(() => ({})) as Partial<{ context: string; templateFields: Record<string, string> }>;
  const templateFields = body.templateFields
    ?? (post.template_fields ? (typeof post.template_fields === 'string' ? JSON.parse(post.template_fields) : post.template_fields) : {});

  const input: ContentGeneratorInput = {
    contentType,
    media,
    context: body.context,
    templateFields,
  };

  const contentGenerator = new ContentGenerator(c.env.AI_TEXT_API_KEY, c.env.AI_TEXT_API_URL);
  const generated = await contentGenerator.generate(input);

  // Update the post with generated content
  await db.prepare(
    "UPDATE posts SET caption = ?, hashtags_json = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(generated.caption, JSON.stringify(generated.hashtags), postId).run();

  return c.json(generated);
});

export default app;

// ── Holidays helper ──────────────────────────────────────────

function getUpcomingHolidays(): HolidayEntry[] {
  const now = new Date();
  const year = now.getFullYear();

  const holidays: HolidayEntry[] = [
    { name: "New Year's Day", date: year + '-01-01', renovationTieIn: 'New year, new home — start fresh with a renovation plan' },
    { name: "Valentine's Day", date: year + '-02-14', renovationTieIn: 'Show your home some love with a kitchen or bath refresh' },
    { name: 'Spring Equinox', date: year + '-03-20', renovationTieIn: 'Spring cleaning season — time for a home refresh' },
    { name: 'Earth Day', date: year + '-04-22', renovationTieIn: 'Eco-friendly renovation materials and sustainable upgrades' },
    { name: 'Memorial Day', date: year + '-05-27', renovationTieIn: 'Kick off summer with outdoor living space upgrades' },
    { name: 'Summer Solstice', date: year + '-06-21', renovationTieIn: 'Longest day of the year — perfect for outdoor renovation projects' },
    { name: 'Independence Day', date: year + '-07-04', renovationTieIn: 'Red, white, and new — celebrate with a home makeover' },
    { name: 'Labor Day', date: year + '-09-01', renovationTieIn: 'End of summer — prep your home for fall with interior updates' },
    { name: 'Fall Equinox', date: year + '-09-22', renovationTieIn: 'Fall is prime renovation season — cozy up your space' },
    { name: 'Halloween', date: year + '-10-31', renovationTieIn: 'Spooky good deals on renovation projects this season' },
    { name: 'Thanksgiving', date: year + '-11-27', renovationTieIn: 'Get your kitchen and dining room guest-ready' },
    { name: 'Christmas', date: year + '-12-25', renovationTieIn: 'Gift yourself a home renovation this holiday season' },
  ];

  // Return holidays from today onward, wrapping to next year if needed
  const upcoming = holidays.filter((h) => new Date(h.date) >= now);
  if (upcoming.length >= 4) return upcoming;

  // Add next year's early holidays to fill the list
  const nextYear = holidays
    .slice(0, 4)
    .map((h) => ({ ...h, date: h.date.replace(String(year), String(year + 1)) }));
  return [...upcoming, ...nextYear];
}

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

  // Fetch media attached to this post (scoped to post owner)
  const mediaResult = await db.prepare(
    'SELECT mi.id, mi.user_id, mi.filename, mi.mime_type, mi.file_size_bytes, mi.storage_key, mi.thumbnail_url, mi.source, mi.ai_description, mi.width, mi.height, mi.created_at FROM media_items mi JOIN post_media pm ON pm.media_item_id = mi.id WHERE pm.post_id = ? AND mi.user_id = ? ORDER BY pm.display_order'
  ).bind(postId, userId).all();

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
  let templateFields: Record<string, string> = {};
  if (body.templateFields) {
    templateFields = body.templateFields;
  } else if (post.template_fields) {
    try {
      templateFields = typeof post.template_fields === 'string'
        ? JSON.parse(post.template_fields)
        : post.template_fields;
    } catch {
      // Malformed stored JSON — fall back to empty object
      templateFields = {};
    }
  }

  const input: ContentGeneratorInput = {
    contentType,
    media,
    context: body.context,
    templateFields,
  };

  const contentGenerator = new ContentGenerator(c.env.AI_TEXT_API_KEY, c.env.AI_TEXT_API_URL);
  const generated = await contentGenerator.generate(input);

  // Update the post with generated content (scoped to user)
  await db.prepare(
    "UPDATE posts SET caption = ?, hashtags_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
  ).bind(generated.caption, JSON.stringify(generated.hashtags), postId, userId).run();

  return c.json(generated);
});

export default app;

// ── Holidays helper ──────────────────────────────────────────

function getUpcomingHolidays(): HolidayEntry[] {
  const now = new Date();
  const year = now.getFullYear();
  const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD for date-only comparison

  const holidays: HolidayEntry[] = [
    { name: "New Year's Day", date: year + '-01-01', renovationTieIn: 'New year, new home — start fresh with a renovation plan' },
    { name: "Valentine's Day", date: year + '-02-14', renovationTieIn: 'Show your home some love with a kitchen or bath refresh' },
    { name: 'Spring Equinox', date: year + '-03-20', renovationTieIn: 'Spring cleaning season — time for a home refresh' },
    { name: 'Earth Day', date: year + '-04-22', renovationTieIn: 'Eco-friendly renovation materials and sustainable upgrades' },
    { name: 'Memorial Day', date: getMemorialDay(year), renovationTieIn: 'Kick off summer with outdoor living space upgrades' },
    { name: 'Summer Solstice', date: year + '-06-21', renovationTieIn: 'Longest day of the year — perfect for outdoor renovation projects' },
    { name: 'Independence Day', date: year + '-07-04', renovationTieIn: 'Red, white, and new — celebrate with a home makeover' },
    { name: 'Labor Day', date: getLaborDay(year), renovationTieIn: 'End of summer — prep your home for fall with interior updates' },
    { name: 'Fall Equinox', date: year + '-09-22', renovationTieIn: 'Fall is prime renovation season — cozy up your space' },
    { name: 'Halloween', date: year + '-10-31', renovationTieIn: 'Spooky good deals on renovation projects this season' },
    { name: 'Thanksgiving', date: getThanksgiving(year), renovationTieIn: 'Get your kitchen and dining room guest-ready' },
    { name: 'Christmas', date: year + '-12-25', renovationTieIn: 'Gift yourself a home renovation this holiday season' },
  ];

  // Return holidays from today onward (date-only comparison so today's holidays are included)
  const upcoming = holidays.filter((h) => h.date >= todayStr);
  if (upcoming.length >= 4) return upcoming;

  // Add next year's early holidays to fill the list
  const nextYear = year + 1;
  const nextYearHolidays: HolidayEntry[] = [
    { name: "New Year's Day", date: nextYear + '-01-01', renovationTieIn: 'New year, new home — start fresh with a renovation plan' },
    { name: "Valentine's Day", date: nextYear + '-02-14', renovationTieIn: 'Show your home some love with a kitchen or bath refresh' },
    { name: 'Spring Equinox', date: nextYear + '-03-20', renovationTieIn: 'Spring cleaning season — time for a home refresh' },
    { name: 'Earth Day', date: nextYear + '-04-22', renovationTieIn: 'Eco-friendly renovation materials and sustainable upgrades' },
  ];
  return [...upcoming, ...nextYearHolidays];
}

/** Memorial Day: last Monday of May */
function getMemorialDay(year: number): string {
  const d = new Date(year, 4, 31); // May 31
  while (d.getDay() !== 1) d.setDate(d.getDate() - 1);
  return year + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Labor Day: first Monday of September */
function getLaborDay(year: number): string {
  const d = new Date(year, 8, 1); // Sep 1
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return year + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Thanksgiving: fourth Thursday of November */
function getThanksgiving(year: number): string {
  const d = new Date(year, 10, 1); // Nov 1
  while (d.getDay() !== 4) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + 21); // 4th Thursday
  return year + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

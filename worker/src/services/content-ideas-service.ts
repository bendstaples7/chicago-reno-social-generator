import { PlatformError } from '../errors/index.js';
import type { ContentIdea, ContentType } from 'shared';

const BATCH_SIZE = 10;
const GENERATION_TIMEOUT_MS = 30_000;

const CONTENT_TYPE_LABELS: Record<string, string> = {
  education: 'Educational content about renovation topics, materials, techniques, or home improvement advice',
  testimonial: 'Customer reviews, testimonials, and success stories about renovation projects',
  personal_brand: 'Team member spotlights, behind-the-scenes, and company culture content',
  seasonal_event: 'Content tied to seasons, holidays, or timely events related to home renovation',
  before_after: 'Project transformation showcases with before and after photos of renovation work',
};

export class ContentIdeasService {
  private readonly db: D1Database;
  private readonly apiKey: string;
  private readonly apiUrl: string;

  constructor(db: D1Database, apiKey: string, apiUrl: string) {
    this.db = db;
    this.apiKey = apiKey;
    this.apiUrl = apiUrl || 'https://api.openai.com/v1/chat/completions';
  }

  async getUnused(userId: string, contentType: ContentType): Promise<ContentIdea[]> {
    const result = await this.db.prepare(
      'SELECT id, user_id, content_type, idea, used, created_at FROM content_ideas WHERE user_id = ? AND content_type = ? AND used = 0 ORDER BY created_at DESC'
    ).bind(userId, contentType).all();
    return (result.results as any[]).map((r) => this.mapRow(r));
  }

  async deleteIdea(ideaId: string, userId: string): Promise<boolean> {
    const result = await this.db.prepare(
      'DELETE FROM content_ideas WHERE id = ? AND user_id = ?'
    ).bind(ideaId, userId).run();
    return (result.meta?.changes ?? 0) > 0;
  }

  async markUsed(ideaId: string, userId: string): Promise<ContentIdea | null> {
    const result = await this.db.prepare(
      'UPDATE content_ideas SET used = 1 WHERE id = ? AND user_id = ?'
    ).bind(ideaId, userId).run();

    if ((result.meta?.changes ?? 0) === 0) return null;

    const row = await this.db.prepare(
      'SELECT id, user_id, content_type, idea, used, created_at FROM content_ideas WHERE id = ? AND user_id = ?'
    ).bind(ideaId, userId).first() as any;

    if (!row) return null;
    return this.mapRow(row);
  }

  async generateBatch(userId: string, contentType: ContentType): Promise<ContentIdea[]> {
    if (!this.apiKey) {
      throw new PlatformError({
        severity: 'error',
        component: 'ContentIdeasService',
        operation: 'generateBatch',
        description: 'OpenAI API key is not configured.',
        recommendedActions: ['Set AI_TEXT_API_KEY in your environment'],
      });
    }

    const pastResult = await this.db.prepare(
      'SELECT idea FROM content_ideas WHERE user_id = ? AND content_type = ? ORDER BY created_at DESC LIMIT 100'
    ).bind(userId, contentType).all();
    const pastIdeas = (pastResult.results as any[]).map((r) => r.idea as string);

    const typeLabel = CONTENT_TYPE_LABELS[contentType] || contentType;
    const avoidSection = pastIdeas.length > 0
      ? '\n\nPreviously generated ideas (DO NOT repeat or closely paraphrase any of these):\n' + pastIdeas.map((idea, i) => (i + 1) + '. ' + idea).join('\n')
      : '';

    const now = new Date();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const dateContext = 'Today is ' + monthNames[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear() + '.';

    const systemPrompt = [
      'You generate unique Instagram post ideas for Chicago Reno, a professional home renovation company in Chicago.',
      dateContext,
      'All ideas must be relevant to the CURRENT season and time of year. Do not suggest ideas for past or distant future seasons.',
      'Each idea should be a specific, actionable topic that can be turned into an engaging Instagram post.',
      'Ideas should be concise (1-2 sentences max) and varied in angle and approach.',
      'RESPONSE FORMAT: Return a JSON array of strings. No markdown, no code fences.',
      'Example: ["Idea one here", "Idea two here"]',
    ].join('\n');

    const userPrompt = 'Generate ' + BATCH_SIZE + ' unique Instagram post ideas for the content type: ' + typeLabel + '.' + avoidSection;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.apiKey,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 1.0,
          max_tokens: 1500,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new PlatformError({
          severity: 'error',
          component: 'ContentIdeasService',
          operation: 'generateBatch',
          description: 'OpenAI API error (' + response.status + '): ' + errText,
          recommendedActions: ['Try again'],
        });
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      const raw = data.choices?.[0]?.message?.content?.trim() ?? '[]';
      const ideas = this.parseIdeas(raw).slice(0, BATCH_SIZE);

      const inserted: ContentIdea[] = [];
      for (const idea of ideas) {
        const id = crypto.randomUUID();
        await this.db.prepare(
          'INSERT INTO content_ideas (id, user_id, content_type, idea) VALUES (?, ?, ?, ?)'
        ).bind(id, userId, contentType, idea).run();

        const row = await this.db.prepare(
          'SELECT id, user_id, content_type, idea, used, created_at FROM content_ideas WHERE id = ?'
        ).bind(id).first() as any;
        if (row) inserted.push(this.mapRow(row));
      }
      return inserted;
    } catch (err) {
      if (err instanceof PlatformError) throw err;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      throw new PlatformError({
        severity: 'error',
        component: 'ContentIdeasService',
        operation: 'generateBatch',
        description: isAbort
          ? 'Idea generation timed out.'
          : 'Idea generation failed: ' + (err instanceof Error ? err.message : 'Unknown error'),
        recommendedActions: ['Try again'],
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseIdeas(raw: string): string[] {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      const arr = JSON.parse(cleaned);
      if (Array.isArray(arr)) {
        return arr.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim());
      }
    } catch { /* fall through */ }
    return cleaned.split('\n').map((l) => l.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);
  }

  private mapRow(row: Record<string, unknown>): ContentIdea {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      contentType: row.content_type as ContentType,
      idea: row.idea as string,
      used: row.used === 1 || row.used === true,
      createdAt: new Date(row.created_at as string),
    };
  }
}

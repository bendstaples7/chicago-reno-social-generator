import { query } from '../config/database.js';
import { PlatformError } from '../errors/index.js';
import { CONTENT_TYPE_LABELS } from 'shared';
import type { ContentIdea, ContentType } from 'shared';

const BATCH_SIZE = 10;
const GENERATION_TIMEOUT_MS = 30_000;
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

export class ContentIdeasService {
  /** Get unused ideas for a content type */
  async getUnused(userId: string, contentType: ContentType): Promise<ContentIdea[]> {
    const result = await query(
      'SELECT id, user_id, content_type, idea, used, created_at FROM content_ideas WHERE user_id = $1 AND content_type = $2 AND used = FALSE ORDER BY created_at DESC',
      [userId, contentType],
    );
    return result.rows.map((r: Record<string, unknown>) => this.mapRow(r));
  }

  /** Delete an idea (dismiss it) */
  async deleteIdea(ideaId: string, userId: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM content_ideas WHERE id = $1 AND user_id = $2',
      [ideaId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Mark an idea as used */
  async markUsed(ideaId: string, userId: string): Promise<ContentIdea | null> {
    const result = await query(
      'UPDATE content_ideas SET used = TRUE WHERE id = $1 AND user_id = $2 RETURNING id, user_id, content_type, idea, used, created_at',
      [ideaId, userId],
    );
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  /** Generate a fresh batch of ideas, avoiding all past ideas */
  async generateBatch(userId: string, contentType: ContentType): Promise<ContentIdea[]> {
    const apiKey = process.env.AI_TEXT_API_KEY || '';
    if (!apiKey) {
      throw new PlatformError({
        severity: 'error',
        component: 'ContentIdeasService',
        operation: 'generateBatch',
        description: 'OpenAI API key is not configured.',
        recommendedActions: ['Set AI_TEXT_API_KEY in your .env file'],
      });
    }

    // Fetch ALL past ideas (used and unused) to avoid repeats
    const pastResult = await query(
      'SELECT idea FROM content_ideas WHERE user_id = $1 AND content_type = $2 ORDER BY created_at DESC',
      [userId, contentType],
    );
    const pastIdeas = pastResult.rows.map((r: Record<string, unknown>) => r.idea as string);

    const typeLabel = CONTENT_TYPE_LABELS[contentType] || contentType;
    const avoidSection = pastIdeas.length > 0
      ? '\n\nPreviously generated ideas (DO NOT repeat or closely paraphrase any of these):\n' + pastIdeas.map((idea, i) => (i + 1) + '. ' + idea).join('\n')
      : '';

    // Include current date context so seasonal ideas are timely
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
      const response = await fetch(OPENAI_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
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
      const ideas = this.parseIdeas(raw);

      // Insert into DB
      const inserted: ContentIdea[] = [];
      for (const idea of ideas) {
        const result = await query(
          'INSERT INTO content_ideas (user_id, content_type, idea) VALUES ($1, $2, $3) RETURNING id, user_id, content_type, idea, used, created_at',
          [userId, contentType, idea],
        );
        inserted.push(this.mapRow(result.rows[0]));
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
    // Fallback: split by newlines
    return cleaned.split('\n').map((l) => l.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);
  }

  private mapRow(row: Record<string, unknown>): ContentIdea {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      contentType: row.content_type as ContentType,
      idea: row.idea as string,
      used: row.used as boolean,
      createdAt: new Date(row.created_at as string),
    };
  }
}

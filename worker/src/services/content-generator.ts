import { PlatformError } from '../errors/index.js';
import { getTemplate } from './content-templates.js';
import type { ContentGeneratorInput, GeneratedContent, ContentTypeTemplate } from 'shared';

const GENERATION_TIMEOUT_MS = 30_000;
const MAX_CAPTION_LENGTH = 2200;
const MAX_HASHTAGS = 30;

const SYSTEM_PROMPT = [
  'You are a social media content writer for Chicago Reno, a professional home renovation company in Chicago.',
  'Write engaging Instagram captions and hashtags.',
  '',
  'RULES:',
  '- Caption must be under 2200 characters',
  '- Generate 10-20 relevant hashtags (no # prefix)',
  '- Always include ChicagoReno and ChicagoContractor',
  '- Use a professional yet approachable tone',
  '- Include emojis sparingly for visual appeal',
  '- Do NOT use any markdown formatting (no bold, no asterisks, no headers)',
  '',
  'RESPONSE FORMAT (strict JSON):',
  '{"caption": "your caption here", "hashtags": ["tag1", "tag2"]}',
  '',
  'Return ONLY valid JSON. No markdown, no code fences.',
].join('\n');

export class ContentGenerator {
  private readonly apiKey: string;
  private readonly apiUrl: string;

  constructor(apiKey: string, apiUrl: string) {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
  }

  async generate(input: ContentGeneratorInput): Promise<GeneratedContent> {
    if (!this.apiKey) {
      throw new PlatformError({
        severity: 'error',
        component: 'ContentGenerator',
        operation: 'generate',
        description: 'AI text API key is not configured.',
        recommendedActions: ['Set AI_TEXT_API_KEY in your environment'],
      });
    }

    const template = getTemplate(input.contentType);
    const prompt = this.buildPrompt(template, input);
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
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          temperature: 0.8,
          max_tokens: 1000,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new PlatformError({
          severity: 'error',
          component: 'ContentGenerator',
          operation: 'generate',
          description: 'OpenAI API error (' + response.status + '): ' + errText,
          recommendedActions: ['Check your API key', 'Try again'],
        });
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      const raw = data.choices?.[0]?.message?.content?.trim() ?? '';
      return this.parseResponse(raw);
    } catch (err) {
      if (err instanceof PlatformError) throw err;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      throw new PlatformError({
        severity: 'error',
        component: 'ContentGenerator',
        operation: 'generate',
        description: isAbort
          ? 'Content generation timed out after 30 seconds.'
          : 'Content generation failed: ' + (err instanceof Error ? err.message : 'Unknown error'),
        recommendedActions: ['Try again'],
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildPrompt(template: ContentTypeTemplate, input: ContentGeneratorInput): string {
    let prompt = template.promptTemplate;
    if (input.templateFields) {
      for (const [key, value] of Object.entries(input.templateFields)) {
        prompt = prompt.replace(new RegExp('\\{\\{' + key + '\\}\\}', 'g'), value || '');
      }
    }
    prompt = prompt.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_match: string, field: string, content: string) => {
      const val = input.templateFields?.[field] || (field === 'context' ? input.context : '');
      return val ? content.replace(new RegExp('\\{\\{' + field + '\\}\\}', 'g'), val) : '';
    });
    prompt = prompt.replace(/\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_match: string, field: string, content: string) => {
      const val = input.templateFields?.[field] || '';
      return !val || val === 'false' ? content : '';
    });
    prompt = prompt.replace(/\{\{[#^/]?\w+\}\}/g, '');
    if (input.media.length > 0) {
      const mediaDesc = input.media.map((m: { aiDescription?: string; filename: string }) => m.aiDescription || m.filename).join(', ');
      prompt += '\n\nAttached media: ' + mediaDesc;
    }
    if (input.context) {
      prompt += '\n\nAdditional context: ' + input.context;
    }
    return prompt;
  }

  private parseResponse(raw: string): GeneratedContent {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      const parsed = JSON.parse(cleaned) as { caption?: string; hashtags?: string[] };
      const caption = (parsed.caption ?? '').slice(0, MAX_CAPTION_LENGTH);
      const hashtags = (parsed.hashtags ?? [])
        .map((t: string) => t.replace(/^#/, '').trim())
        .filter(Boolean)
        .slice(0, MAX_HASHTAGS);
      const hashStr = hashtags.map((t: string) => '#' + t).join(' ');
      return {
        caption,
        hashtags,
        formattedCaption: hashtags.length > 0 ? caption + '\n\n' + hashStr : caption,
      };
    } catch {
      const lines = cleaned.split('\n').filter(Boolean);
      const hashtagLine = lines.find((l) => l.includes('#'));
      const captionLines = lines.filter((l) => l !== hashtagLine);
      const caption = captionLines.join('\n').slice(0, MAX_CAPTION_LENGTH);
      const hashtags = hashtagLine
        ? hashtagLine.match(/#\w+/g)?.map((t) => t.replace('#', '')).slice(0, MAX_HASHTAGS) ?? []
        : [];
      const hashStr = hashtags.map((t) => '#' + t).join(' ');
      return {
        caption: caption || 'Caption generation failed. Please try again.',
        hashtags,
        formattedCaption: hashtags.length > 0 ? caption + '\n\n' + hashStr : caption,
      };
    }
  }
}

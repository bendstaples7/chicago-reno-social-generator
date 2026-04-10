import { PlatformError } from '../errors/index.js';

const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536;
const MAX_TOKENS = 8_000;
const MAX_CHARS = MAX_TOKENS * 4; // ~32,000 chars
const MAX_BATCH_SIZE = 20;
const TIMEOUT_MS = 10_000;

export class EmbeddingService {
  /**
   * Generate a single text embedding.
   * Returns a zero vector for empty text without calling the API.
   * Truncates input to ~8,000 tokens before sending.
   */
  async embed(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      return new Array(DIMENSIONS).fill(0);
    }

    const truncated = this.truncateText(text);
    const response = await this.callApi([truncated]);
    return response[0];
  }

  /**
   * Generate embeddings for multiple texts.
   * Splits arrays larger than 20 into multiple API calls.
   * Returns a zero vector for any empty text input.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Track which indices are empty vs need API calls
    const results: number[][] = new Array(texts.length);
    const nonEmptyIndices: number[] = [];
    const nonEmptyTexts: string[] = [];

    for (let i = 0; i < texts.length; i++) {
      if (!texts[i] || texts[i].trim().length === 0) {
        results[i] = new Array(DIMENSIONS).fill(0);
      } else {
        nonEmptyIndices.push(i);
        nonEmptyTexts.push(this.truncateText(texts[i]));
      }
    }

    // Process non-empty texts in batches of MAX_BATCH_SIZE
    for (let offset = 0; offset < nonEmptyTexts.length; offset += MAX_BATCH_SIZE) {
      const batch = nonEmptyTexts.slice(offset, offset + MAX_BATCH_SIZE);
      const embeddings = await this.callApi(batch);

      for (let j = 0; j < embeddings.length; j++) {
        results[nonEmptyIndices[offset + j]] = embeddings[j];
      }
    }

    return results;
  }

  private truncateText(text: string): string {
    const estimatedTokens = Math.ceil(text.length / 4);
    if (estimatedTokens > MAX_TOKENS) {
      return text.slice(0, MAX_CHARS);
    }
    return text;
  }

  private async callApi(inputs: string[]): Promise<number[][]> {
    const apiKey = process.env.AI_TEXT_API_KEY || '';
    const apiUrl = process.env.AI_TEXT_API_URL || '';

    if (!apiKey) {
      throw new PlatformError({
        severity: 'error',
        component: 'EmbeddingService',
        operation: 'embed',
        description: 'AI text API key is not configured.',
        recommendedActions: ['Set AI_TEXT_API_KEY in your .env file'],
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        body: JSON.stringify({
          model: MODEL,
          input: inputs,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new PlatformError({
          severity: 'error',
          component: 'EmbeddingService',
          operation: 'embed',
          description: `OpenAI Embeddings API error (${response.status}): ${errText}`,
          recommendedActions: ['Check your API key', 'Try again'],
        });
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[]; index: number }>;
      };

      // Sort by index to preserve input order
      return data.data
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);
    } catch (err) {
      if (err instanceof PlatformError) throw err;

      const isAbort = err instanceof Error && err.name === 'AbortError';
      throw new PlatformError({
        severity: 'error',
        component: 'EmbeddingService',
        operation: 'embed',
        description: isAbort
          ? 'Embedding generation timed out after 10 seconds.'
          : `Embedding generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        recommendedActions: ['Try again'],
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

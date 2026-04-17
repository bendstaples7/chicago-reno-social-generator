import { PlatformError } from '../errors/index.js';

const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536;
const MAX_TOKENS = 8_000;
const MAX_CHARS = MAX_TOKENS * 4; // ~32,000 chars
const MAX_BATCH_SIZE = 20;
const BASE_TIMEOUT_MS = 10_000;
const TIMEOUT_PER_ITEM_MS = 1_000;

export class EmbeddingService {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Generate a single text embedding.
   * Returns a zero vector for empty text without calling the API.
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
   * Generate embeddings for multiple texts in batches of 20.
   * Returns a zero vector for any empty text input.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

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
    if (!this.apiKey) {
      throw new PlatformError({
        severity: 'error',
        component: 'EmbeddingService',
        operation: 'embed',
        description: 'AI text API key is not configured.',
        recommendedActions: ['Set AI_TEXT_API_KEY in your environment'],
      });
    }

    // Scale timeout with batch size
    const timeoutMs = BASE_TIMEOUT_MS + inputs.length * TIMEOUT_PER_ITEM_MS;
    const embeddingsUrl = 'https://api.openai.com/v1/embeddings';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(embeddingsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + this.apiKey,
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
          ? `Embedding generation timed out after ${Math.round(timeoutMs / 1000)} seconds.`
          : `Embedding generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        recommendedActions: ['Try again'],
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

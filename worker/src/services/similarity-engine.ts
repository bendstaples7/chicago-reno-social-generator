import { EmbeddingService } from './embedding-service.js';

const SIMILARITY_THRESHOLD = 0.3;
const MAX_RESULTS = 5;

export interface SimilarQuoteResult {
  jobberQuoteId: string;
  quoteNumber: string;
  title: string;
  message: string;
  similarityScore: number;
  searchableText: string;
}

/**
 * Compute cosine similarity between two vectors.
 * Returns 0 for zero-length or zero-magnitude vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export class SimilarityEngine {
  private readonly db: D1Database;
  private readonly embeddingService: EmbeddingService;

  constructor(db: D1Database, embeddingService: EmbeddingService) {
    this.db = db;
    this.embeddingService = embeddingService;
  }

  /**
   * Find the most similar past quotes to the given customer request text.
   * Returns up to 5 results with similarity score >= 0.3, sorted descending.
   * Returns an empty array when the corpus is empty.
   */
  async findSimilar(customerText: string): Promise<SimilarQuoteResult[]> {
    const result = await this.db.prepare(
      `SELECT jobber_quote_id, quote_number, title, message, searchable_text, embedding
       FROM quote_corpus
       WHERE embedding IS NOT NULL`
    ).all();

    if (result.results.length === 0) return [];

    // Embed the customer request text
    const queryEmbedding = await this.embeddingService.embed(customerText);

    const scored: SimilarQuoteResult[] = [];

    for (const row of result.results as Record<string, unknown>[]) {
      const corpusEmbedding: number[] =
        typeof row.embedding === 'string'
          ? JSON.parse(row.embedding as string)
          : row.embedding as number[];

      const score = cosineSimilarity(queryEmbedding, corpusEmbedding);

      if (score >= SIMILARITY_THRESHOLD) {
        scored.push({
          jobberQuoteId: row.jobber_quote_id as string,
          quoteNumber: row.quote_number as string,
          title: (row.title as string) ?? '',
          message: (row.message as string) ?? '',
          similarityScore: score,
          searchableText: row.searchable_text as string,
        });
      }
    }

    scored.sort((a, b) => b.similarityScore - a.similarityScore);
    return scored.slice(0, MAX_RESULTS);
  }
}

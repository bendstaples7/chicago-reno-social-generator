# Implementation Plan: Quote Similarity Matching

## Overview

This plan implements similarity-based quote matching by building a local corpus of completed Jobber quotes, computing text embeddings via OpenAI, performing cosine similarity search, and injecting the best matches into the Quote Engine's AI prompt. Implementation proceeds bottom-up: database schema → shared types → core services → enhanced existing services → API routes → client UI.

## Tasks

- [x] 1. Database schema and shared types
  - [x] 1.1 Create migration `server/src/migrations/007_quote_corpus.sql`
    - Create `quote_corpus` table with columns: id, jobber_quote_id (UNIQUE), quote_number, title, message, quote_status, searchable_text, embedding (JSONB), created_at, updated_at
    - Create `quote_corpus_sync_status` singleton table with: id (CHECK = 1), last_sync_at, total_quotes, last_sync_duration_ms, last_sync_error
    - Insert default row into `quote_corpus_sync_status`
    - Create `quote_draft_similar_quotes` table with: id, quote_draft_id (FK → quote_drafts ON DELETE CASCADE), jobber_quote_id, quote_number, title, similarity_score (NUMERIC 5,4), display_order
    - Create indexes on jobber_quote_id, quote_status, and quote_draft_id
    - _Requirements: 1.2, 1.7, 4.4, 8.1, 8.3_

  - [x] 1.2 Add `SimilarQuote` type and extend `QuoteDraft` in `shared/src/types/quote.ts`
    - Add `SimilarQuote` interface with: jobberQuoteId, quoteNumber, title, message, similarityScore
    - Add optional `similarQuotes?: SimilarQuote[]` field to the existing `QuoteDraft` interface
    - Export the new type from `shared/src/index.ts`
    - _Requirements: 4.4, 5.1, 8.1_

- [x] 2. Embedding Service
  - [x] 2.1 Implement `EmbeddingService` in `server/src/services/embedding-service.ts`
    - Create class with `embed(text: string): Promise<number[]>` and `embedBatch(texts: string[]): Promise<number[][]>` methods
    - Use `AI_TEXT_API_KEY` and `AI_TEXT_API_URL` environment variables
    - Use `text-embedding-3-small` model
    - Implement token estimation as `Math.ceil(text.length / 4)` and truncate text at character level if over 8,000 tokens (~32,000 chars)
    - For `embedBatch`, split arrays larger than 20 into multiple API calls
    - Return empty/zero vector for empty text input without calling the API
    - Throw descriptive `PlatformError` on API failure including HTTP status and error message
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 2.2 Write property test: token truncation (Property 4)
    - **Property 4: Token truncation**
    - Generate random strings of varying lengths (0 to 50,000 chars), verify text sent to API never exceeds 8,000 tokens and texts within limit are sent unchanged
    - File: `tests/property/quote-similarity-matching.property.test.ts`
    - **Validates: Requirements 2.3**

  - [ ]* 2.3 Write property test: batch embedding size limit (Property 5)
    - **Property 5: Batch embedding respects size limit**
    - Generate random arrays of texts (1-50 items), mock API, verify no single call exceeds 20 inputs
    - File: `tests/property/quote-similarity-matching.property.test.ts`
    - **Validates: Requirements 2.6**

  - [ ]* 2.4 Write property test: embedding error includes status and message (Property 6)
    - **Property 6: Embedding error includes status and message**
    - Generate random HTTP status codes (400-599) and error messages, verify thrown error contains both
    - File: `tests/property/quote-similarity-matching.property.test.ts`
    - **Validates: Requirements 2.5**

  - [ ]* 2.5 Write unit tests for EmbeddingService
    - Test with mocked OpenAI API: correct model header, token truncation edge cases, batch splitting, error formatting, empty text handling
    - File: `tests/unit/embedding-service.test.ts`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 3. Similarity Engine
  - [x] 3.1 Implement `cosineSimilarity` function and `SimilarityEngine` class in `server/src/services/similarity-engine.ts`
    - Implement pure `cosineSimilarity(a, b)` function: dot product / (magnitude(a) * magnitude(b)), return 0 for zero vectors
    - Implement `findSimilar(customerText: string): Promise<SimilarQuote[]>` method
    - Load all corpus records with embeddings from the database
    - Call `EmbeddingService.embed()` for the customer text
    - Compute cosine similarity against all corpus embeddings
    - Filter results below 0.3 threshold
    - Return top 5 sorted by score descending
    - Return empty array when corpus is empty
    - Each result includes: jobberQuoteId, quoteNumber, title, message, similarityScore, searchableText
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 3.2 Write property test: cosine similarity range, symmetry, and identity (Property 1)
    - **Property 1: Cosine similarity range, symmetry, and identity**
    - Generate random vector pairs, verify result in [-1, 1], symmetry, identity (self-similarity = 1.0), zero vector returns 0
    - File: `tests/property/quote-similarity-matching.property.test.ts`
    - **Validates: Requirements 3.2**

  - [ ]* 3.3 Write property test: similarity search sorted, filtered, capped results (Property 2)
    - **Property 2: Similarity search returns sorted, filtered, capped results with required fields**
    - Generate random corpus with embeddings and a query embedding, verify results sorted descending, at most 5, all scores >= 0.3, required fields present
    - File: `tests/property/quote-similarity-matching.property.test.ts`
    - **Validates: Requirements 3.3, 3.4, 3.5**

  - [ ]* 3.4 Write unit tests for SimilarityEngine
    - Test `cosineSimilarity()` with known vectors: identical, orthogonal, opposite
    - Test `findSimilar()` with a small corpus and known embeddings, empty corpus, all below threshold
    - File: `tests/unit/similarity-engine.test.ts`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Quote Sync Service
  - [x] 5.1 Implement `QuoteSyncService` in `server/src/services/quote-sync-service.ts`
    - Implement `sync(): Promise<SyncResult>` method
    - Fetch all approved/converted quotes from Jobber via paginated GraphQL queries (page size 50)
    - Build searchable text as title + message concatenation (handle null/empty title or message)
    - Upsert quotes into `quote_corpus`: only update when title, message, or status changed; only recompute embedding when title or message changed
    - Batch embedding generation in groups of 20 via `EmbeddingService.embedBatch()`
    - Track estimated API point cost per page (~5 points per page), pause for 20 seconds if cumulative cost exceeds 8,000 points
    - Handle HTTP 429 / throttle errors by waiting the specified duration
    - Log sync activity via `ActivityLogService`
    - Update `quote_corpus_sync_status` with timestamp, count, duration
    - On Jobber API failure: log error, retain existing corpus data, return error in result
    - Implement `getStatus(): Promise<{ totalQuotes: number; lastSyncAt: string | null }>` method
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 7.1, 7.2, 7.3, 7.4_

  - [ ]* 5.2 Write property test: searchable text composition (Property 3)
    - **Property 3: Searchable text composition**
    - Generate random title/message pairs (including nulls/empties), verify searchable text composition rules
    - File: `tests/property/quote-similarity-matching.property.test.ts`
    - **Validates: Requirements 1.2**

  - [ ]* 5.3 Write property test: upsert logic — update only when changed (Property 7)
    - **Property 7: Upsert logic — update only when changed**
    - Generate pairs of quote versions with random field changes, verify update/skip decision and embedding recomputation logic
    - File: `tests/property/quote-similarity-matching.property.test.ts`
    - **Validates: Requirements 1.4**

  - [ ]* 5.4 Write property test: rate limit point budgeting (Property 13)
    - **Property 13: Rate limit point budgeting**
    - Generate random sequences of page costs, verify pause at 8,000 threshold
    - File: `tests/property/quote-similarity-matching.property.test.ts`
    - **Validates: Requirements 7.2**

  - [ ]* 5.5 Write property test: sync failure preserves corpus (Property 14)
    - **Property 14: Sync failure preserves corpus**
    - Generate random corpus state, simulate sync failure, verify corpus unchanged
    - File: `tests/property/quote-similarity-matching.property.test.ts`
    - **Validates: Requirements 1.6**

  - [ ]* 5.6 Write unit tests for QuoteSyncService
    - Test upsert logic with mocked Jobber responses: new quotes, updated quotes, unchanged quotes, API failures, rate limit handling
    - File: `tests/unit/quote-sync-service.test.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 7.1, 7.2, 7.3_

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Enhance Quote Engine and Quote Draft Service
  - [x] 7.1 Extend `QuoteEngine` to use similar quotes in AI prompt
    - Modify `QuoteEngineInput` to accept optional `similarQuotes` array
    - Update `buildPrompt()` to include a `SIMILAR PAST QUOTES` section with up to 3 similar quotes and their similarity scores
    - Add AI instructions to prefer line items and pricing from similar quotes when they match
    - When no similar quotes provided, omit the section entirely
    - Wire `SimilarityEngine.findSimilar()` call into the generate flow
    - Include similar quote references in `QuoteEngineOutput`
    - _Requirements: 4.1, 4.2, 4.3, 4.5_

  - [ ]* 7.2 Write property test: prompt includes at most 3 similar quotes with scores (Property 8)
    - **Property 8: Prompt includes at most 3 similar quotes with scores**
    - Generate random arrays of similar quotes (0-10), build prompt, verify at most 3 included with scores, no section when empty
    - File: `tests/property/quote-similarity-matching.property.test.ts`
    - **Validates: Requirements 4.1, 4.3, 4.5**

  - [x] 7.3 Extend `QuoteDraftService` to persist and load similar quote references
    - Update `save()` to insert similar quote references into `quote_draft_similar_quotes`
    - Update `getById()` to join and return similar quote references
    - Update `list()` to include similar quote references for each draft
    - Deletion already handled by CASCADE
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ]* 7.4 Write property test: similar quote references round-trip (Property 9)
    - **Property 9: Similar quote references round-trip**
    - Generate random drafts with similar quote references, save then load, verify equivalence
    - File: `tests/property/quote-similarity-matching.property.test.ts`
    - **Validates: Requirements 4.4, 8.1, 8.2**

  - [ ]* 7.5 Write property test: draft deletion cascades to similar quote references (Property 10)
    - **Property 10: Draft deletion cascades to similar quote references**
    - Generate random drafts with similar quotes, delete, verify references are gone
    - File: `tests/property/quote-similarity-matching.property.test.ts`
    - **Validates: Requirements 8.3**

  - [ ]* 7.6 Write unit tests for enhanced QuoteEngine and QuoteDraftService
    - Test `buildPrompt()` with 0, 1, 3, 5 similar quotes — verify prompt structure and score inclusion
    - Test save/load/delete with similar quote references
    - File: `tests/unit/quote-engine-similarity.test.ts`
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 8.1, 8.2, 8.3_

- [x] 8. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. API routes and service wiring
  - [x] 9.1 Add corpus sync and status routes to `server/src/routes/quotes.ts`
    - Add `POST /corpus/sync` route that triggers `QuoteSyncService.sync()` and returns `SyncResult`
    - Add `GET /corpus/status` route that returns corpus status from `QuoteSyncService.getStatus()`
    - Wire `SimilarityEngine` into the existing `POST /generate` route: call `findSimilar()` before `quoteEngine.generateQuote()` and pass results through
    - Update `POST /generate` to persist similar quote references when saving the draft
    - Update `GET /drafts/:id` and `GET /drafts` responses to include `similarQuotes` array
    - Register new services (`EmbeddingService`, `SimilarityEngine`, `QuoteSyncService`) in the route file
    - Export new services from `server/src/services/index.ts`
    - _Requirements: 1.5, 1.7, 3.1, 4.1, 4.4, 8.1, 8.2_

  - [x] 9.2 Add client API functions in `client/src/api.ts`
    - Add `syncCorpus(): Promise<SyncResult>` calling `POST /api/quotes/corpus/sync`
    - Add `fetchCorpusStatus(): Promise<{ totalQuotes: number; lastSyncAt: string | null }>` calling `GET /api/quotes/corpus/status`
    - Import `SimilarQuote` type from shared
    - _Requirements: 1.5, 1.7, 6.1, 6.2_

- [x] 10. Client UI — Similar Quotes Panel
  - [x] 10.1 Create `SimilarQuotesPanel` component and integrate into `QuoteDraftPage`
    - Create component that displays similar quotes with title, quote number, and similarity score as percentage
    - Color-coded badge: green (>70%), yellow (50-70%), gray (30-50%)
    - Click to expand inline detail view showing the quote message text
    - Hide panel entirely when no similar quotes exist
    - Integrate into existing `QuoteDraftPage.tsx`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]* 10.2 Write property test: similarity score color badge mapping (Property 11)
    - **Property 11: Similarity score color badge mapping**
    - Generate random scores in [0.3, 1.0], verify correct color mapping: green >0.7, yellow 0.5-0.7, gray 0.3-0.5
    - File: `tests/property/quote-similarity-matching.property.test.ts`
    - **Validates: Requirements 5.3**

  - [ ]* 10.3 Write property test: similar quotes panel display completeness (Property 12)
    - **Property 12: Similar quotes panel display completeness**
    - Generate random similar quotes, render panel, verify title/number/percentage present in output
    - File: `tests/property/quote-similarity-matching.property.test.ts`
    - **Validates: Requirements 5.1**

- [x] 11. Client UI — Corpus Status Indicator
  - [x] 11.1 Create `CorpusStatusIndicator` component and integrate into Settings/Quotes page
    - Display total indexed quote count and last sync timestamp
    - "Sync Now" button triggers `POST /api/quotes/corpus/sync`
    - Progress indicator while sync is in progress (poll `GET /api/quotes/corpus/status`)
    - Disable button during sync, re-enable on completion or failure
    - Error message on sync failure
    - Integrate into existing Settings or Quotes page
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 12. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 14 universal correctness properties defined in the design
- Unit tests validate specific examples and edge cases
- The entire similarity matching feature degrades gracefully — if any part fails, existing quote generation continues unaffected

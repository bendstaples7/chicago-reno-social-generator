# Requirements Document

## Introduction

This feature enhances the existing quote generation workflow by using completed Jobber quotes as a reference library for similarity matching. When a new customer request arrives, the system finds the most similar past quotes and uses them as starting points — providing better line item suggestions, more accurate pricing, and faster quote generation. Since the Jobber API does not expose "quote templates" as a first-class entity, this feature treats the corpus of ~526 existing completed quotes as an implicit template library. The system computes text embeddings for both the historical quotes and the incoming customer request, performs cosine similarity search, and surfaces the top matches to the Quote_Engine for context-aware draft generation.

## Glossary

- **Quote_Corpus**: The local database table storing completed Jobber quotes along with their computed text embeddings, used as the reference library for similarity search.
- **Embedding_Service**: The server-side module responsible for generating text embeddings from quote text using the OpenAI embeddings API (configured via AI_TEXT_API_KEY and AI_TEXT_API_URL environment variables).
- **Similarity_Engine**: The server-side module that computes cosine similarity between a customer request embedding and all embeddings in the Quote_Corpus, returning ranked matches.
- **Quote_Sync_Service**: The server-side module responsible for fetching completed quotes from the Jobber GraphQL API and synchronizing them into the Quote_Corpus, including computing and storing embeddings.
- **Similar_Quote**: A past completed quote from the Quote_Corpus that has been identified as similar to the current customer request, including its similarity score and original line items.
- **Similarity_Score**: A numeric value between 0 and 1 representing how closely a historical quote matches the current customer request, computed via cosine similarity of text embeddings.
- **Quote_Engine**: The existing server-side service that analyzes customer request text and produces a Quote_Draft, now enhanced to accept Similar_Quotes as additional context.
- **Jobber_Integration**: The existing server-side module for communicating with the Jobber GraphQL API, extended to fetch quote line items for completed quotes.
- **Quote_Draft**: The existing structured draft quote produced by the system, now augmented with references to the Similar_Quotes used as starting points.

## Requirements

### Requirement 1: Quote Corpus Synchronization

**User Story:** As a user, I want the system to automatically import and index completed Jobber quotes, so that the similarity engine has an up-to-date reference library.

#### Acceptance Criteria

1. WHEN the Quote_Sync_Service runs, THE Quote_Sync_Service SHALL fetch all quotes with a status of "approved" or "converted" from the Jobber GraphQL API using paginated queries with a page size of 50.
2. THE Quote_Sync_Service SHALL store each fetched quote in the Quote_Corpus table with the following fields: Jobber quote ID, quote number, title, message text, quote status, and a combined searchable text field composed of the title and message.
3. WHEN a quote is stored in the Quote_Corpus, THE Quote_Sync_Service SHALL call the Embedding_Service to compute a text embedding for the combined searchable text field and store the resulting embedding vector alongside the quote record.
4. IF a quote already exists in the Quote_Corpus (matched by Jobber quote ID), THEN THE Quote_Sync_Service SHALL update the existing record only when the title, message, or status has changed, and recompute the embedding if the text changed.
5. THE Quote_Sync_Service SHALL provide a manual trigger endpoint (`POST /api/quotes/corpus/sync`) that initiates a full synchronization.
6. IF the Jobber API returns an error or is unreachable during synchronization, THEN THE Quote_Sync_Service SHALL log the error to the activity log and retain the existing Quote_Corpus data without modification.
7. THE Quote_Sync_Service SHALL record the timestamp of the last successful synchronization and expose it via `GET /api/quotes/corpus/status`.

### Requirement 2: Text Embedding Generation

**User Story:** As a user, I want the system to generate semantic embeddings for quotes and customer requests, so that similarity can be computed based on meaning rather than keyword overlap.

#### Acceptance Criteria

1. THE Embedding_Service SHALL generate text embeddings by calling the OpenAI embeddings API using the credentials configured in AI_TEXT_API_KEY and AI_TEXT_API_URL environment variables.
2. THE Embedding_Service SHALL use the `text-embedding-3-small` model for all embedding generation to balance cost and quality.
3. WHEN the Embedding_Service receives text longer than 8,000 tokens, THE Embedding_Service SHALL truncate the text to 8,000 tokens before sending it to the API.
4. THE Embedding_Service SHALL return embedding vectors as arrays of floating-point numbers.
5. IF the OpenAI embeddings API returns an error, THEN THE Embedding_Service SHALL throw a descriptive error including the HTTP status code and error message.
6. THE Embedding_Service SHALL support batch embedding generation, accepting up to 20 text inputs in a single API call to reduce round trips during corpus synchronization.

### Requirement 3: Similarity Search

**User Story:** As a user, I want the system to find the most similar past quotes to my current customer request, so that I get better starting points for new quotes.

#### Acceptance Criteria

1. WHEN a customer request is submitted for quote generation, THE Similarity_Engine SHALL compute a text embedding for the customer request text using the Embedding_Service.
2. THE Similarity_Engine SHALL compute the cosine similarity between the customer request embedding and every embedding in the Quote_Corpus.
3. THE Similarity_Engine SHALL return the top 5 most similar quotes, ranked by Similarity_Score in descending order.
4. THE Similarity_Engine SHALL exclude quotes with a Similarity_Score below 0.3 from the results, even if fewer than 5 results remain.
5. THE Similarity_Engine SHALL return each Similar_Quote with the following fields: Jobber quote ID, quote number, title, message, Similarity_Score, and the combined searchable text.
6. WHEN the Quote_Corpus is empty, THE Similarity_Engine SHALL return an empty list of Similar_Quotes and the Quote_Engine SHALL proceed with standard generation without similar quote context.

### Requirement 4: Enhanced Quote Generation with Similar Quotes

**User Story:** As a user, I want the quote engine to use similar past quotes as context when generating new drafts, so that the generated quotes are more accurate and relevant.

#### Acceptance Criteria

1. WHEN similar quotes are found, THE Quote_Engine SHALL include the top similar quotes (up to 3) as additional context in the AI prompt sent to the OpenAI API.
2. THE Quote_Engine SHALL instruct the AI to prefer line items and pricing from the similar quotes when they match the current customer request.
3. THE Quote_Engine SHALL include the Similarity_Score of each referenced similar quote in the AI prompt so the AI can weight its references appropriately.
4. WHEN the Quote_Draft is generated, THE Quote_Draft SHALL store references to the Similar_Quotes that were used as context, including their Jobber quote IDs and Similarity_Scores.
5. WHEN no similar quotes are found (empty corpus or all scores below threshold), THE Quote_Engine SHALL fall back to the existing generation behavior using only the Product_Catalog and Template_Library.

### Requirement 5: Similar Quotes Display

**User Story:** As a user, I want to see which past quotes were used as references when generating a new draft, so that I can understand and verify the system's suggestions.

#### Acceptance Criteria

1. WHEN a Quote_Draft has associated Similar_Quotes, THE Quote_Generation_Section SHALL display a "Similar Past Quotes" panel showing each referenced quote with its title, quote number, and Similarity_Score formatted as a percentage.
2. WHEN the user clicks on a Similar_Quote in the panel, THE Quote_Generation_Section SHALL expand an inline detail view showing the quote message text.
3. THE Quote_Generation_Section SHALL visually indicate the strength of each match using a color-coded badge: green for Similarity_Score above 0.7, yellow for scores between 0.5 and 0.7, and gray for scores between 0.3 and 0.5.
4. WHEN a Quote_Draft has no associated Similar_Quotes, THE Quote_Generation_Section SHALL hide the "Similar Past Quotes" panel entirely.

### Requirement 6: Corpus Management

**User Story:** As a user, I want to view the status of the quote corpus and trigger re-synchronization, so that I can ensure the reference library is current.

#### Acceptance Criteria

1. THE Quote_Generation_Section SHALL display a corpus status indicator on the Settings or Quotes page showing the total number of indexed quotes and the timestamp of the last successful synchronization.
2. THE Quote_Generation_Section SHALL provide a "Sync Now" button that triggers a manual corpus synchronization via the `POST /api/quotes/corpus/sync` endpoint.
3. WHILE a corpus synchronization is in progress, THE Quote_Generation_Section SHALL display a progress indicator and disable the "Sync Now" button.
4. WHEN a corpus synchronization completes, THE Quote_Generation_Section SHALL update the status indicator with the new quote count and timestamp.
5. IF a corpus synchronization fails, THEN THE Quote_Generation_Section SHALL display an error message describing the failure and re-enable the "Sync Now" button.

### Requirement 7: Rate Limit Awareness

**User Story:** As a user, I want the system to respect Jobber API rate limits during corpus synchronization, so that the integration remains stable and does not get throttled.

#### Acceptance Criteria

1. THE Quote_Sync_Service SHALL use a page size of 50 for all paginated Jobber GraphQL queries to stay within the 10,000-point rate limit budget.
2. THE Quote_Sync_Service SHALL track the estimated cost of each query page and pause synchronization if the estimated cumulative cost exceeds 8,000 points, resuming after a 20-second delay to allow point restoration at 500 points per second.
3. IF the Jobber API returns a rate limit error (HTTP 429 or a GraphQL error with a throttle extension), THEN THE Quote_Sync_Service SHALL wait for the duration specified in the response headers before retrying the request.
4. THE Quote_Sync_Service SHALL complete a full synchronization of up to 600 quotes within 5 minutes under normal API conditions.

### Requirement 8: Data Persistence for Similar Quote References

**User Story:** As a user, I want the similar quote references to be saved with my draft, so that I can see which past quotes influenced the generation when I revisit a draft later.

#### Acceptance Criteria

1. WHEN a Quote_Draft is saved, THE Quote_Draft_Service SHALL persist the associated Similar_Quote references (Jobber quote ID, quote number, title, Similarity_Score) in a dedicated database table linked to the Quote_Draft.
2. WHEN a Quote_Draft is loaded, THE Quote_Draft_Service SHALL fetch and include the associated Similar_Quote references.
3. WHEN a Quote_Draft is deleted, THE Quote_Draft_Service SHALL delete the associated Similar_Quote references via cascading delete.

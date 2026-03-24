# Requirements Document

## Introduction

Migrate the Social Media Cross-Poster application from a local Express.js + PostgreSQL stack to a fully Cloudflare-hosted stack: Cloudflare Workers (backend via Hono framework), Cloudflare D1 (database), Cloudflare R2 bindings (media storage), and Cloudflare Pages (frontend). The migration targets Cloudflare's free tier and preserves all existing functionality including AI content generation, AI image generation, Instagram publishing, session-based authentication, and the Quick Post workflow.

## Glossary

- **Worker**: A Cloudflare Workers serverless function that handles HTTP requests with a 30-second CPU time limit on the free tier
- **D1**: Cloudflare's serverless SQLite-compatible database service
- **R2**: Cloudflare's S3-compatible object storage, accessible via native bindings inside Workers
- **R2_Binding**: The native Workers API for R2 access (env.R2_BUCKET) replacing the @aws-sdk/client-s3 SDK
- **Hono**: A lightweight web framework for Cloudflare Workers, replacing Express.js
- **Pages**: Cloudflare Pages, a static site hosting service for the React frontend
- **Queue**: Cloudflare Queues, an asynchronous message queue for offloading long-running tasks beyond the 30-second CPU limit
- **Wrangler**: The Cloudflare CLI tool for developing, testing, and deploying Workers, D1, and R2 resources
- **Migration_Script**: A SQL script that creates or alters D1 database tables using SQLite-compatible syntax
- **Session_Token**: A unique string stored in D1 that authenticates a user across stateless Worker requests
- **PlatformError**: The application's structured error type used across all services

## Requirements

### Requirement 1: Hono Framework Backend

**User Story:** As a developer, I want the Express.js server replaced with a Hono-based Cloudflare Worker, so that the backend runs on Cloudflare's edge network at zero cost.

#### Acceptance Criteria

1. THE Worker SHALL expose all existing API routes under the same path structure (/api/auth/*, /api/media/*, /api/posts/*, /api/channels/*, /api/settings, /api/content-advisor/suggest, /api/activity-log, /api/content-ideas/*, /api/content-types, /api/holidays)
2. THE Worker SHALL use the Hono framework for routing, middleware, and request/response handling
3. THE Worker SHALL accept a Bindings type that declares D1 (DB), R2 (R2_BUCKET), and all environment variables (AI_TEXT_API_KEY, AI_TEXT_API_URL, FB_PAGE_ACCESS_TOKEN, IG_BUSINESS_ACCOUNT_ID, CHANNEL_ENCRYPTION_KEY, S3_PUBLIC_URL)
4. THE Worker SHALL use string concatenation instead of backtick template literals in all TypeScript source files
5. WHEN a request arrives, THE Worker SHALL parse JSON bodies using Hono's built-in body parsing with a 10 MB limit
6. THE Worker SHALL export a default object with a fetch handler compatible with the Cloudflare Workers runtime

### Requirement 2: D1 Database Migration

**User Story:** As a developer, I want the PostgreSQL database replaced with Cloudflare D1, so that the application uses a serverless database on Cloudflare's free tier.

#### Acceptance Criteria

1. THE Migration_Script SHALL create all 10 tables (users, user_settings, channel_connections, posts, media_items, post_media, activity_log_entries, team_members, sessions, content_ideas) using SQLite-compatible syntax
2. THE Migration_Script SHALL replace uuid_generate_v4() default values with application-level UUID generation using crypto.randomUUID()
3. THE Migration_Script SHALL replace PostgreSQL TIMESTAMP defaults (NOW()) with SQLite-compatible defaults (datetime('now'))
4. THE Migration_Script SHALL replace PostgreSQL JSONB column types with TEXT columns
5. THE Migration_Script SHALL replace PostgreSQL VARCHAR(n) types with TEXT columns
6. THE Migration_Script SHALL use SQLite-compatible ON CONFLICT syntax for upsert operations (INSERT OR REPLACE or INSERT ... ON CONFLICT ... DO UPDATE)
7. WHEN a service performs a database query, THE Worker SHALL use the D1 binding (env.DB) with prepared statements (.prepare().bind().run() or .prepare().bind().all())
8. THE Migration_Script SHALL replace PostgreSQL CREATE EXTENSION statements with no-op comments since D1 does not support extensions

### Requirement 3: R2 Native Bindings

**User Story:** As a developer, I want media storage to use native R2 bindings instead of the @aws-sdk/client-s3 SDK, so that the Worker accesses R2 directly without external dependencies.

#### Acceptance Criteria

1. THE Worker SHALL use env.R2_BUCKET.put() to upload media files to R2, replacing PutObjectCommand from @aws-sdk/client-s3
2. THE Worker SHALL use env.R2_BUCKET.delete() to remove media files from R2, replacing DeleteObjectCommand from @aws-sdk/client-s3
3. THE Worker SHALL use env.R2_BUCKET.get() to retrieve media files from R2, replacing GetObjectCommand from @aws-sdk/client-s3
4. THE Worker SHALL remove the @aws-sdk/client-s3 dependency from the project
5. THE Worker SHALL remove the server/src/config/storage.ts S3Client configuration file
6. WHEN storing an AI-generated image, THE Worker SHALL decode the base64 data URI into an ArrayBuffer and store the result in R2 via env.R2_BUCKET.put()

### Requirement 4: Session Management in D1

**User Story:** As a developer, I want session management to work in the stateless Workers environment using D1, so that users remain authenticated across requests.

#### Acceptance Criteria

1. WHEN a user logs in, THE Worker SHALL generate a session token using crypto.randomUUID() and store the token in the D1 sessions table
2. WHEN a request includes a Bearer token in the Authorization header, THE Worker SHALL look up the token in the D1 sessions table and attach the user to the request context
3. WHEN a session token is older than 7 days, THE Worker SHALL delete the expired session row and reject the request
4. WHEN a session is verified successfully, THE Worker SHALL update the last_active_at timestamp in the D1 sessions table
5. WHEN a user logs out, THE Worker SHALL delete the session row from the D1 sessions table

### Requirement 5: Long-Running Task Offloading

**User Story:** As a developer, I want image generation requests offloaded to a Cloudflare Queue, so that the 30-second Worker CPU time limit does not cause timeouts during GPT-Image-1 calls that take up to 2 minutes.

#### Acceptance Criteria

1. WHEN an image generation request is received, THE Worker SHALL enqueue the request to a Cloudflare Queue and return a job ID to the client immediately
2. THE Queue consumer SHALL call the GPT-Image-1 API with a 120-second timeout, store the resulting image in R2, and write the media item metadata to D1
3. THE Worker SHALL expose a GET /api/media/generate-status/:jobId endpoint that returns the current status (queued, processing, completed, failed) and the resulting media item when completed
4. IF the GPT-Image-1 API call fails or times out, THEN THE Queue consumer SHALL mark the job as failed and store the error description in D1
5. THE Worker SHALL store job status records in a D1 table (image_generation_jobs) with columns: id, user_id, status, description, style, result_media_id, error, created_at, updated_at

### Requirement 6: Frontend Deployment to Cloudflare Pages

**User Story:** As a developer, I want the React frontend deployed to Cloudflare Pages, so that the entire application is hosted on Cloudflare's free tier.

#### Acceptance Criteria

1. THE Pages configuration SHALL build the React app using the existing Vite build process (npm run build in the client directory)
2. THE Pages configuration SHALL set the build output directory to client/dist
3. THE Vite configuration SHALL replace the localhost:3001 proxy with the deployed Worker URL for API requests
4. THE client API module SHALL prefix all fetch calls with the Worker URL when not running in development mode
5. WHEN running in development mode, THE Vite configuration SHALL proxy /api requests to the local Wrangler dev server

### Requirement 7: Wrangler Configuration

**User Story:** As a developer, I want a wrangler.toml configuration file that declares all Cloudflare bindings, so that the Worker can be deployed with a single command.

#### Acceptance Criteria

1. THE wrangler.toml SHALL declare the Worker name, compatibility date, and main entry point
2. THE wrangler.toml SHALL declare the D1 database binding with binding name "DB"
3. THE wrangler.toml SHALL declare the R2 bucket binding with binding name "R2_BUCKET"
4. THE wrangler.toml SHALL declare the Queue binding for image generation jobs
5. THE wrangler.toml SHALL declare all secret environment variables (AI_TEXT_API_KEY, FB_PAGE_ACCESS_TOKEN, IG_BUSINESS_ACCOUNT_ID, CHANNEL_ENCRYPTION_KEY) as vars or secrets
6. THE wrangler.toml SHALL declare a queue consumer configuration for processing image generation jobs

### Requirement 8: Service Layer Adaptation

**User Story:** As a developer, I want all 13 service files adapted to use D1 and R2 bindings passed through the Hono context, so that services work in the Workers runtime.

#### Acceptance Criteria

1. WHEN a service needs database access, THE service SHALL receive the D1 binding from the Hono context instead of importing from a shared database module
2. WHEN a service needs R2 access, THE service SHALL receive the R2 binding from the Hono context instead of importing the S3 client
3. THE Worker SHALL replace all PostgreSQL parameterized query syntax ($1, $2, $3) with D1 prepared statement syntax using positional ? parameters
4. THE Worker SHALL replace pg Pool transaction methods (BEGIN, COMMIT, ROLLBACK) with D1 batch operations (.batch()) for atomic multi-statement operations
5. THE Worker SHALL replace Node.js crypto module usage with the Web Crypto API (crypto.randomUUID(), crypto.subtle) available in the Workers runtime
6. THE Worker SHALL replace Node.js Buffer usage with Uint8Array and ArrayBuffer for binary data handling in the Workers runtime

### Requirement 9: Shared Types Preservation

**User Story:** As a developer, I want the shared TypeScript types package to remain unchanged, so that both the Worker backend and the Pages frontend continue to use the same type definitions.

#### Acceptance Criteria

1. THE shared package SHALL continue to export all existing types (User, Post, MediaItem, ChannelConnection, ContentType, PostStatus, GeneratedContent, GeneratedImage, ActivityLogEntry, ContentIdea, UserSettings, PlatformError types)
2. THE Worker SHALL import types from the shared package using the same import paths
3. THE Pages frontend SHALL import types from the shared package using the same import paths

### Requirement 10: D1 Migration Scripts

**User Story:** As a developer, I want D1-compatible migration SQL scripts, so that the database schema can be created and updated using wrangler d1 migrations commands.

#### Acceptance Criteria

1. THE Migration_Script SHALL be placed in a migrations/ directory compatible with wrangler d1 migrations apply
2. THE Migration_Script SHALL use INTEGER PRIMARY KEY or TEXT PRIMARY KEY instead of UUID PRIMARY KEY with default generation
3. THE Migration_Script SHALL use TEXT NOT NULL DEFAULT (datetime('now')) instead of TIMESTAMP NOT NULL DEFAULT NOW()
4. THE Migration_Script SHALL include the image_generation_jobs table for the Queue-based image generation workflow
5. WHEN the migration is applied via wrangler d1 migrations apply, THE D1 database SHALL contain all required tables with correct column types and constraints

### Requirement 11: Token Encryption in Workers

**User Story:** As a developer, I want Instagram access token encryption to use the Web Crypto API, so that token security is maintained in the Workers runtime without Node.js crypto.

#### Acceptance Criteria

1. THE Worker SHALL encrypt Instagram access tokens using the Web Crypto API (crypto.subtle.encrypt with AES-GCM) instead of Node.js crypto.createCipheriv
2. THE Worker SHALL decrypt Instagram access tokens using the Web Crypto API (crypto.subtle.decrypt with AES-GCM) instead of Node.js crypto.createDecipheriv
3. THE Worker SHALL import the encryption key from the CHANNEL_ENCRYPTION_KEY environment variable
4. IF the CHANNEL_ENCRYPTION_KEY is not configured, THEN THE Worker SHALL throw a PlatformError with a descriptive message

### Requirement 12: Test Suite Migration

**User Story:** As a developer, I want all existing unit tests updated to work with the D1 and R2 bindings, so that the test suite validates the migrated codebase.

#### Acceptance Criteria

1. THE test suite SHALL mock D1 database bindings instead of PostgreSQL pg Pool connections
2. THE test suite SHALL mock R2 bucket bindings instead of @aws-sdk/client-s3 commands
3. THE test suite SHALL continue to use vitest as the test runner and fast-check for property-based tests
4. WHEN all tests are executed via npm test, THE test suite SHALL pass with the same coverage as the pre-migration test suite

### Requirement 13: Error Handling Middleware

**User Story:** As a developer, I want the Express error-handling middleware converted to a Hono error handler, so that PlatformError instances are caught and returned as structured JSON responses.

#### Acceptance Criteria

1. THE Worker SHALL register a Hono onError handler that catches PlatformError instances and returns the formatted error response with the appropriate HTTP status code (400 for warnings, 500 for errors)
2. WHEN a non-PlatformError is thrown, THE Worker SHALL wrap the error in a PlatformError with severity 'error', component 'Server', and operation 'unknown'
3. THE Worker SHALL log errors to the activity_log_entries table in D1 when an ActivityLogService is available

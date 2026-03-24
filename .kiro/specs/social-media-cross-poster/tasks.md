    # Implementation Plan: Social Media Cross-Poster

## Overview

Incremental implementation of the Chicago Reno social media cross-poster platform. The plan builds from data layer and core types upward through services, API routes, and finally the React frontend. Each task wires into previous work so there is no orphaned code. TypeScript throughout, with fast-check property-based tests alongside implementation.

## Tasks

- [x] 1. Project scaffolding and core types
  - [x] 1.1 Initialize monorepo with React+TypeScript frontend (Vite) and Node.js/Express backend, configure PostgreSQL connection, and set up fast-check + Jest/Vitest test runner
    - Create `client/` and `server/` directories with tsconfig, package.json, and shared types
    - Configure database connection pool (PostgreSQL)
    - Configure S3-compatible object storage client
    - Set up test runner with fast-check installed
    - _Requirements: 9.4, 9.5_

  - [x] 1.2 Define all shared TypeScript types and interfaces: `ChannelInterface`, `PlatformError`, `ContentType`, `AdvisorMode`, `ApprovalMode`, `PostStatus`, enums, and data model types
    - `ChannelInterface` with all methods (getAuthorizationUrl, handleAuthCallback, disconnect, formatPost, validatePost, publish, getPostStatus, getConstraints)
    - `PlatformError` interface with severity, component, operation, description, recommendedActions
    - `ContentType` enum: education, testimonial, personal_brand, seasonal_event
    - `AdvisorMode` enum: smart, random, manual
    - `ApprovalMode` type: manual_review, auto_publish
    - `PostStatus` type: draft, awaiting_approval, approved, publishing, published, failed
    - All entity types: User, Post, MediaItem, PostMedia, ChannelConnection, ActivityLogEntry, UserSettings, TeamMember
    - `ChannelConstraints`, `FormattedPost`, `PublishResult`, `ValidationResult` types
    - _Requirements: 2.1, 9.4, 9.6, 10.1, 18.1, 19.1, 20.1, 20.12_

  - [x] 1.3 Create database migration scripts for all tables: users, user_settings, posts, media_items, post_media, channel_connections, activity_log_entries, team_members
    - Follow the ER diagram from the design document exactly
    - Include indexes on user_id foreign keys and post status
    - user_settings defaults: advisor_mode='manual', approval_mode='manual_review'
    - _Requirements: 1.1, 18.3, 19.2_

- [x] 2. Error handling and Activity Log
  - [x] 2.1 Implement `PlatformError` class, `formatErrorResponse` utility, and Express error-handling middleware
    - PlatformError must include severity, component, operation, description, recommendedActions (at least one)
    - formatErrorResponse maps PlatformError to JSON response
    - Express middleware catches PlatformError, logs to ActivityLog, returns formatted response
    - _Requirements: 20.1, 20.2, 20.12, 20.13_

  - [ ]* 2.2 Write property test for error format consistency (Property 19)
    - **Property 19: Error format consistency**
    - Generate arbitrary PlatformError instances and verify formatted response always has severity (error|warning), non-empty component, non-empty description, and recommendedActions array with >= 1 entry
    - **Validates: Requirements 20.1, 20.4, 20.5, 20.6, 20.9, 20.10, 20.12**

  - [x] 2.3 Implement `ActivityLogService` with `log()` and `getEntries()` methods
    - Persists entries to activity_log_entries table
    - Each entry: timestamp, userId, component, operation, severity, description, recommendedAction
    - _Requirements: 20.3_

  - [ ]* 2.4 Write property test for error events logged to Activity Log (Property 20)
    - **Property 20: Error events logged to Activity Log**
    - For any PlatformError processed by the middleware, verify a corresponding ActivityLogEntry is created with matching timestamp, component, operation, and description
    - **Validates: Requirements 20.3**

- [x] 3. Authentication module
  - [x] 3.1 Implement `AuthModule` with email domain validation, session management (30-min inactivity expiry), and session middleware
    - `initiateAuth(email)`: validate email ends with @chicago-reno.com (case-insensitive), reject others with PlatformError
    - `verifySession(token)`: check session exists and last_active_at within 30 minutes, update last_active_at on valid access
    - `sessionMiddleware`: reject expired/invalid sessions, redirect to login
    - Store sessions in PostgreSQL
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 3.2 Write property tests for auth (Properties 1, 2)
    - **Property 1: Email domain validation** — For any email string, accept iff it ends with @chicago-reno.com (case-insensitive)
    - **Validates: Requirements 1.1, 1.2, 1.3**
    - **Property 2: Session expiry after inactivity** — For any session and timestamp, session is invalid iff elapsed time since last activity > 30 minutes
    - **Validates: Requirements 1.4**

  - [x] 3.3 Create API routes: `POST /auth/login`, `POST /auth/verify`, `POST /auth/logout`
    - Wire to AuthModule methods
    - Apply error middleware for PlatformError responses
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 4. Checkpoint — Core infrastructure
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Media Service and Image Generator
  - [x] 5.1 Implement `MediaService` with upload validation, S3 storage, thumbnail generation, AI-generated image storage, deletion, and listing
    - `upload(file, userId)`: validate MIME type (image/jpeg, image/png, video/mp4) and size (<= 50MB), store binary in S3, metadata in PostgreSQL, return thumbnail URL
    - `storeGenerated(image, userId)`: save AI-generated image with source='ai_generated' and ai_description
    - `delete(mediaId, userId)`: remove from S3 and PostgreSQL
    - `list(userId, pagination)`: return all media with source labels
    - Reject invalid uploads with descriptive PlatformError
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3A.5, 3A.8_

  - [ ]* 5.2 Write property tests for media (Properties 3, 4, 5, 23)
    - **Property 3: Media upload validation** — Accept iff MIME type in [image/jpeg, image/png, video/mp4] AND size <= 50MB
    - **Validates: Requirements 3.2, 3.3, 3.4**
    - **Property 4: Media source label invariant** — Every media item has source exactly 'uploaded' or 'ai_generated'
    - **Validates: Requirements 3.6, 3A.8**
    - **Property 5: AI-generated image metadata round trip** — Saved AI image returns source='ai_generated' and matching ai_description
    - **Validates: Requirements 3A.5**
    - **Property 23: Media deletion removes item** — After deletion, querying by ID returns not found
    - **Validates: Requirements 3.5**

  - [x] 5.3 Implement `ImageGenerator` service: generate images from text descriptions via AI API, enforce minimum 1080x1080 resolution, support style parameter
    - `generate(request)`: call AI image API, validate output resolution >= 1080x1080, format JPEG/PNG
    - Support styles: photorealistic, modern, illustrative
    - Return within 30 seconds or throw PlatformError (timeout)
    - _Requirements: 3A.1, 3A.2, 3A.3, 3A.4, 3A.6, 3A.7_

  - [ ]* 5.4 Write property test for generated image resolution (Property 6)
    - **Property 6: Generated image minimum resolution** — Every accepted image has width >= 1080, height >= 1080, format JPEG or PNG
    - **Validates: Requirements 3A.3**

  - [x] 5.5 Create API routes: `GET /media`, `POST /media/upload`, `POST /media/generate`, `POST /media/:id/save-generated`, `DELETE /media/:id`
    - Wire to MediaService and ImageGenerator
    - Apply session middleware and error handling
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3A.1, 3A.4, 3A.5, 3A.7_

- [x] 6. Content Generator and Content Types
  - [x] 6.1 Implement content type templates: define template fields, prompt structures, and layout guidance for Education, Testimonial, Personal_Brand, Seasonal_Event
    - Education: topic_title, key_points, supporting_media → informative caption with tips + home improvement hashtags
    - Testimonial: customer_quote, customer_name, is_anonymous, project_type → review highlight + social proof hashtags
    - Personal_Brand: member_name, role, bio_snippet → team member intro + team culture hashtags
    - Seasonal_Event: event_name, event_date, renovation_tie_in → event-renovation connection + seasonal hashtags
    - _Requirements: 10.1, 10.3, 10.4, 13.1, 14.1, 15.1, 16.1_

  - [ ]* 6.2 Write property test for content type to template mapping (Property 8)
    - **Property 8: Content type to template mapping** — For any valid content type, exactly one template exists; selecting a type produces the correct template; changing type updates template
    - **Validates: Requirements 4.6, 10.3, 10.4, 10.5**

  - [x] 6.3 Implement `ContentGenerator` with `generate()` and `validateContent()` methods
    - `generate(input)`: build prompt from content type template + user context, call AI text API, return caption + hashtags
    - Enforce caption <= 2200 chars, hashtags <= 30 for Instagram
    - Apply Chicago Reno brand voice: professional, approachable, home renovation focus
    - Content-type-specific generation: Education (tips + CTA), Testimonial (review highlight + CTA), Personal_Brand (team intro), Seasonal_Event (event tie-in + seasonal hashtags)
    - Handle anonymous testimonials: omit customer_name when is_anonymous=true
    - Return within 10 seconds or throw PlatformError
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.8, 4.9, 4.10, 4.11, 13.2, 13.3, 14.2, 14.3, 14.4, 15.2, 15.3, 16.2, 16.3_

  - [ ]* 6.4 Write property tests for content generation (Properties 7, 21)
    - **Property 7: Generated content respects Instagram constraints** — Caption <= 2200 chars, hashtags <= 30
    - **Validates: Requirements 4.3**
    - **Property 21: Anonymous testimonial omits customer name** — If is_anonymous=true and customer_name provided, name must be absent from output caption
    - **Validates: Requirements 14.4**

  - [x] 6.5 Create API routes: `GET /content-types`, `POST /posts/:id/generate-content`, `GET /holidays`
    - /content-types returns available types with template definitions
    - /posts/:id/generate-content calls ContentGenerator for a given post
    - /holidays returns upcoming holidays/events for Seasonal_Event planning
    - _Requirements: 10.2, 16.4_

- [x] 7. Checkpoint — Services layer complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Content Advisor and User Settings
  - [x] 8.1 Implement `ContentAdvisor` with Smart, Random, and Manual modes
    - `suggest(userId, mode)`: return ContentSuggestion or null
    - Smart mode: analyze post history, recommend least-recent content type, include explanation string
    - Random mode: weighted random favoring types used less in last 30 days
    - Manual mode: return null
    - _Requirements: 18.1, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.10_

  - [ ]* 8.2 Write property tests for Content Advisor (Properties 14, 15, 16, 17)
    - **Property 14: New user defaults** — New user has advisor_mode='manual', approval_mode='manual_review'
    - **Validates: Requirements 18.3, 19.2**
    - **Property 15: Smart mode recommends least-recent content type** — Suggestion favors types with longest gap, includes non-empty explanation
    - **Validates: Requirements 18.4, 18.5, 18.6**
    - **Property 16: Random mode weighted selection** — Returns valid content type; over many samples, less-frequent types appear more often
    - **Validates: Requirements 18.7**
    - **Property 17: Manual mode returns no suggestion** — Always returns null in manual mode
    - **Validates: Requirements 18.8**

  - [x] 8.3 Implement user settings service: get/update advisor_mode and approval_mode, enforce manual_review only in v1
    - Block attempts to set auto_publish mode with PlatformError
    - _Requirements: 18.2, 18.3, 19.2, 19.3, 19.7, 19.8_

  - [ ]* 8.4 Write property test for auto-publish mode blocked (Property 18)
    - **Property 18: Auto-publish mode blocked in v1** — Any attempt to set approval_mode to 'auto_publish' is rejected; mode stays 'manual_review'
    - **Validates: Requirements 19.8**

  - [x] 8.5 Create API routes: `GET /content-advisor/suggest`, `GET /settings`, `PUT /settings`
    - Wire to ContentAdvisor and settings service
    - _Requirements: 18.1, 18.2, 19.3_

- [x] 9. Post Service, Approval, and Publishing
  - [x] 9.1 Implement `PostService` with CRUD operations, draft persistence, and post status state machine
    - Create post: attach media, set caption/hashtags, content type, template fields, target channel
    - Save as draft: persist and make accessible
    - Status transitions: draft → awaiting_approval → approved → publishing → published, publishing → failed, failed → publishing (retry), failed → draft (edit), awaiting_approval → draft (edit)
    - Reject invalid transitions
    - _Requirements: 5.1, 5.2, 5.3, 7.4_

  - [ ]* 9.2 Write property tests for post operations (Properties 9, 10, 11, 12)
    - **Property 9: Post validation catches constraint violations** — Violations iff caption > 2200, > 30 hashtags, > 10 carousel images, video > 90s, unsupported media; violating posts not publishable
    - **Validates: Requirements 5.4, 5.5, 9.1**
    - **Property 10: Draft post round trip** — Saved draft returns same caption, hashtags, media, content type, template fields
    - **Validates: Requirements 5.3**
    - **Property 11: Unapproved posts cannot be published** — Posts not in 'approved' status are rejected by CrossPoster
    - **Validates: Requirements 7.1, 7.2, 19.5**
    - **Property 12: Post status state machine** — Only valid transitions are permitted; invalid transitions are rejected
    - **Validates: Requirements 7.4, 19.4, 19.6**

  - [x] 9.3 Implement `PublishApprovalService` with approve flow (manual_review mode only in v1)
    - `getMode(userId)`: always returns 'manual_review' in v1
    - `approve(postId, userId)`: transition post from awaiting_approval to approved
    - `isApproved(postId)`: check post status
    - _Requirements: 19.1, 19.2, 19.4, 19.5, 19.6_

  - [x] 9.4 Implement `InstagramChannel` conforming to `ChannelInterface`: OAuth flow, formatPost, validatePost, publish via Instagram Graph API, getPostStatus
    - OAuth: getAuthorizationUrl, handleAuthCallback (store token encrypted), disconnect (revoke token)
    - formatPost: format for Instagram Graph API (image, carousel, reel)
    - validatePost: check caption length, hashtag count, carousel limit, reel duration, media types
    - publish: call Instagram Graph API
    - getConstraints: return Instagram-specific limits
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 9.1, 9.2, 9.4, 9.5_

  - [ ]* 9.5 Write property test for channel connection error (Property 22)
    - **Property 22: Channel connection error produces descriptive message** — Any connection failure identifies the channel and auth step, offers retry option
    - **Validates: Requirements 2.5**

  - [x] 9.6 Implement `CrossPoster` with publish flow: approval check → channel format → publish → retry with exponential backoff (1s, 2s, 4s, max 3 retries) → status update
    - Verify post approved via PublishApprovalService before publishing
    - Delegate to ChannelInterface (InstagramChannel)
    - Retry transient failures only; fail immediately on permanent errors
    - Mark post as 'failed' after all retries exhausted, notify user via PlatformError
    - Log all publish attempts to ActivityLog
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ]* 9.7 Write property test for publish retry (Property 13)
    - **Property 13: Publish retry with bounded attempts** — At most 3 retries (4 total attempts); all fail → status='failed'; delays follow exponential backoff (1s, 2s, 4s)
    - **Validates: Requirements 7.5, 7.6**

  - [x] 9.8 Create API routes: `GET /posts`, `POST /posts`, `PUT /posts/:id`, `POST /posts/:id/approve`, `POST /posts/:id/publish`, `GET /posts/:id/preview`, `GET /channels`, `POST /channels/instagram/connect`, `GET /channels/instagram/callback`, `DELETE /channels/:id`
    - Wire to PostService, PublishApprovalService, CrossPoster, InstagramChannel
    - Apply session middleware and error handling
    - _Requirements: 5.1, 5.3, 7.1, 7.4, 2.2, 2.3, 2.4, 2.6_

- [x] 10. Checkpoint — Backend complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Quick-Post workflow backend
  - [x] 11.1 Implement `POST /posts/quick-start` endpoint: fetch content advisor suggestion, pre-load media thumbnails, return smart defaults (content type, hashtag count, Instagram format)
    - Combine ContentAdvisor.suggest() + MediaService.list() + default Instagram constraints
    - Pre-select content type based on advisor mode
    - Return all data needed for the quick-post form in a single response
    - _Requirements: 17.1, 17.2, 17.3, 17.8, 17.10_

  - [ ]* 11.2 Write property test for quick-post defaults (Property 24)
    - **Property 24: Quick-post workflow provides smart defaults** — For any user, quick-start returns pre-selected content type (based on advisor mode), hashtag count, and Instagram format
    - **Validates: Requirements 17.2**

- [x] 12. React frontend — Layout and Auth
  - [x] 12.1 Create app shell: routing (React Router), layout with sidebar navigation, dashboard page, and login page
    - Routes: /login, /dashboard, /posts/new, /posts/:id, /media, /settings, /activity-log
    - Protected routes redirect to /login if no valid session
    - _Requirements: 1.2, 1.4_

  - [x] 12.2 Implement login page with email input, @chicago-reno.com domain validation (client-side), error display for rejected domains, and session expiry redirect
    - Call POST /auth/login, handle success/error
    - Display PlatformError messages inline
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 13. React frontend — Media Library
  - [x] 13.1 Implement Media Library page: grid view with thumbnails, source labels (uploaded/AI-generated), upload dialog with drag-and-drop, delete confirmation, and AI image generation dialog
    - Upload: validate file type and size client-side before sending
    - AI generation: text description input, optional style selector, preview generated images, save selected to library
    - Display AI-generated label on applicable items
    - Show progress indicators during upload and generation
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3A.1, 3A.2, 3A.4, 3A.5, 3A.6, 3A.7, 3A.8_

- [x] 14. React frontend — Post Creation and Content Types
  - [x] 14.1 Implement Post creation page: content type selector with Content Advisor suggestion display, content type templates (Education, Testimonial, Personal_Brand, Seasonal_Event), media picker from library, caption/hashtag editor, and Instagram preview panel
    - Show Content Advisor suggestion (Smart/Random) as non-blocking recommendation with accept/dismiss
    - Content type selection loads corresponding template fields
    - Changing content type updates template dynamically
    - Media picker shows library thumbnails with quick selection
    - Caption field is editable with character count (2200 limit)
    - Hashtag display with count (30 limit)
    - Instagram preview shows post as it will appear
    - Recommend optimal dimensions (1080x1080 square, 1080x1350 portrait, 1080x566 landscape)
    - Validate against Instagram constraints before allowing publish
    - Highlight violations inline
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.4, 5.5, 9.1, 9.2, 9.3, 10.1, 10.2, 10.3, 10.4, 10.5, 13.1, 13.2, 14.1, 14.2, 14.4, 15.1, 15.2, 16.1, 16.2, 16.4, 18.4, 18.8, 18.9, 18.10_

  - [x] 14.2 Implement post approval and publish flow in UI: "Submit for Review" button, approval action, publish button, status indicators, success/failure feedback with retry option
    - Draft → Submit for Review → Approve → Publish flow
    - Show post status badge (draft, awaiting_approval, approved, published, failed)
    - On publish failure: show error with retry option
    - Auto_Publish_Mode shown as disabled "coming soon" in settings
    - _Requirements: 7.1, 7.2, 7.4, 7.6, 19.4, 19.5, 19.6, 19.7_

- [x] 15. React frontend — Quick-Post Workflow
  - [x] 15.1 Implement quick-post workflow page: single streamlined flow from content type suggestion → media selection → content generation → preview → approve, targeting <= 5 clicks and 60-second completion
    - Call POST /posts/quick-start to get defaults
    - Pre-load media thumbnails and content type options within 2 seconds
    - Media selection shows preview within 1 second
    - Content generation returns within 10 seconds (show progress indicator)
    - Image generation returns within 30 seconds (show progress indicator with estimated time)
    - Skip optional steps (style, context, manual edits) available
    - Progress indicator if any step exceeds time budget
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 17.10_

- [x] 16. React frontend — Settings, Channel Connection, and Activity Log
  - [x] 16.1 Implement Settings page: Content Advisor mode selector (Smart/Random/Manual), Publish Approval mode display (Manual Review active, Auto Publish disabled with "coming soon"), and Instagram channel connection/disconnection UI
    - Instagram connect: redirect to OAuth, handle callback, show connected account
    - Instagram disconnect: confirm and revoke
    - Channel connection errors displayed inline
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 18.2, 18.3, 19.2, 19.3, 19.7, 19.8_

  - [x] 16.2 Implement Activity Log page: paginated list of log entries with timestamp, component, operation, severity, description, and recommended action
    - Accessible from dashboard navigation
    - _Requirements: 20.3_

  - [x] 16.3 Implement global error display: toast notifications for transient errors, inline error messages for contextual errors, consistent formatting across all components
    - Use PlatformError structure for all error displays
    - Non-technical, user-friendly language
    - _Requirements: 20.1, 20.2, 20.4, 20.5, 20.6, 20.9, 20.10, 20.12, 20.13_

- [x] 17. Final checkpoint — Full integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 24 correctness properties from the design document using fast-check
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout — all implementation tasks use TypeScript

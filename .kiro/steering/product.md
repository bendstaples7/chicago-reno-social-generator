---
description: Product overview, modules, and key domain concepts
category: Product
---

# Product Overview

This is an internal business tool for **Chicago Reno**, a home services company. It has two main modules:

## Social Media Cross-Poster
- Create, manage, and publish social media posts (primarily Instagram)
- AI-powered content generation (captions, hashtags, images)
- Media library with upload and AI image generation
- Content ideas and templates system
- Activity logging for all operations

## Quote Generation Engine
- AI-powered quote generation from customer requests
- Integration with **Jobber** (field service management platform) for pulling customer requests, product catalogs, and quote templates
- Line item matching against product catalog with confidence scoring
- Quote revision workflow with feedback loop and revision history
- Similar quote lookup via embedding-based similarity search
- Quote corpus sync from Jobber for historical reference
- Draft management (create, edit, finalize, delete)

## Key Domain Concepts
- **QuoteDraft**: AI-generated quote with line items, matched against a product catalog
- **ProductCatalogEntry**: Products/services with pricing, sourced from Jobber or manual entry
- **SimilarQuote**: Past quotes found via vector similarity to inform new quotes
- **PlatformError**: Structured error with severity, component, operation, and recommended actions
- **ContentIdea**: AI-suggested content topics for social media posts

> **Moved: Jobber API Limitations** — Jobber API constraints and session cookie rules have been moved to `.kiro/steering/jobber-session-rules.md`. Refer to that file for authoritative guidance on the Jobber session gating requirements.

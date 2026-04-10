import { PlatformError } from '../errors/index.js';
import type { ProductCatalogEntry, QuoteTemplate, QuoteDraft, QuoteLineItem, SimilarQuote } from 'shared';

const GENERATION_TIMEOUT_MS = 30_000;
const CONFIDENCE_THRESHOLD = 70;

export interface QuoteEngineInput {
  customerText: string;
  mediaItemIds: string[];
  userId: string;
  catalogSource: 'jobber' | 'manual';
  manualCatalog?: ProductCatalogEntry[];
  manualTemplates?: QuoteTemplate[];
  similarQuotes?: SimilarQuote[];
}

export interface QuoteEngineOutput {
  draft: QuoteDraft;
  similarQuotes?: SimilarQuote[];
}

interface AILineItem {
  productCatalogEntryId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  confidenceScore: number;
  originalText: string;
  unmatchedReason?: string;
}

interface AIResponse {
  selectedTemplateId: string | null;
  selectedTemplateName: string | null;
  lineItems: AILineItem[];
}

const SYSTEM_PROMPT = [
  'You are a quote generation assistant for a home services company.',
  'Analyze the customer request and match items against the provided product catalog.',
  '',
  'RULES:',
  '- Only match to products that exist in the provided catalog — never invent new products.',
  '- Assign a confidence score (0-100) for each match.',
  '- If a requested item cannot be confidently matched (score < 70), include it with the best guess and a reason.',
  '- Estimate quantities from the customer text when possible; default to 1.',
  '- Use unit prices from the catalog entry.',
  '- If a template matches the type of work, reference it by ID and name.',
  '- When SIMILAR PAST QUOTES are provided, prefer their line items and pricing when they match the current customer request. Higher similarity scores indicate stronger matches.',
  '',
  'RESPONSE FORMAT (strict JSON):',
  '{',
  '  "selectedTemplateId": "id or null",',
  '  "selectedTemplateName": "name or null",',
  '  "lineItems": [',
  '    {',
  '      "productCatalogEntryId": "catalog id or null",',
  '      "productName": "name",',
  '      "quantity": 1,',
  '      "unitPrice": 0,',
  '      "confidenceScore": 85,',
  '      "originalText": "original customer text for this item",',
  '      "unmatchedReason": "reason or omit if matched"',
  '    }',
  '  ]',
  '}',
  '',
  'Return ONLY valid JSON. No markdown, no code fences.',
].join('\n');

export class QuoteEngine {
  /**
   * Generate a quote draft by analysing customer text (and optional images)
   * against the supplied product catalog and template library.
   */
  async generateQuote(
    input: QuoteEngineInput,
    catalog: ProductCatalogEntry[],
    templates: QuoteTemplate[],
  ): Promise<QuoteEngineOutput> {
    const apiKey = process.env.AI_TEXT_API_KEY || '';
    const apiUrl = process.env.AI_TEXT_API_URL || '';

    if (!apiKey) {
      throw new PlatformError({
        severity: 'error',
        component: 'QuoteEngine',
        operation: 'generateQuote',
        description: 'AI text API key is not configured.',
        recommendedActions: ['Set AI_TEXT_API_KEY in your .env file'],
      });
    }

    const similarQuotes = input.similarQuotes ?? [];
    const userPrompt = this.buildPrompt(input, catalog, templates, similarQuotes);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 2000,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new PlatformError({
          severity: 'error',
          component: 'QuoteEngine',
          operation: 'generateQuote',
          description: `OpenAI API error (${response.status}): ${errText}`,
          recommendedActions: ['Check your API key', 'Try again'],
        });
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      const raw = data.choices?.[0]?.message?.content?.trim() ?? '';
      const aiResult = this.parseAIResponse(raw, catalog);
      return this.buildDraft(input, aiResult, catalog, similarQuotes);
    } catch (err) {
      if (err instanceof PlatformError) throw err;

      const isAbort = err instanceof Error && err.name === 'AbortError';
      throw new PlatformError({
        severity: 'error',
        component: 'QuoteEngine',
        operation: 'generateQuote',
        description: isAbort
          ? 'Quote generation timed out after 30 seconds.'
          : `Quote generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        recommendedActions: ['Try again'],
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Prompt construction ──────────────────────────────────────────────

  private buildPrompt(
    input: QuoteEngineInput,
    catalog: ProductCatalogEntry[],
    templates: QuoteTemplate[],
    similarQuotes: SimilarQuote[],
  ): string {
    const parts: string[] = [];

    parts.push('CUSTOMER REQUEST:');
    parts.push(input.customerText || '(no text provided — see attached images)');

    if (input.mediaItemIds.length > 0) {
      parts.push(`\nATTACHED IMAGES: ${input.mediaItemIds.length} image(s) provided as reference.`);
    }

    parts.push('\nPRODUCT CATALOG:');
    if (catalog.length === 0) {
      parts.push('(empty catalog)');
    } else {
      for (const p of catalog) {
        parts.push(`- [${p.id}] ${p.name} — $${p.unitPrice}${p.description ? ' — ' + p.description : ''}`);
      }
    }

    parts.push('\nTEMPLATE LIBRARY:');
    if (templates.length === 0) {
      parts.push('(no templates available)');
    } else {
      for (const t of templates) {
        parts.push(`- [${t.id}] ${t.name}${t.category ? ' (' + t.category + ')' : ''}`);
      }
    }

    // Include up to 3 similar past quotes when available
    if (similarQuotes.length > 0) {
      const topQuotes = similarQuotes.slice(0, 3);
      parts.push('\nSIMILAR PAST QUOTES:');
      for (const sq of topQuotes) {
        const scorePercent = Math.round(sq.similarityScore * 100);
        parts.push(`- [Score: ${scorePercent}%] Quote #${sq.quoteNumber} "${sq.title}" — ${sq.message}`);
      }
    }

    return parts.join('\n');
  }

  // ── AI response parsing ──────────────────────────────────────────────

  private parseAIResponse(raw: string, catalog: ProductCatalogEntry[]): AIResponse {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    try {
      const parsed = JSON.parse(cleaned) as AIResponse;
      return this.validateAIResponse(parsed, catalog);
    } catch {
      // Fallback: return everything as unresolved
      return this.fallbackResponse();
    }
  }

  /**
   * Validate and sanitise the AI response:
   * - Clamp confidence scores to [0, 100]
   * - Ensure referenced catalog entries actually exist
   * - Use catalog prices for matched items
   */
  private validateAIResponse(parsed: AIResponse, catalog: ProductCatalogEntry[]): AIResponse {
    const catalogIds = new Set(catalog.map((c) => c.id));

    const validatedItems: AILineItem[] = (parsed.lineItems ?? []).map((item) => {
      const score = Math.max(0, Math.min(100, Math.round(item.confidenceScore ?? 0)));

      // If the AI referenced a catalog entry that doesn't exist, downgrade to unmatched
      if (item.productCatalogEntryId && !catalogIds.has(item.productCatalogEntryId)) {
        return {
          ...item,
          productCatalogEntryId: null,
          confidenceScore: Math.min(score, CONFIDENCE_THRESHOLD - 1),
          unmatchedReason: item.unmatchedReason || 'Referenced product not found in catalog',
        };
      }

      // For matched items, use the catalog's unit price to stay consistent
      if (item.productCatalogEntryId) {
        const catalogEntry = catalog.find((c) => c.id === item.productCatalogEntryId);
        if (catalogEntry) {
          return {
            ...item,
            unitPrice: catalogEntry.unitPrice,
            productName: catalogEntry.name,
            confidenceScore: score,
          };
        }
      }

      return { ...item, confidenceScore: score };
    });

    return {
      selectedTemplateId: parsed.selectedTemplateId ?? null,
      selectedTemplateName: parsed.selectedTemplateName ?? null,
      lineItems: validatedItems,
    };
  }

  private fallbackResponse(): AIResponse {
    return {
      selectedTemplateId: null,
      selectedTemplateName: null,
      lineItems: [],
    };
  }

  // ── Draft construction ───────────────────────────────────────────────

  private buildDraft(
    input: QuoteEngineInput,
    aiResult: AIResponse,
    _catalog: ProductCatalogEntry[],
    similarQuotes: SimilarQuote[],
  ): QuoteEngineOutput {
    const now = new Date();
    const draftId = crypto.randomUUID();

    const allItems: QuoteLineItem[] = aiResult.lineItems.map((item) => {
      const resolved = item.confidenceScore >= CONFIDENCE_THRESHOLD && item.productCatalogEntryId !== null;
      return {
        id: crypto.randomUUID(),
        productCatalogEntryId: item.productCatalogEntryId,
        productName: item.productName,
        quantity: Math.max(0, item.quantity ?? 1),
        unitPrice: Math.max(0, item.unitPrice ?? 0),
        confidenceScore: item.confidenceScore,
        originalText: item.originalText ?? '',
        resolved,
        unmatchedReason: resolved ? undefined : (item.unmatchedReason || 'Low confidence match'),
      };
    });

    const lineItems = allItems.filter((i) => i.resolved);
    const unresolvedItems = allItems.filter((i) => !i.resolved);

    const draft: QuoteDraft = {
      id: draftId,
      draftNumber: 0, // assigned by DB sequence on save
      userId: input.userId,
      customerRequestText: input.customerText,
      selectedTemplateId: aiResult.selectedTemplateId,
      selectedTemplateName: aiResult.selectedTemplateName,
      lineItems,
      unresolvedItems,
      catalogSource: input.catalogSource,
      status: 'draft',
      jobberRequestId: null,
      similarQuotes: similarQuotes.length > 0 ? similarQuotes : undefined,
      createdAt: now,
      updatedAt: now,
    };

    return {
      draft,
      similarQuotes: similarQuotes.length > 0 ? similarQuotes : undefined,
    };
  }
}

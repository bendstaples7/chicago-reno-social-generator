import { PlatformError } from '../errors/index.js';
import type { ProductCatalogEntry, QuoteLineItem, RuleGroupWithRules } from 'shared';

const REVISION_TIMEOUT_MS = 300_000;
const CONFIDENCE_THRESHOLD = 70;

export interface RevisionInput {
  feedbackText: string;
  currentLineItems: QuoteLineItem[];
  currentUnresolvedItems: QuoteLineItem[];
  catalog: ProductCatalogEntry[];
  rules?: RuleGroupWithRules[];
}

export interface RevisionOutput {
  lineItems: QuoteLineItem[];
  unresolvedItems: QuoteLineItem[];
}

interface AILineItem {
  productCatalogEntryId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  confidenceScore: number;
  originalText: string;
  unmatchedReason?: string;
  ruleIdsApplied?: string[];
}

const SYSTEM_PROMPT = [
  'You are a quote revision assistant for a home services company.',
  'You will receive the current line items of a quote draft, a product catalog, and user feedback.',
  'Interpret the feedback as delta operations on the current line items.',
  '',
  'SUPPORTED OPERATIONS:',
  '- Reorder line items (e.g., "move underlayment before hardwood installation")',
  '- Change quantity on existing items (e.g., "increase drywall to 12 sheets")',
  '- Adjust unit price on existing items (e.g., "change labor rate to $75/hour")',
  '- Remove line items (e.g., "remove the painting line item")',
  '- Add new line items by matching against the product catalog (e.g., "add trim installation")',
  '',
  'RULES:',
  '- Preserve all line items NOT referenced in the feedback without modification.',
  '- When adding new items, match against the provided catalog. Use catalog pricing for matched items.',
  '- If a new item cannot be matched to the catalog, include it with productCatalogEntryId: null and a descriptive unmatchedReason.',
  '- Assign confidence scores (0-100) for each item.',
  '- Use unit prices from the catalog for matched items.',
  '- When BUSINESS RULES are provided, follow them when revising line items. For each line item, include a "ruleIdsApplied" array listing the IDs of any business rules that influenced that line item. If no rules apply, use an empty array.',
  '',
  'RESPONSE FORMAT (strict JSON):',
  '{',
  '  "lineItems": [',
  '    {',
  '      "productCatalogEntryId": "catalog id or null",',
  '      "productName": "name",',
  '      "quantity": 1,',
  '      "unitPrice": 0,',
  '      "confidenceScore": 85,',
  '      "originalText": "original text for this item",',
  '      "unmatchedReason": "reason or omit if matched",',
  '      "ruleIdsApplied": ["rule-id-1", "rule-id-2"]',
  '    }',
  '  ]',
  '}',
  '',
  'Return ONLY valid JSON. No markdown, no code fences.',
].join('\n');

export class RevisionEngine {
  async revise(input: RevisionInput): Promise<RevisionOutput> {
    const apiKey = process.env.AI_TEXT_API_KEY || '';
    const apiUrl = process.env.AI_TEXT_API_URL || '';

    if (!apiKey) {
      throw new PlatformError({
        severity: 'error',
        component: 'RevisionEngine',
        operation: 'revise',
        description: 'AI text API key is not configured.',
        recommendedActions: ['Set AI_TEXT_API_KEY in your .env file'],
      });
    }

    if (!apiUrl) {
      throw new PlatformError({
        severity: 'error',
        component: 'RevisionEngine',
        operation: 'revise',
        description: 'AI text API URL is not configured.',
        recommendedActions: ['Set AI_TEXT_API_URL in your .env file'],
      });
    }

    const userPrompt = this.buildPrompt(input);
    const systemPrompt = input.rules && input.rules.length > 0
      ? SYSTEM_PROMPT + '\n\n' + this.buildRulesSection(input.rules)
      : SYSTEM_PROMPT;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REVISION_TIMEOUT_MS);

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
            { role: 'system', content: systemPrompt },
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
          component: 'RevisionEngine',
          operation: 'revise',
          description: `OpenAI API error (${response.status}): ${errText}`,
          recommendedActions: ['Try again'],
        });
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      const raw = data.choices?.[0]?.message?.content?.trim() ?? '';
      return this.parseAndValidate(raw, input);
    } catch (err) {
      if (err instanceof PlatformError) throw err;

      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (isAbort) {
        throw new PlatformError({
          severity: 'error',
          component: 'RevisionEngine',
          operation: 'revise',
          description: 'Quote revision timed out after 5 minutes.',
          recommendedActions: ['Try again'],
        });
      }

      throw new PlatformError({
        severity: 'error',
        component: 'RevisionEngine',
        operation: 'revise',
        description: `Quote revision failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        recommendedActions: ['Try again'],
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildPrompt(input: RevisionInput): string {
    const parts: string[] = [];

    parts.push('CURRENT LINE ITEMS:');
    if (input.currentLineItems.length === 0 && input.currentUnresolvedItems.length === 0) {
      parts.push('(no current line items)');
    } else {
      for (const item of input.currentLineItems) {
        parts.push(`- [${item.productCatalogEntryId ?? 'unmatched'}] ${item.productName} — qty: ${item.quantity}, price: $${item.unitPrice}`);
      }
      if (input.currentUnresolvedItems.length > 0) {
        parts.push('\nUNRESOLVED ITEMS:');
        for (const item of input.currentUnresolvedItems) {
          parts.push(`- ${item.productName} — "${item.originalText}" (reason: ${item.unmatchedReason ?? 'unknown'})`);
        }
      }
    }

    parts.push('\nPRODUCT CATALOG:');
    if (input.catalog.length === 0) {
      parts.push('(empty catalog)');
    } else {
      for (const p of input.catalog) {
        parts.push(`- [${p.id}] ${p.name} — $${p.unitPrice}${p.description ? ' — ' + p.description : ''}`);
      }
    }

    parts.push('\nUSER FEEDBACK:');
    parts.push(input.feedbackText);

    return parts.join('\n');
  }

  private parseAndValidate(raw: string, input: RevisionInput): RevisionOutput {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let parsed: { lineItems?: AILineItem[] };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Fallback: return original items unchanged
      return {
        lineItems: input.currentLineItems,
        unresolvedItems: input.currentUnresolvedItems,
      };
    }

    if (!parsed.lineItems || !Array.isArray(parsed.lineItems)) {
      return {
        lineItems: input.currentLineItems,
        unresolvedItems: input.currentUnresolvedItems,
      };
    }

    return this.validateAndPartition(parsed.lineItems, input.catalog);
  }

  private validateAndPartition(aiItems: AILineItem[], catalog: ProductCatalogEntry[]): RevisionOutput {
    const catalogIds = new Set(catalog.map((c) => c.id));
    const lineItems: QuoteLineItem[] = [];
    const unresolvedItems: QuoteLineItem[] = [];

    for (const item of aiItems) {
      const score = Math.max(0, Math.min(100, Math.round(item.confidenceScore ?? 0)));
      let finalItem: QuoteLineItem;

      // If the AI referenced a catalog entry that doesn't exist, downgrade to unmatched
      if (item.productCatalogEntryId && !catalogIds.has(item.productCatalogEntryId)) {
        finalItem = {
          id: crypto.randomUUID(),
          productCatalogEntryId: null,
          productName: item.productName,
          quantity: Math.max(0, item.quantity ?? 1),
          unitPrice: Math.max(0, item.unitPrice ?? 0),
          confidenceScore: Math.min(score, CONFIDENCE_THRESHOLD - 1),
          originalText: item.originalText ?? '',
          resolved: false,
          unmatchedReason: item.unmatchedReason || 'Referenced product not found in catalog',
          ruleIdsApplied: this.sanitizeRuleIds(item.ruleIdsApplied),
        };
      } else if (item.productCatalogEntryId) {
        // Matched item — use catalog pricing
        const catalogEntry = catalog.find((c) => c.id === item.productCatalogEntryId);
        finalItem = {
          id: crypto.randomUUID(),
          productCatalogEntryId: item.productCatalogEntryId,
          productName: catalogEntry?.name ?? item.productName,
          quantity: Math.max(0, item.quantity ?? 1),
          unitPrice: catalogEntry?.unitPrice ?? item.unitPrice,
          confidenceScore: score,
          originalText: item.originalText ?? '',
          resolved: score >= CONFIDENCE_THRESHOLD,
          unmatchedReason: score >= CONFIDENCE_THRESHOLD ? undefined : (item.unmatchedReason || 'Low confidence match'),
          ruleIdsApplied: this.sanitizeRuleIds(item.ruleIdsApplied),
        };
      } else {
        // No catalog reference
        finalItem = {
          id: crypto.randomUUID(),
          productCatalogEntryId: null,
          productName: item.productName,
          quantity: Math.max(0, item.quantity ?? 1),
          unitPrice: Math.max(0, item.unitPrice ?? 0),
          confidenceScore: score,
          originalText: item.originalText ?? '',
          resolved: false,
          unmatchedReason: item.unmatchedReason || 'No catalog match',
          ruleIdsApplied: this.sanitizeRuleIds(item.ruleIdsApplied),
        };
      }

      if (finalItem.resolved) {
        lineItems.push(finalItem);
      } else {
        unresolvedItems.push(finalItem);
      }
    }

    return { lineItems, unresolvedItems };
  }

  // ── Rules section builder ─────────────────────────────────────────

  /**
   * Sanitize ruleIdsApplied from AI response — filter to valid UUID strings only.
   */
  private sanitizeRuleIds(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return raw.filter((id): id is string => typeof id === 'string' && uuidPattern.test(id));
  }

  /**
   * Format active rules as a structured "BUSINESS RULES" prompt section,
   * grouped by group name with each rule's ID and description listed.
   */
  buildRulesSection(rules: RuleGroupWithRules[]): string {
    const parts: string[] = ['BUSINESS RULES:'];

    for (const group of rules) {
      if (group.rules.length === 0) continue;
      parts.push(`\n[${group.name}]`);
      for (const rule of group.rules) {
        parts.push(`- (ID: ${rule.id}) ${rule.description}`);
      }
    }

    return parts.join('\n');
  }
}

import { PlatformError } from '../errors/index.js';
import { sanitizeRuleIds, buildRulesSection } from './rules-prompt.js';
import type { ProductCatalogEntry, QuoteLineItem, RuleGroupWithRules } from 'shared';

const REVISION_TIMEOUT_MS = 300_000;
const CONFIDENCE_THRESHOLD = 70;

export interface RevisionInput {
  feedbackText: string;
  customerRequestText: string;
  currentLineItems: QuoteLineItem[];
  currentUnresolvedItems: QuoteLineItem[];
  catalog: ProductCatalogEntry[];
  rules?: RuleGroupWithRules[];
}

export interface RevisionOutput {
  lineItems: QuoteLineItem[];
  unresolvedItems: QuoteLineItem[];
  /** True when the AI response could not be parsed and the original items were returned unchanged. */
  revisionFailed?: boolean;
}

interface AILineItem {
  productCatalogEntryId: string | null;
  productName: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  confidenceScore: number;
  originalText: string;
  unmatchedReason?: string;
  ruleIdsApplied?: string[];
}

const SYSTEM_PROMPT = [
  'You are a quote revision assistant for a home services company.',
  'You will receive the original customer request, the current line items of a quote draft, a product catalog, and user feedback.',
  'Interpret the feedback as delta operations on the current line items.',
  '',
  'SUPPORTED OPERATIONS:',
  '- Reorder line items (e.g., "move underlayment before hardwood installation")',
  '- Change quantity on existing items (e.g., "increase drywall to 12 sheets")',
  '- Adjust unit price on existing items (e.g., "change labor rate to $75/hour")',
  '- Remove line items (e.g., "remove the painting line item")',
  '- Add new line items ONLY when the feedback explicitly requests it (e.g., "add trim installation")',
  '',
  'RULES:',
  '- Preserve all line items NOT referenced in the feedback without modification.',
  '- CRITICAL: Do NOT add line items that the feedback does not explicitly ask for. Only add items when the user clearly requests a specific addition.',
  '- When the feedback references the customer request (e.g., "if the request mentions X, add Y"), check the ORIGINAL CUSTOMER REQUEST section to evaluate the condition.',
  '- When adding new items, match against the provided catalog by name. Use catalog pricing for matched items.',
  '- Set productName to the EXACT catalog product name for matched items.',
  '- If a new item cannot be matched to the catalog, include it with a descriptive unmatchedReason.',
  '- Assign confidence scores (0-100) for each item.',
  '- Use unit prices from the catalog for matched items.',
  '- When BUSINESS RULES are provided, follow them when revising line items. Rules can change description, quantity, and unitPrice on a line item. productName must always match the exact catalog product name. For each line item, include a "ruleIdsApplied" array listing the IDs of any business rules that influenced that line item. If no rules apply, use an empty array.',
  '',
  'RESPONSE FORMAT (strict JSON):',
  '{',
  '  "lineItems": [',
  '    {',
  '      "productName": "exact catalog product name",',
  '      "description": "line item description (include if a rule modifies it, otherwise omit)",',
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
  private readonly apiKey: string;
  private readonly apiUrl: string;

  constructor(apiKey: string, apiUrl: string) {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
  }

  async revise(input: RevisionInput): Promise<RevisionOutput> {
    if (!this.apiKey) {
      throw new PlatformError({
        severity: 'error',
        component: 'RevisionEngine',
        operation: 'revise',
        description: 'AI text API key is not configured.',
        recommendedActions: ['Set AI_TEXT_API_KEY in your environment'],
      });
    }

    const userPrompt = this.buildPrompt(input);
    const systemPrompt = input.rules && input.rules.length > 0
      ? SYSTEM_PROMPT + '\n\n' + buildRulesSection(input.rules)
      : SYSTEM_PROMPT;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REVISION_TIMEOUT_MS);

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + this.apiKey,
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
      throw new PlatformError({
        severity: 'error',
        component: 'RevisionEngine',
        operation: 'revise',
        description: isAbort
          ? 'Quote revision timed out after 5 minutes.'
          : `Quote revision failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        recommendedActions: ['Try again'],
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildPrompt(input: RevisionInput): string {
    const parts: string[] = [];

    parts.push('ORIGINAL CUSTOMER REQUEST:');
    parts.push(input.customerRequestText || '(no customer request text available)');

    parts.push('\nCURRENT LINE ITEMS:');
    if (input.currentLineItems.length === 0 && input.currentUnresolvedItems.length === 0) {
      parts.push('(no current line items)');
    } else {
      for (const item of input.currentLineItems) {
        parts.push(`- ${item.productName} — qty: ${item.quantity}, price: $${item.unitPrice}`);
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
        parts.push(`- ${p.name} — $${p.unitPrice}${p.description ? ' — ' + p.description : ''}`);
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
      console.warn('[RevisionEngine] Failed to parse AI response');
      return {
        lineItems: input.currentLineItems,
        unresolvedItems: input.currentUnresolvedItems,
        revisionFailed: true,
      };
    }

    if (!parsed.lineItems || !Array.isArray(parsed.lineItems)) {
      console.warn('[RevisionEngine] AI response missing lineItems array');
      return {
        lineItems: input.currentLineItems,
        unresolvedItems: input.currentUnresolvedItems,
        revisionFailed: true,
      };
    }

    return this.validateAndPartition(parsed.lineItems, input.catalog);
  }

  private validateAndPartition(aiItems: AILineItem[], catalog: ProductCatalogEntry[]): RevisionOutput {
    // Build a name-based lookup (case-insensitive) for catalog matching.
    // Skip empty/whitespace names; on duplicate keys keep the first entry.
    const catalogByName = new Map<string, ProductCatalogEntry>();
    for (const c of catalog) {
      const key = c.name.trim().toLowerCase();
      if (key && !catalogByName.has(key)) {
        catalogByName.set(key, c);
      }
    }

    const lineItems: QuoteLineItem[] = [];
    const unresolvedItems: QuoteLineItem[] = [];

    for (const item of aiItems) {
      const score = Math.max(0, Math.min(100, Math.round(item.confidenceScore ?? 0)));
      const nameLower = (item.productName ?? '').trim().toLowerCase();
      const hasRules = Array.isArray(item.ruleIdsApplied) && item.ruleIdsApplied.length > 0;

      // Skip fuzzy matching for empty/blank product names
      if (!nameLower) {
        unresolvedItems.push({
          id: crypto.randomUUID(),
          productCatalogEntryId: null,
          productName: item.productName ?? '',
          description: item.description ?? '',
          quantity: Math.max(0, item.quantity ?? 1),
          unitPrice: Math.max(0, item.unitPrice ?? 0),
          confidenceScore: Math.min(score, CONFIDENCE_THRESHOLD - 1),
          originalText: item.originalText ?? '',
          resolved: false,
          unmatchedReason: 'Empty product name',
          ruleIdsApplied: sanitizeRuleIds(item.ruleIdsApplied),
        });
        continue;
      }

      // Try exact name match first
      let catalogEntry = catalogByName.get(nameLower);

      // Fuzzy fallback: prefer the closest length match
      if (!catalogEntry) {
        let bestMatch: ProductCatalogEntry | undefined;
        let bestDiff = Infinity;
        for (const [key, entry] of catalogByName) {
          if (key.includes(nameLower) || nameLower.includes(key)) {
            const diff = Math.abs(key.length - nameLower.length);
            if (diff < bestDiff) {
              bestMatch = entry;
              bestDiff = diff;
            }
          }
        }
        catalogEntry = bestMatch;
      }

      let finalItem: QuoteLineItem;

      if (catalogEntry) {
        // When rules were applied, the AI's values for description, quantity,
        // and unitPrice take precedence over catalog defaults. This allows
        // business rules to override any field on a line item.
        finalItem = {
          id: crypto.randomUUID(),
          productCatalogEntryId: catalogEntry.id,
          productName: catalogEntry.name,
          description: hasRules && item.description != null
            ? item.description
            : (catalogEntry.description ?? ''),
          quantity: Math.max(0, item.quantity ?? 1),
          unitPrice: hasRules && item.unitPrice != null
            ? Math.max(0, item.unitPrice)
            : Math.max(0, catalogEntry.unitPrice ?? item.unitPrice ?? 0),
          confidenceScore: score,
          originalText: item.originalText ?? '',
          resolved: score >= CONFIDENCE_THRESHOLD,
          unmatchedReason: score >= CONFIDENCE_THRESHOLD ? undefined : (item.unmatchedReason || 'Low confidence match'),
          ruleIdsApplied: sanitizeRuleIds(item.ruleIdsApplied),
        };
      } else {
        finalItem = {
          id: crypto.randomUUID(),
          productCatalogEntryId: null,
          productName: item.productName,
          description: item.description ?? '',
          quantity: Math.max(0, item.quantity ?? 1),
          unitPrice: Math.max(0, item.unitPrice ?? 0),
          confidenceScore: Math.min(score, CONFIDENCE_THRESHOLD - 1),
          originalText: item.originalText ?? '',
          resolved: false,
          unmatchedReason: item.unmatchedReason || 'No matching product found in catalog',
          ruleIdsApplied: sanitizeRuleIds(item.ruleIdsApplied),
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
}

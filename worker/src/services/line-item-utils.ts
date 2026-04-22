/**
 * Utility functions for post-processing AI-generated line items.
 */

/**
 * Merge duplicate line items that share the same product name (case-insensitive).
 *
 * When duplicates are found:
 * - Quantities are summed
 * - The higher confidence score is kept
 * - Rule IDs are merged (union, deduplicated)
 * - Original text is concatenated with "; "
 * - All other fields come from the first occurrence
 *
 * This runs as a post-validation step to catch cases where the AI
 * returns the same product multiple times despite prompt instructions.
 */
export function deduplicateLineItems<
  T extends {
    productName: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    confidenceScore: number;
    originalText: string;
    ruleIdsApplied?: string[];
  },
>(items: T[]): T[] {
  const seen = new Map<string, T>();
  const order: string[] = [];

  for (const item of items) {
    const key = item.productName.trim().toLowerCase();
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, { ...item });
      order.push(key);
      continue;
    }

    // Merge into the first occurrence
    const merged = { ...existing };
    merged.quantity = existing.quantity + item.quantity;
    merged.confidenceScore = Math.max(existing.confidenceScore, item.confidenceScore);

    // Merge original text
    if (item.originalText && item.originalText !== existing.originalText) {
      merged.originalText = existing.originalText
        ? `${existing.originalText}; ${item.originalText}`
        : item.originalText;
    }

    // Merge rule IDs (union, no duplicates)
    const existingRules = existing.ruleIdsApplied ?? [];
    const newRules = item.ruleIdsApplied ?? [];
    if (newRules.length > 0) {
      const ruleSet = new Set([...existingRules, ...newRules]);
      merged.ruleIdsApplied = [...ruleSet];
    }

    seen.set(key, merged);
  }

  // Preserve original insertion order
  return order.map((key) => seen.get(key)!);
}

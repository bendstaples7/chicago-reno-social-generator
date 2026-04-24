/**
 * Utility functions for post-processing AI-generated line items.
 */

/**
 * Merge duplicate line items that share the same product name (case-insensitive)
 * AND the same unit price.
 *
 * When duplicates are found:
 * - Quantities are summed
 * - The higher confidence score is kept
 * - Rule IDs are merged (union, deduplicated)
 * - Original text is concatenated with "; "
 * - All other fields come from the first occurrence
 *
 * Items with blank/empty productName are always treated as distinct and never
 * merged, since they represent unmatched or incomplete entries.
 *
 * Items with the same product name but different unitPrice are kept as separate
 * entries to avoid corrupting totals (e.g., rule-overridden pricing).
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
  let blankIndex = 0;

  for (const item of items) {
    const nameTrimmed = String(item.productName ?? '').trim().toLowerCase();

    // Blank product names are always distinct — use a unique key per item
    if (!nameTrimmed) {
      const uniqueKey = `__blank_${blankIndex++}`;
      seen.set(uniqueKey, { ...item });
      order.push(uniqueKey);
      continue;
    }

    // Include unitPrice in the merge key so items with different prices stay separate
    const key = `${nameTrimmed}::${item.unitPrice}`;
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

import type { ProductCatalogEntry } from 'shared';

/**
 * Sort line items by their catalog sort order.
 * Items whose product name matches a catalog entry are sorted by that entry's sortOrder.
 * Items without a catalog match keep their relative position (stable sort).
 * This ensures quotes follow the renovation workflow sequence.
 */
export function sortLineItemsByCatalog<
  T extends { productName: string },
>(items: T[], catalog: ProductCatalogEntry[]): T[] {
  // Build a name→sortOrder lookup (case-insensitive)
  const sortOrderByName = new Map<string, number>();
  for (const entry of catalog) {
    const key = entry.name.trim().toLowerCase();
    if (key && !sortOrderByName.has(key)) {
      sortOrderByName.set(key, entry.sortOrder ?? 500);
    }
  }

  // Stable sort: items with the same sort order keep their relative position
  const indexed = items.map((item, i) => ({ item, originalIndex: i }));
  indexed.sort((a, b) => {
    const aOrder = sortOrderByName.get(a.item.productName.trim().toLowerCase()) ?? 500;
    const bOrder = sortOrderByName.get(b.item.productName.trim().toLowerCase()) ?? 500;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.originalIndex - b.originalIndex; // stable
  });

  return indexed.map(({ item }) => item);
}

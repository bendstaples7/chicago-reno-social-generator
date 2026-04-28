/**
 * Bug Condition Exploration Tests — Rules Engine Match Mode
 *
 * Written BEFORE the fix. These tests FAIL on unfixed code (confirming the
 * bug exists) and will PASS after the fix is applied.
 *
 * Property 1: Bug Condition — Category Prefix Patterns Fail With Strict Equality
 *
 * The bug: evaluateCondition and executeAction use strict === equality when
 * comparing productNamePattern against line item product names. Category-prefix
 * patterns like "Framing" never match "Framing: Install new wall".
 *
 * Requirements: 1.1, 1.2, 1.3
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { evaluateCondition, executeAction } from '../../worker/src/services/rules-engine.js';
import type { EngineLineItem, ProductCatalogEntry } from '../../shared/src/types/quote.js';

// ═══════════════════════════════════════════════════════════════════════════
// Arbitraries — Generate (categoryPrefix, fullProductName) pairs where
// fullProductName starts with categoryPrefix but is NOT equal to it
// (the bug condition: isBugCondition(input) = true)
// ═══════════════════════════════════════════════════════════════════════════

/** Common category prefixes used in the product catalog */
const categoryPrefixes = [
  'Framing',
  'Drywall',
  'Electrical',
  'Plumbing',
  'Painting',
  'Flooring',
  'Roofing',
  'Insulation',
  'Demolition',
  'Trim',
  'Siding',
  'HVAC',
  'Concrete',
  'Landscaping',
  'Cabinetry',
];

/** Suffixes that follow the "Category: " pattern */
const descriptionSuffixes = [
  'Install new wall',
  'Remove existing',
  'Repair damaged section',
  'Run new line',
  'Replace fixture',
  'Installation of New Drywall',
  'Run New Light Switch',
  'Patch and Sand',
  'Full Room Installation',
  'Exterior Application',
  'Standard Repair',
  'Premium Upgrade',
];

/**
 * Arbitrary that generates a category prefix and a full product name
 * where the product name starts with the prefix but is not equal to it.
 * This is the bug condition: isBugCondition(input) = true.
 */
const arbBugConditionPair: fc.Arbitrary<{ categoryPrefix: string; fullProductName: string }> =
  fc.tuple(
    fc.constantFrom(...categoryPrefixes),
    fc.constantFrom(...descriptionSuffixes),
  ).map(([prefix, suffix]) => ({
    categoryPrefix: prefix,
    fullProductName: `${prefix}: ${suffix}`,
  }));

/**
 * Arbitrary that generates a random category prefix (alphanumeric, 2-20 chars)
 * and appends a separator + suffix to create a full product name.
 */
const arbRandomBugConditionPair: fc.Arbitrary<{ categoryPrefix: string; fullProductName: string }> =
  fc.tuple(
    fc.string({ minLength: 2, maxLength: 20, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')) }),
    fc.constantFrom(': ', ' - ', ' / ', ' '),
    fc.string({ minLength: 1, maxLength: 30, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')) }),
  ).map(([prefix, separator, suffix]) => ({
    categoryPrefix: prefix,
    fullProductName: `${prefix}${separator}${suffix}`,
  }));

/** Combined arbitrary using both realistic and random pairs */
const arbPrefixPair: fc.Arbitrary<{ categoryPrefix: string; fullProductName: string }> =
  fc.oneof(arbBugConditionPair, arbRandomBugConditionPair);

/** Helper to create a minimal EngineLineItem */
function makeLineItem(productName: string, id = 'li-1'): EngineLineItem {
  return {
    id,
    productCatalogEntryId: null,
    productName,
    description: 'Test item',
    quantity: 1,
    unitPrice: 100,
    confidenceScore: 100,
    originalText: '',
    ruleIdsApplied: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Property 1: Bug Condition — evaluateCondition with prefix patterns
//
// EXPECTED: Test FAILS on unfixed code (strict === rejects prefix patterns)
// This confirms the bug exists.
// ═══════════════════════════════════════════════════════════════════════════

describe('Property 1: Bug Condition — Category Prefix Patterns Fail With Strict Equality', () => {
  it('evaluateCondition with line_item_exists should match when productNamePattern is a prefix of the product name', () => {
    fc.assert(
      fc.property(arbPrefixPair, ({ categoryPrefix, fullProductName }) => {
        // Precondition: verify this is actually a bug condition
        // (fullProductName starts with categoryPrefix but is not equal)
        const normalizedName = fullProductName.toLowerCase();
        const normalizedPattern = categoryPrefix.toLowerCase();
        expect(normalizedName.startsWith(normalizedPattern)).toBe(true);
        expect(normalizedName).not.toBe(normalizedPattern);

        const lineItems: EngineLineItem[] = [makeLineItem(fullProductName)];

        const result = evaluateCondition(
          { type: 'line_item_exists', productNamePattern: categoryPrefix },
          lineItems,
        );

        // BUG: On unfixed code, strict === comparison means this returns
        // { matched: false, matchingLineItemIds: [] }
        // Expected behavior: prefix pattern should match
        expect(result.matched).toBe(true);
        expect(result.matchingLineItemIds).toContain('li-1');
      }),
      { numRuns: 100 },
    );
  });

  it('executeAction with set_quantity should modify line items when productNamePattern is a prefix of the product name', () => {
    fc.assert(
      fc.property(arbPrefixPair, ({ categoryPrefix, fullProductName }) => {
        // Precondition: verify this is actually a bug condition
        const normalizedName = fullProductName.toLowerCase();
        const normalizedPattern = categoryPrefix.toLowerCase();
        expect(normalizedName.startsWith(normalizedPattern)).toBe(true);
        expect(normalizedName).not.toBe(normalizedPattern);

        const lineItems: EngineLineItem[] = [makeLineItem(fullProductName)];
        const catalog: ProductCatalogEntry[] = [];

        const result = executeAction(
          { type: 'set_quantity', productNamePattern: categoryPrefix, quantity: 5 },
          lineItems,
          catalog,
          'test-rule-1',
          null,
        );

        // BUG: On unfixed code, strict === comparison means this returns
        // { modified: false, lineItems: [unchanged] }
        // Expected behavior: prefix pattern should match and set quantity to 5
        expect(result.modified).toBe(true);
        expect(result.lineItems[0].quantity).toBe(5);
      }),
      { numRuns: 100 },
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 2: Preservation — Exact Matches and Non-Pattern Conditions Unchanged
//
// These tests capture the CURRENT (unfixed) behavior that must be preserved
// after the fix is applied. They run on UNFIXED code and MUST PASS.
//
// Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
// ═══════════════════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// Arbitraries for preservation tests
// ---------------------------------------------------------------------------

/** Arbitrary for product names that follow the "Category: Description" convention */
const arbFullProductName: fc.Arbitrary<string> = fc.tuple(
  fc.constantFrom(...categoryPrefixes),
  fc.constantFrom(...descriptionSuffixes),
).map(([prefix, suffix]) => `${prefix}: ${suffix}`);

/** Arbitrary for random non-empty strings (used as substrings, patterns, etc.) */
const arbNonEmptyString: fc.Arbitrary<string> = fc.string({
  minLength: 1,
  maxLength: 30,
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 :-'.split('')),
});

/**
 * Arbitrary for patterns that do NOT match any product name in a given list
 * under any strategy (not a prefix, not a substring, not equal).
 * We achieve this by generating patterns with a unique prefix that can't appear
 * in any realistic product name.
 */
const arbNonMatchingPattern: fc.Arbitrary<string> = fc.string({
  minLength: 3,
  maxLength: 15,
  unit: fc.constantFrom(...'zyxwvutsrqponm'.split('')),
}).map((s) => `ZZNOCAT_${s}`);

/** Arbitrary for quantities (positive integers) */
const arbQuantity: fc.Arbitrary<number> = fc.integer({ min: 1, max: 100 });

/** Arbitrary for unit prices */
const arbUnitPrice: fc.Arbitrary<number> = fc.integer({ min: 1, max: 10000 });

/** Helper to create a line item with configurable fields */
function makeLineItemFull(
  productName: string,
  opts: { id?: string; quantity?: number; unitPrice?: number } = {},
): EngineLineItem {
  return {
    id: opts.id ?? 'li-1',
    productCatalogEntryId: null,
    productName,
    description: 'Test item',
    quantity: opts.quantity ?? 1,
    unitPrice: opts.unitPrice ?? 100,
    confidenceScore: 100,
    originalText: '',
    ruleIdsApplied: [],
  };
}

// ---------------------------------------------------------------------------
// Preservation Test: Exact full-name matches still work (Requirement 3.1)
// ---------------------------------------------------------------------------

describe('Property 2: Preservation — Exact Matches and Non-Pattern Conditions Unchanged', () => {
  describe('Exact full-name matches (Requirement 3.1)', () => {
    it('evaluateCondition with line_item_exists returns matched: true when pattern equals full product name (case-insensitive)', () => {
      fc.assert(
        fc.property(arbFullProductName, (productName) => {
          const lineItems: EngineLineItem[] = [makeLineItemFull(productName)];

          // Use the exact full product name as the pattern
          const result = evaluateCondition(
            { type: 'line_item_exists', productNamePattern: productName },
            lineItems,
          );

          expect(result.matched).toBe(true);
          expect(result.matchingLineItemIds).toContain('li-1');
        }),
        { numRuns: 100 },
      );
    });

    it('evaluateCondition with line_item_exists returns matched: true with case variation of full product name', () => {
      fc.assert(
        fc.property(
          arbFullProductName,
          fc.constantFrom('upper', 'lower', 'mixed') as fc.Arbitrary<'upper' | 'lower' | 'mixed'>,
          (productName, caseVariant) => {
            const lineItems: EngineLineItem[] = [makeLineItemFull(productName)];

            // Apply case variation to the pattern
            let pattern: string;
            switch (caseVariant) {
              case 'upper':
                pattern = productName.toUpperCase();
                break;
              case 'lower':
                pattern = productName.toLowerCase();
                break;
              case 'mixed':
                pattern = productName
                  .split('')
                  .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()))
                  .join('');
                break;
            }

            const result = evaluateCondition(
              { type: 'line_item_exists', productNamePattern: pattern },
              lineItems,
            );

            expect(result.matched).toBe(true);
            expect(result.matchingLineItemIds).toContain('li-1');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('evaluateCondition with line_item_not_exists returns matched: false when pattern equals full product name', () => {
      fc.assert(
        fc.property(arbFullProductName, (productName) => {
          const lineItems: EngineLineItem[] = [makeLineItemFull(productName)];

          const result = evaluateCondition(
            { type: 'line_item_not_exists', productNamePattern: productName },
            lineItems,
          );

          // The item exists, so "not exists" should be false
          expect(result.matched).toBe(false);
        }),
        { numRuns: 100 },
      );
    });

    it('evaluateCondition with line_item_quantity_gte returns matched: true when pattern equals full name and quantity meets threshold', () => {
      fc.assert(
        fc.property(
          arbFullProductName,
          fc.integer({ min: 1, max: 50 }),
          (productName, quantity) => {
            const lineItems: EngineLineItem[] = [
              makeLineItemFull(productName, { quantity }),
            ];

            const result = evaluateCondition(
              { type: 'line_item_quantity_gte', productNamePattern: productName, threshold: 1 },
              lineItems,
            );

            expect(result.matched).toBe(true);
            expect(result.matchingLineItemIds).toContain('li-1');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('evaluateCondition with line_item_quantity_lte returns matched: true when pattern equals full name and quantity meets threshold', () => {
      fc.assert(
        fc.property(
          arbFullProductName,
          fc.integer({ min: 1, max: 50 }),
          (productName, quantity) => {
            const lineItems: EngineLineItem[] = [
              makeLineItemFull(productName, { quantity }),
            ];

            const result = evaluateCondition(
              { type: 'line_item_quantity_lte', productNamePattern: productName, threshold: 100 },
              lineItems,
            );

            expect(result.matched).toBe(true);
            expect(result.matchingLineItemIds).toContain('li-1');
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Preservation Test: Non-matching patterns return matched: false (Requirement 3.2)
  // ---------------------------------------------------------------------------

  describe('Non-matching patterns (Requirement 3.2)', () => {
    it('evaluateCondition with line_item_exists returns matched: false when pattern does not match any product name', () => {
      fc.assert(
        fc.property(arbFullProductName, arbNonMatchingPattern, (productName, pattern) => {
          const lineItems: EngineLineItem[] = [makeLineItemFull(productName)];

          const result = evaluateCondition(
            { type: 'line_item_exists', productNamePattern: pattern },
            lineItems,
          );

          expect(result.matched).toBe(false);
          expect(result.matchingLineItemIds).toHaveLength(0);
        }),
        { numRuns: 100 },
      );
    });

    it('evaluateCondition with line_item_not_exists returns matched: true when pattern does not match any product name', () => {
      fc.assert(
        fc.property(arbFullProductName, arbNonMatchingPattern, (productName, pattern) => {
          const lineItems: EngineLineItem[] = [makeLineItemFull(productName)];

          const result = evaluateCondition(
            { type: 'line_item_not_exists', productNamePattern: pattern },
            lineItems,
          );

          expect(result.matched).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('executeAction with set_quantity produces no modification when pattern does not match any product name', () => {
      fc.assert(
        fc.property(
          arbFullProductName,
          arbNonMatchingPattern,
          arbQuantity,
          (productName, pattern, quantity) => {
            const lineItems: EngineLineItem[] = [makeLineItemFull(productName)];
            const catalog: ProductCatalogEntry[] = [];

            const result = executeAction(
              { type: 'set_quantity', productNamePattern: pattern, quantity },
              lineItems,
              catalog,
              'test-rule-1',
              null,
            );

            expect(result.modified).toBe(false);
            expect(result.lineItems[0].quantity).toBe(1); // unchanged
          },
        ),
        { numRuns: 100 },
      );
    });

    it('executeAction with remove_line_item produces no modification when pattern does not match any product name', () => {
      fc.assert(
        fc.property(arbFullProductName, arbNonMatchingPattern, (productName, pattern) => {
          const lineItems: EngineLineItem[] = [makeLineItemFull(productName)];
          const catalog: ProductCatalogEntry[] = [];

          const result = executeAction(
            { type: 'remove_line_item', productNamePattern: pattern },
            lineItems,
            catalog,
            'test-rule-1',
            null,
          );

          expect(result.modified).toBe(false);
          expect(result.lineItems).toHaveLength(1);
        }),
        { numRuns: 100 },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Preservation Test: line_item_name_contains uses substring field (Requirement 3.3)
  // ---------------------------------------------------------------------------

  describe('line_item_name_contains condition uses substring field (Requirement 3.3)', () => {
    it('evaluateCondition with line_item_name_contains matches when substring is found in product name', () => {
      fc.assert(
        fc.property(arbFullProductName, (productName) => {
          const lineItems: EngineLineItem[] = [makeLineItemFull(productName)];

          // Extract a substring from the product name (at least 3 chars)
          const lowerName = productName.toLowerCase();
          const start = Math.floor(lowerName.length / 4);
          const end = Math.min(start + 5, lowerName.length);
          const substring = productName.slice(start, end);

          const result = evaluateCondition(
            { type: 'line_item_name_contains', substring },
            lineItems,
          );

          expect(result.matched).toBe(true);
          expect(result.matchingLineItemIds).toContain('li-1');
        }),
        { numRuns: 100 },
      );
    });

    it('evaluateCondition with line_item_name_contains returns matched: false when substring is not in product name', () => {
      fc.assert(
        fc.property(arbFullProductName, arbNonMatchingPattern, (productName, substring) => {
          const lineItems: EngineLineItem[] = [makeLineItemFull(productName)];

          const result = evaluateCondition(
            { type: 'line_item_name_contains', substring },
            lineItems,
          );

          expect(result.matched).toBe(false);
          expect(result.matchingLineItemIds).toHaveLength(0);
        }),
        { numRuns: 100 },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Preservation Test: always condition returns matched: true (Requirement 3.3)
  // ---------------------------------------------------------------------------

  describe('always condition returns matched: true (Requirement 3.3)', () => {
    it('evaluateCondition with always returns matched: true regardless of line items', () => {
      fc.assert(
        fc.property(
          fc.array(arbFullProductName, { minLength: 0, maxLength: 5 }),
          (productNames) => {
            const lineItems: EngineLineItem[] = productNames.map((name, i) =>
              makeLineItemFull(name, { id: `li-${i}` }),
            );

            const result = evaluateCondition(
              { type: 'always' },
              lineItems,
            );

            expect(result.matched).toBe(true);
            expect(result.matchingLineItemIds).toHaveLength(lineItems.length);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Preservation Test: request_text_contains uses substring field (Requirement 3.3)
  // ---------------------------------------------------------------------------

  describe('request_text_contains condition uses substring field (Requirement 3.3)', () => {
    it('evaluateCondition with request_text_contains matches when substring is found in request text', () => {
      fc.assert(
        fc.property(
          arbNonEmptyString,
          arbFullProductName,
          (requestText, productName) => {
            // Ensure the request text has enough content to extract a substring
            fc.pre(requestText.length >= 3);

            const lineItems: EngineLineItem[] = [makeLineItemFull(productName)];
            const substring = requestText.slice(0, Math.min(3, requestText.length));

            const result = evaluateCondition(
              { type: 'request_text_contains', substring },
              lineItems,
              requestText,
            );

            // The substring is from the request text, so it should match
            expect(result.matched).toBe(true);
            expect(result.matchingLineItemIds).toContain('li-1');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('evaluateCondition with request_text_contains returns matched: false when substring is not in request text', () => {
      fc.assert(
        fc.property(
          arbNonEmptyString,
          arbFullProductName,
          arbNonMatchingPattern,
          (requestText, productName, substring) => {
            // Ensure the non-matching pattern is not accidentally in the request text
            fc.pre(!requestText.toLowerCase().includes(substring.toLowerCase()));

            const lineItems: EngineLineItem[] = [makeLineItemFull(productName)];

            const result = evaluateCondition(
              { type: 'request_text_contains', substring },
              lineItems,
              requestText,
            );

            expect(result.matched).toBe(false);
            expect(result.matchingLineItemIds).toHaveLength(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Preservation Test: add_line_item uses exact catalog lookup (Requirement 3.4)
  // ---------------------------------------------------------------------------

  describe('add_line_item action uses exact catalog lookup (Requirement 3.4)', () => {
    it('executeAction with add_line_item adds item when productName exactly matches catalog entry (case-insensitive)', () => {
      fc.assert(
        fc.property(
          arbFullProductName,
          arbQuantity,
          arbUnitPrice,
          (productName, quantity, unitPrice) => {
            const lineItems: EngineLineItem[] = []; // empty quote
            const catalog: ProductCatalogEntry[] = [
              {
                id: 'cat-1',
                name: productName,
                unitPrice: 50,
                description: 'Catalog item',
                source: 'jobber',
              },
            ];

            const result = executeAction(
              { type: 'add_line_item', productName, quantity, unitPrice },
              lineItems,
              catalog,
              'test-rule-1',
              null,
            );

            expect(result.modified).toBe(true);
            expect(result.lineItems).toHaveLength(1);
            expect(result.lineItems[0].productName).toBe(productName);
            expect(result.lineItems[0].quantity).toBe(quantity);
            expect(result.lineItems[0].unitPrice).toBe(unitPrice);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('executeAction with add_line_item returns modified: false when productName is not in catalog', () => {
      fc.assert(
        fc.property(
          arbFullProductName,
          arbNonMatchingPattern,
          arbQuantity,
          arbUnitPrice,
          (catalogName, nonMatchingName, quantity, unitPrice) => {
            const lineItems: EngineLineItem[] = [];
            const catalog: ProductCatalogEntry[] = [
              {
                id: 'cat-1',
                name: catalogName,
                unitPrice: 50,
                description: 'Catalog item',
                source: 'jobber',
              },
            ];

            const result = executeAction(
              { type: 'add_line_item', productName: nonMatchingName, quantity, unitPrice },
              lineItems,
              catalog,
              'test-rule-1',
              null,
            );

            // Product not found in catalog — should not add
            expect(result.modified).toBe(false);
            expect(result.lineItems).toHaveLength(0);
            expect(result.warning).toContain('not found in catalog');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('executeAction with add_line_item skips when product already exists on quote (duplicate guard)', () => {
      fc.assert(
        fc.property(
          arbFullProductName,
          arbQuantity,
          arbUnitPrice,
          (productName, quantity, unitPrice) => {
            // Line item already exists with this product name
            const lineItems: EngineLineItem[] = [makeLineItemFull(productName)];
            const catalog: ProductCatalogEntry[] = [
              {
                id: 'cat-1',
                name: productName,
                unitPrice: 50,
                description: 'Catalog item',
                source: 'jobber',
              },
            ];

            const result = executeAction(
              { type: 'add_line_item', productName, quantity, unitPrice },
              lineItems,
              catalog,
              'test-rule-1',
              null,
            );

            // Duplicate guard — should not add
            expect(result.modified).toBe(false);
            expect(result.lineItems).toHaveLength(1);
            expect(result.warning).toContain('already exists');
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Preservation Test: executeAction with exact full-name patterns (Requirement 3.1)
  // ---------------------------------------------------------------------------

  describe('executeAction with exact full-name patterns (Requirement 3.1)', () => {
    it('executeAction with set_quantity modifies line item when pattern equals full product name', () => {
      fc.assert(
        fc.property(
          arbFullProductName,
          arbQuantity,
          (productName, newQuantity) => {
            const lineItems: EngineLineItem[] = [makeLineItemFull(productName)];
            const catalog: ProductCatalogEntry[] = [];

            const result = executeAction(
              { type: 'set_quantity', productNamePattern: productName, quantity: newQuantity },
              lineItems,
              catalog,
              'test-rule-1',
              null,
            );

            expect(result.modified).toBe(true);
            expect(result.lineItems[0].quantity).toBe(newQuantity);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('executeAction with remove_line_item removes line item when pattern equals full product name', () => {
      fc.assert(
        fc.property(arbFullProductName, (productName) => {
          const lineItems: EngineLineItem[] = [makeLineItemFull(productName)];
          const catalog: ProductCatalogEntry[] = [];

          const result = executeAction(
            { type: 'remove_line_item', productNamePattern: productName },
            lineItems,
            catalog,
            'test-rule-1',
            null,
          );

          expect(result.modified).toBe(true);
          expect(result.lineItems).toHaveLength(0);
        }),
        { numRuns: 100 },
      );
    });

    it('executeAction with set_unit_price modifies line item when pattern equals full product name', () => {
      fc.assert(
        fc.property(
          arbFullProductName,
          arbUnitPrice,
          (productName, newPrice) => {
            const lineItems: EngineLineItem[] = [makeLineItemFull(productName)];
            const catalog: ProductCatalogEntry[] = [];

            const result = executeAction(
              { type: 'set_unit_price', productNamePattern: productName, unitPrice: newPrice },
              lineItems,
              catalog,
              'test-rule-1',
              null,
            );

            expect(result.modified).toBe(true);
            expect(result.lineItems[0].unitPrice).toBe(newPrice);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});

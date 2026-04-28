# Rules Engine Match Mode Bugfix Design

## Overview

The rules engine in `worker/src/services/rules-engine.ts` uses strict exact equality (`===`) when comparing `productNamePattern` values against line item product names. Since product names follow a "Category: Specific Description" convention (e.g., "Framing: Install new wall"), category-based rules like `productNamePattern: "Framing"` never match. The fix introduces an optional `matchMode` field (`"exact" | "starts_with" | "contains"`) defaulting to `"starts_with"`, and a shared helper function that both condition evaluation and action execution use for pattern matching.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — when a `productNamePattern` is a proper prefix of a line item's product name (i.e., a category-level pattern) and the engine's strict equality comparison fails to match
- **Property (P)**: The desired behavior — category prefix patterns match line items whose product names start with the pattern (case-insensitive)
- **Preservation**: Existing behavior that must remain unchanged — exact full-name matches continue to work, non-`productNamePattern` conditions are unaffected, `add_line_item` catalog lookup is unaffected, engine iteration/convergence logic is unaffected
- **`evaluateCondition`**: The function in `worker/src/services/rules-engine.ts` that checks whether a rule's condition is satisfied against the current line items
- **`executeAction`**: The function in `worker/src/services/rules-engine.ts` that applies a rule's action to matching line items
- **`matchMode`**: The new optional field on conditions/actions that controls how `productNamePattern` is compared: `"exact"` (strict equality), `"starts_with"` (prefix match, default), or `"contains"` (substring match)

## Bug Details

### Bug Condition

The bug manifests when a user creates a rule with a `productNamePattern` that is a category prefix of actual line item product names. The `evaluateCondition` and `executeAction` functions use strict equality (`li.productName.toLowerCase() === pattern`) which fails for prefix-style patterns like `"Framing"` when the actual product name is `"Framing: Install new wall"`.

**Formal Specification:**
```text
FUNCTION isBugCondition(input)
  INPUT: input of type { productNamePattern: string, lineItemProductName: string }
  OUTPUT: boolean

  LET normalizedPattern = LOWERCASE(input.productNamePattern)
  LET normalizedName = LOWERCASE(input.lineItemProductName)

  RETURN STARTS_WITH(normalizedName, normalizedPattern)
         AND normalizedName ≠ normalizedPattern
END FUNCTION
```

### Examples

- Pattern `"Framing"` vs product name `"Framing: Install new wall"` → **Current**: no match (strict equality fails). **Expected**: match (prefix match succeeds)
- Pattern `"Drywall"` vs product name `"Drywall: Installation of New Drywall"` → **Current**: no match. **Expected**: match
- Pattern `"Electrical"` vs product name `"Electrical: Run New Light Switch"` → **Current**: no match. **Expected**: match
- Pattern `"Framing: Install new wall"` vs product name `"Framing: Install new wall"` → **Current**: match. **Expected**: match (exact match still works under all modes)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Exact full-name matches continue to work regardless of `matchMode` setting (a pattern equal to the full product name always matches)
- Condition types `line_item_name_contains`, `request_text_contains`, and `always` continue to use their existing logic (they don't use `productNamePattern`)
- The `add_line_item` action continues to use exact catalog name matching for its `productName` field (not `productNamePattern`)
- Engine iteration, convergence detection, and duplicate-application tracking remain identical
- The `set_customer_note` and `append_customer_note` actions remain unaffected (they don't use `productNamePattern`)
- Validation continues to reject unknown condition/action types and missing required fields

**Scope:**
All inputs that do NOT involve `productNamePattern` matching should be completely unaffected by this fix. This includes:
- Conditions using `substring` field (`line_item_name_contains`, `request_text_contains`)
- The `always` condition type
- The `add_line_item` action (uses `productName` for catalog lookup)
- Customer note actions (`set_customer_note`, `append_customer_note`)
- Engine-level iteration and convergence logic

## Hypothesized Root Cause

Based on the bug description, the root cause is straightforward:

1. **Strict Equality in Condition Evaluation**: In `evaluateCondition`, conditions `line_item_exists`, `line_item_not_exists`, `line_item_quantity_gte`, and `line_item_quantity_lte` all use `li.productName.toLowerCase() === pattern` which requires the pattern to be the complete product name

2. **Strict Equality in Action Execution**: In `executeAction`, actions `remove_line_item`, `move_line_item`, `set_quantity`, `adjust_quantity`, `set_unit_price`, `set_description`, `append_description`, and `extract_request_context` all use `li.productName.toLowerCase() === pattern` for the same reason

3. **No Matching Mode Abstraction**: There is no shared helper function for pattern matching — each condition/action case inlines its own comparison, making it impossible to support multiple matching strategies without modifying every case

4. **Type Definitions Lack `matchMode`**: The `RuleCondition` and `RuleAction` union types in `shared/src/types/quote.ts` do not include a `matchMode` field, so there's no way to express the desired matching behavior in the type system

## Correctness Properties

Property 1: Bug Condition - Category Prefix Patterns Match With Default Mode

_For any_ input where the `productNamePattern` is a proper prefix of a line item's product name (isBugCondition returns true) and no explicit `matchMode` is set, the fixed `evaluateCondition` function SHALL match that line item, returning `matched: true` with the line item's ID in `matchingLineItemIds`.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation - Exact Full-Name Matches and Non-Pattern Conditions Unchanged

_For any_ input where the bug condition does NOT hold (pattern equals the full product name, or pattern doesn't match under any strategy, or the condition/action doesn't use `productNamePattern`), the fixed functions SHALL produce the same result as the original functions, preserving all existing matching behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

Property 3: Match Mode Exact - Strict Equality When Explicitly Requested

_For any_ input where `matchMode` is explicitly set to `"exact"`, the fixed functions SHALL use strict case-insensitive equality (the original behavior), matching only when the pattern equals the full product name.

**Validates: Requirements 2.3**

Property 4: Match Mode Contains - Substring Matching

_For any_ input where `matchMode` is explicitly set to `"contains"`, the fixed functions SHALL match any line item whose product name contains the pattern as a case-insensitive substring.

**Validates: Requirements 2.4**

Property 5: Validation - matchMode Field Acceptance and Rejection

_For any_ condition or action with a `matchMode` value, `validateCondition`/`validateAction` SHALL accept valid values (`"exact"`, `"starts_with"`, `"contains"`) and reject invalid values with an appropriate error message.

**Validates: Requirements 2.5, 2.6, 2.7**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `shared/src/types/quote.ts`

**Changes**:
1. **Add `MatchMode` type alias**: `export type MatchMode = 'exact' | 'starts_with' | 'contains';`
2. **Add `matchMode?: MatchMode` to condition types that use `productNamePattern`**:
   - `line_item_exists`
   - `line_item_not_exists`
   - `line_item_quantity_gte`
   - `line_item_quantity_lte`
3. **Add `matchMode?: MatchMode` to action types that use `productNamePattern`**:
   - `remove_line_item`
   - `move_line_item`
   - `set_quantity`
   - `adjust_quantity`
   - `set_unit_price`
   - `set_description`
   - `append_description`
   - `extract_request_context`

---

**File**: `worker/src/services/rules-engine.ts`

**Function**: New helper `matchesProductName`

**Specific Changes**:

1. **Add a shared helper function** at the top of the file (after imports):
   ```typescript
   function matchesProductName(
     productName: string,
     pattern: string,
     matchMode: 'exact' | 'starts_with' | 'contains' = 'starts_with',
   ): boolean {
     const normalizedName = productName.toLowerCase();
     const normalizedPattern = pattern.toLowerCase();
     switch (matchMode) {
       case 'exact':
         return normalizedName === normalizedPattern;
       case 'starts_with':
         return normalizedName.startsWith(normalizedPattern);
       case 'contains':
         return normalizedName.includes(normalizedPattern);
       default:
         return normalizedName.startsWith(normalizedPattern);
     }
   }
   ```

2. **Update `evaluateCondition`** — replace strict equality with `matchesProductName` calls:
   - `line_item_exists`: replace `li.productName.toLowerCase() === pattern` with `matchesProductName(li.productName, condition.productNamePattern, condition.matchMode)`
   - `line_item_not_exists`: same transformation
   - `line_item_quantity_gte`: same transformation (keep threshold check)
   - `line_item_quantity_lte`: same transformation (keep threshold check)

3. **Update `executeAction`** — replace strict equality with `matchesProductName` calls:
   - `remove_line_item`: both filter calls use `matchesProductName(li.productName, action.productNamePattern, action.matchMode)`
   - `move_line_item`: filter calls for `toMove` and `remaining` use the helper; position target lookups (`before:` / `after:`) remain exact (they reference specific product names, not patterns)
   - `set_quantity`: map comparison uses the helper
   - `adjust_quantity`: map comparison uses the helper
   - `set_unit_price`: map comparison uses the helper
   - `set_description`: map comparison uses the helper
   - `append_description`: map comparison uses the helper; also update the afterSnapshot filter
   - `extract_request_context`: filter comparison uses the helper

4. **Update `validateCondition`** — add `matchMode` validation for condition types that use `productNamePattern`:
   - After validating `productNamePattern`, check if `cond.matchMode` is present
   - If present and not one of `"exact"`, `"starts_with"`, `"contains"`, return `{ valid: false, error: 'matchMode must be "exact", "starts_with", or "contains"' }`

5. **Update `validateAction`** — add `matchMode` validation for action types that use `productNamePattern`:
   - Same pattern as conditions: validate `matchMode` if present on `remove_line_item`, `move_line_item`, `set_quantity`, `adjust_quantity`, `set_unit_price`, `set_description`, `append_description`, `extract_request_context`

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that create line items with "Category: Description" product names and rules with category-only `productNamePattern` values. Run `evaluateCondition` and `executeAction` on the UNFIXED code to observe that they fail to match.

**Test Cases**:
1. **Condition line_item_exists with prefix pattern**: Create a line item `"Framing: Install new wall"` and evaluate condition `{ type: "line_item_exists", productNamePattern: "Framing" }` — will return `matched: false` on unfixed code
2. **Condition line_item_quantity_gte with prefix pattern**: Create a line item `"Drywall: Installation"` with quantity 5 and evaluate `{ type: "line_item_quantity_gte", productNamePattern: "Drywall", threshold: 3 }` — will return `matched: false` on unfixed code
3. **Action set_quantity with prefix pattern**: Execute `{ type: "set_quantity", productNamePattern: "Electrical", quantity: 2 }` against line item `"Electrical: Run New Light Switch"` — will produce no modification on unfixed code
4. **Action remove_line_item with prefix pattern**: Execute `{ type: "remove_line_item", productNamePattern: "Framing" }` against line item `"Framing: Install new wall"` — will produce no modification on unfixed code

**Expected Counterexamples**:
- `evaluateCondition` returns `{ matched: false, matchingLineItemIds: [] }` for prefix patterns
- `executeAction` returns `{ modified: false, lineItems: [unchanged] }` for prefix patterns
- Root cause confirmed: strict `===` comparison in all `productNamePattern` usages

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```text
FOR ALL input WHERE isBugCondition(input) DO
  // Default matchMode is "starts_with"
  conditionResult := evaluateCondition'(
    { type: "line_item_exists", productNamePattern: input.productNamePattern },
    [{ productName: input.lineItemProductName, ... }]
  )
  ASSERT conditionResult.matched = true
  ASSERT conditionResult.matchingLineItemIds CONTAINS lineItem.id
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```text
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT evaluateCondition(input) = evaluateCondition'(input)
  ASSERT executeAction(input) = executeAction'(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain (random product names, patterns, condition types)
- It catches edge cases that manual unit tests might miss (empty strings, special characters, unicode)
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for exact-match patterns and non-`productNamePattern` conditions, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Exact Match Preservation**: Generate random product names, use the full name as `productNamePattern` — verify `evaluateCondition` and `executeAction` produce identical results before and after fix
2. **Non-Matching Pattern Preservation**: Generate random patterns that are NOT prefixes of any line item product name — verify both functions return no-match/no-modification identically
3. **Non-productNamePattern Condition Preservation**: Generate `line_item_name_contains`, `request_text_contains`, and `always` conditions — verify results are identical before and after fix
4. **add_line_item Preservation**: Generate `add_line_item` actions — verify catalog lookup behavior is unchanged

### Unit Tests

- Test `matchesProductName` helper with all three modes and edge cases (empty string, case variations, special characters)
- Test `evaluateCondition` with each condition type using prefix patterns (default `starts_with`)
- Test `evaluateCondition` with explicit `matchMode: "exact"` to verify opt-in strict behavior
- Test `evaluateCondition` with explicit `matchMode: "contains"` for substring matching
- Test `executeAction` for each action type with prefix patterns
- Test `validateCondition` accepts valid `matchMode` values and rejects invalid ones
- Test `validateAction` accepts valid `matchMode` values and rejects invalid ones

### Property-Based Tests

- Generate random `(productName, pattern)` pairs where `productName.startsWith(pattern)` and verify `matchesProductName` returns true with `"starts_with"` mode
- Generate random `(productName, pattern)` pairs and verify `matchesProductName("exact")` returns true only when they're equal (case-insensitive)
- Generate random conditions/actions without `productNamePattern` and verify engine behavior is unchanged
- Generate random line item lists and rules with exact-match patterns, verify results match original engine behavior

### Integration Tests

- Test full `executeRules` with a multi-rule scenario using category prefix patterns — verify rules fire and produce expected line item modifications
- Test `executeRules` with mixed `matchMode` values across rules — verify each rule uses its own mode correctly
- Test convergence behavior with prefix-matching rules — verify iteration tracking and duplicate-application prevention still work
- Test that existing rules without `matchMode` field work correctly with the `"starts_with"` default (backward compatibility)

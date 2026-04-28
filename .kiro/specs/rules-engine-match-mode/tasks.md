# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Category Prefix Patterns Fail With Strict Equality
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Generate `(productNamePattern, lineItemProductName)` pairs where `lineItemProductName` starts with `productNamePattern` but is not equal (the bug condition from design: `isBugCondition(input)`)
  - Test file: `tests/property/rules-engine-match-mode.property.test.ts`
  - Import `evaluateCondition` and `executeAction` from `worker/src/services/rules-engine.ts` (they are not currently exported — use structural testing or re-export for testing)
  - Generate category prefix patterns (e.g., `"Framing"`) and full product names (e.g., `"Framing: Install new wall"`) using fast-check
  - Test `evaluateCondition` with `{ type: "line_item_exists", productNamePattern }` against line items with the full product name — assert `matched: true` and `matchingLineItemIds` contains the line item ID
  - Test `executeAction` with `{ type: "set_quantity", productNamePattern, quantity: 5 }` against line items with the full product name — assert `modified: true`
  - Use minimum 100 fast-check iterations (`{ numRuns: 100 }`)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct — it proves the bug exists: strict `===` comparison rejects prefix patterns)
  - Document counterexamples found (e.g., `evaluateCondition({ type: "line_item_exists", productNamePattern: "Framing" }, [{ productName: "Framing: Install new wall" }])` returns `{ matched: false }`)
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Exact Matches and Non-Pattern Conditions Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Test file: `tests/property/rules-engine-match-mode.property.test.ts` (same file as task 1)
  - **Observation phase** — run UNFIXED code and record behavior:
    - Observe: `evaluateCondition({ type: "line_item_exists", productNamePattern: "Framing: Install new wall" }, [{ productName: "Framing: Install new wall" }])` returns `{ matched: true }` on unfixed code
    - Observe: `evaluateCondition({ type: "line_item_name_contains", substring: "wall" }, [...])` uses existing substring logic on unfixed code
    - Observe: `evaluateCondition({ type: "always" }, [...])` returns `{ matched: true }` on unfixed code
    - Observe: `evaluateCondition({ type: "request_text_contains", substring: "framing" }, [...])` uses existing substring logic on unfixed code
    - Observe: `executeAction({ type: "add_line_item", productName: "Framing: Install new wall", ... }, [...], catalog)` uses exact catalog lookup on unfixed code
  - **Property tests** — write property-based tests capturing observed behavior:
    - For all exact full-name matches (pattern === productName, case-insensitive): `evaluateCondition` returns `matched: true` — verify this holds on unfixed code
    - For all non-matching patterns (pattern is NOT a prefix/substring/equal to any product name): `evaluateCondition` returns `matched: false` — verify this holds on unfixed code
    - For all `line_item_name_contains` conditions: behavior uses `substring` field, not `productNamePattern` — verify unchanged on unfixed code
    - For all `always` conditions: always returns `matched: true` — verify unchanged on unfixed code
    - For all `request_text_contains` conditions: behavior uses `substring` field — verify unchanged on unfixed code
    - For `add_line_item` actions: catalog lookup uses exact `productName` match — verify unchanged on unfixed code
  - Use minimum 100 fast-check iterations (`{ numRuns: 100 }`)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Fix for productNamePattern strict equality matching

  - [x] 3.1 Add MatchMode type and matchMode field to shared types
    - In `shared/src/types/quote.ts`:
    - Add `export type MatchMode = 'exact' | 'starts_with' | 'contains';` after the `TriggerMode` type
    - Add `matchMode?: MatchMode` to `RuleCondition` union members that use `productNamePattern`: `line_item_exists`, `line_item_not_exists`, `line_item_quantity_gte`, `line_item_quantity_lte`
    - Add `matchMode?: MatchMode` to `RuleAction` union members that use `productNamePattern`: `remove_line_item`, `move_line_item`, `set_quantity`, `adjust_quantity`, `set_unit_price`, `set_description`, `append_description`, `extract_request_context`
    - Do NOT add `matchMode` to `add_line_item` (uses `productName` for catalog lookup, not pattern matching)
    - Do NOT add `matchMode` to `set_customer_note` or `append_customer_note` (no `productNamePattern`)
    - Rebuild shared types: `npm run build --workspace=shared`
    - _Bug_Condition: isBugCondition(input) where productNamePattern is a proper prefix of lineItemProductName_
    - _Expected_Behavior: matchMode field enables "starts_with" (default), "exact", and "contains" matching_
    - _Preservation: add_line_item, set_customer_note, append_customer_note types unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 3.2 Add matchesProductName helper function to rules-engine.ts
    - In `worker/src/services/rules-engine.ts`, add a new helper function after the imports and before `validateCondition`:
    - ```typescript
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
    - _Bug_Condition: This helper replaces the inline `=== pattern` comparisons that cause the bug_
    - _Expected_Behavior: Default mode is "starts_with" so category prefixes match without explicit matchMode_
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.3 Update evaluateCondition to use matchesProductName helper
    - In `evaluateCondition` function, replace strict equality with `matchesProductName` calls for 4 condition types:
    - `line_item_exists`: replace `li.productName.toLowerCase() === pattern` with `matchesProductName(li.productName, condition.productNamePattern, condition.matchMode)`
    - `line_item_not_exists`: replace `li.productName.toLowerCase() === pattern` (in `lineItems.some(...)`) with `matchesProductName(li.productName, condition.productNamePattern, condition.matchMode)`
    - `line_item_quantity_gte`: replace `li.productName.toLowerCase() === pattern` with `matchesProductName(li.productName, condition.productNamePattern, condition.matchMode)` (keep `&& li.quantity >= condition.threshold`)
    - `line_item_quantity_lte`: replace `li.productName.toLowerCase() === pattern` with `matchesProductName(li.productName, condition.productNamePattern, condition.matchMode)` (keep `&& li.quantity <= condition.threshold`)
    - Remove the now-unused `const pattern = condition.productNamePattern.toLowerCase()` lines in each case
    - Do NOT modify `line_item_name_contains`, `request_text_contains`, or `always` cases
    - _Bug_Condition: isBugCondition(input) — strict === in these 4 condition types causes prefix patterns to fail_
    - _Expected_Behavior: matchesProductName with default "starts_with" mode matches category prefixes_
    - _Preservation: line_item_name_contains, request_text_contains, always conditions unchanged_
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 3.3_

  - [x] 3.4 Update executeAction to use matchesProductName helper for 8 action types
    - In `executeAction` function, replace strict equality with `matchesProductName` calls:
    - `remove_line_item`: replace both `li.productName.toLowerCase() === pattern` (filter for `toRemove` and filter for `updated`) with `matchesProductName(li.productName, action.productNamePattern, action.matchMode)` / `!matchesProductName(...)`
    - `move_line_item`: replace `li.productName.toLowerCase() === pattern` for `toMove` filter and `remaining` filter with `matchesProductName` / `!matchesProductName`; keep position target lookups (`before:` / `after:`) as exact matching (they reference specific product names, not patterns)
    - `set_quantity`: replace `li.productName.toLowerCase() === pattern` in map and afterSnapshot filter with `matchesProductName`
    - `adjust_quantity`: replace `li.productName.toLowerCase() === pattern` in map and afterSnapshot filter with `matchesProductName`
    - `set_unit_price`: replace `li.productName.toLowerCase() === pattern` in map and afterSnapshot filter with `matchesProductName`
    - `set_description`: replace `li.productName.toLowerCase() === pattern` in map and afterSnapshot filter with `matchesProductName`
    - `append_description`: replace `li.productName.toLowerCase() === pattern` in map and afterSnapshot filter with `matchesProductName`
    - `extract_request_context`: replace `li.productName.toLowerCase() === pattern` in filter with `matchesProductName`
    - Remove the now-unused `const pattern = action.productNamePattern.toLowerCase()` lines in each case
    - Do NOT modify `add_line_item` (uses `productName` for catalog lookup — exact match is correct)
    - Do NOT modify `set_customer_note` or `append_customer_note` (no `productNamePattern`)
    - _Bug_Condition: isBugCondition(input) — strict === in these 8 action types causes prefix patterns to have no effect_
    - _Expected_Behavior: matchesProductName with default "starts_with" mode applies actions to category-matched items_
    - _Preservation: add_line_item catalog lookup unchanged; set_customer_note/append_customer_note unchanged; move_line_item position targets (before:/after:) remain exact_
    - _Requirements: 1.2, 2.1, 2.2, 2.3, 2.4, 3.4_

  - [x] 3.5 Update validateCondition and validateAction for matchMode validation
    - In `validateCondition`: for condition types that use `productNamePattern` (`line_item_exists`, `line_item_not_exists`, `line_item_quantity_gte`, `line_item_quantity_lte`), add matchMode validation after the existing field checks:
      ```typescript
      if (cond.matchMode !== undefined) {
        if (cond.matchMode !== 'exact' && cond.matchMode !== 'starts_with' && cond.matchMode !== 'contains') {
          return { valid: false, error: 'matchMode must be "exact", "starts_with", or "contains"' };
        }
      }
      ```
    - In `validateAction`: for action types that use `productNamePattern` (`remove_line_item`, `move_line_item`, `set_quantity`, `adjust_quantity`, `set_unit_price`, `set_description`, `append_description`, `extract_request_context`), add the same matchMode validation after existing field checks
    - Do NOT add matchMode validation to `add_line_item`, `set_customer_note`, or `append_customer_note`
    - _Bug_Condition: N/A (validation enhancement)_
    - _Expected_Behavior: Valid matchMode values accepted; invalid values rejected with error message_
    - _Preservation: Existing validation for all other fields unchanged; conditions/actions without matchMode still pass validation_
    - _Requirements: 2.5, 2.6, 2.7_

  - [x] 3.6 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Category Prefix Patterns Match With Default Mode
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior (prefix patterns should match with default `"starts_with"` mode)
    - When this test passes, it confirms the expected behavior is satisfied
    - Run: `npx vitest run tests/property/rules-engine-match-mode.property.test.ts`
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed — category prefix patterns now match)
    - _Requirements: 2.1, 2.2_

  - [x] 3.7 Verify preservation tests still pass
    - **Property 2: Preservation** - Exact Matches and Non-Pattern Conditions Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions — exact matches, non-pattern conditions, add_line_item catalog lookup, engine iteration all unchanged)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint - Ensure all tests pass
  - Run full test suite: `npm test`
  - Ensure all property tests in `tests/property/rules-engine-match-mode.property.test.ts` pass
  - Ensure all existing unit tests still pass (no regressions in other test files)
  - Ensure shared types build cleanly: `npm run build --workspace=shared`
  - Ask the user if questions arise

# Bugfix Requirements Document

## Introduction

The rules engine's `productNamePattern` matching in `worker/src/services/rules-engine.ts` uses strict exact equality (`===`) when comparing patterns against line item product names. Product names in the catalog follow a "Category: Specific Description" convention (e.g., "Framing: Install new wall", "Drywall: Installation of New Drywall", "Electrical: Run New Light Switch"). When a user creates a rule targeting a product category — such as `productNamePattern: "Framing"` — the rule never matches any line items because `"framing: install new wall" === "framing"` evaluates to `false`. This renders category-based rules completely non-functional, which is the most common and intuitive way users write rules.

The approved fix adds an optional `matchMode` field (`"exact" | "starts_with" | "contains"`) to all condition and action types that use `productNamePattern`, defaulting to `"starts_with"` so category-based matching works without extra configuration.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a rule condition (`line_item_exists`, `line_item_not_exists`, `line_item_quantity_gte`, or `line_item_quantity_lte`) has a `productNamePattern` that is a category prefix of an actual line item's product name (e.g., pattern `"Framing"` vs product name `"Framing: Install new wall"`) THEN the condition evaluates to `matched: false` because the engine uses strict equality (`===`) comparison

1.2 WHEN a rule action (`set_description`, `append_description`, `extract_request_context`, `set_quantity`, `adjust_quantity`, `set_unit_price`, `remove_line_item`, or `move_line_item`) has a `productNamePattern` that is a category prefix of an actual line item's product name THEN the action finds no matching line items and produces no effect because the engine uses strict equality (`===`) comparison

1.3 WHEN a user wants to write a rule that targets all line items in a category (e.g., all "Framing" products) THEN there is no way to express this intent because the only matching behavior available is exact full-name equality

### Expected Behavior (Correct)

2.1 WHEN a rule condition or action has a `productNamePattern` and no `matchMode` is specified THEN the system SHALL default to `"starts_with"` matching, where the pattern is compared as a case-insensitive prefix of the product name (e.g., pattern `"Framing"` matches `"Framing: Install new wall"`)

2.2 WHEN a rule condition or action has `matchMode: "starts_with"` THEN the system SHALL match any line item whose product name starts with the pattern (case-insensitive), so pattern `"Framing"` matches `"Framing: Install new wall"` and `"Framing: Remove existing wall"`

2.3 WHEN a rule condition or action has `matchMode: "exact"` THEN the system SHALL match only line items whose product name is exactly equal to the pattern (case-insensitive), preserving the current strict equality behavior for users who need it

2.4 WHEN a rule condition or action has `matchMode: "contains"` THEN the system SHALL match any line item whose product name contains the pattern as a substring (case-insensitive), so pattern `"Install"` matches `"Framing: Install new wall"` and `"Drywall: Installation of New Drywall"`

2.5 WHEN `validateCondition` is called with a condition that includes a valid `matchMode` value (`"exact"`, `"starts_with"`, or `"contains"`) THEN the system SHALL accept the condition as valid

2.6 WHEN `validateAction` is called with an action that includes a valid `matchMode` value (`"exact"`, `"starts_with"`, or `"contains"`) THEN the system SHALL accept the action as valid

2.7 WHEN `validateCondition` or `validateAction` is called with an invalid `matchMode` value (not one of `"exact"`, `"starts_with"`, `"contains"`) THEN the system SHALL return a validation error

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a rule condition or action has a `productNamePattern` that exactly matches a line item's full product name (e.g., pattern `"Framing: Install new wall"` vs product name `"Framing: Install new wall"`) THEN the system SHALL CONTINUE TO match that line item regardless of `matchMode` setting

3.2 WHEN a rule condition or action has a `productNamePattern` that does not match any line item's product name under any matching strategy THEN the system SHALL CONTINUE TO evaluate the condition as `matched: false` or produce no action effect

3.3 WHEN condition types `line_item_name_contains`, `request_text_contains`, or `always` are used (which do not use `productNamePattern`) THEN the system SHALL CONTINUE TO evaluate them with their existing logic, unaffected by the `matchMode` feature

3.4 WHEN the `add_line_item` action type is used (which uses `productName` for catalog lookup, not `productNamePattern` for line item matching) THEN the system SHALL CONTINUE TO use exact catalog name matching, unaffected by the `matchMode` feature

3.5 WHEN no `matchMode` field is present on existing rules stored in the database THEN the system SHALL CONTINUE TO process those rules without error by applying the `"starts_with"` default

3.6 WHEN the rules engine iterates through multiple rules with convergence checking THEN the system SHALL CONTINUE TO track applied rule-lineItem pairs and enforce the max iteration limit identically to current behavior

---

## Bug Condition Derivation

### Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type { productNamePattern: string, lineItemProductName: string }
  OUTPUT: boolean

  // The bug triggers when the pattern is a proper prefix of the product name
  // (i.e., the product name starts with the pattern but is not exactly equal)
  LET normalizedPattern = LOWERCASE(X.productNamePattern)
  LET normalizedName = LOWERCASE(X.lineItemProductName)

  RETURN STARTS_WITH(normalizedName, normalizedPattern)
         AND normalizedName ≠ normalizedPattern
END FUNCTION
```

### Fix Checking Property

```pascal
// Property: Fix Checking — Category prefix patterns now match
FOR ALL X WHERE isBugCondition(X) DO
  // With default matchMode ("starts_with"), the condition should match
  conditionResult ← evaluateCondition'(
    { type: "line_item_exists", productNamePattern: X.productNamePattern },
    [{ productName: X.lineItemProductName, ... }]
  )
  ASSERT conditionResult.matched = true
END FOR
```

### Preservation Checking Property

```pascal
// Property: Preservation Checking — Exact matches still work
FOR ALL X WHERE NOT isBugCondition(X) DO
  // When pattern equals the full product name, behavior is unchanged
  // When pattern doesn't match at all, behavior is unchanged
  ASSERT evaluateCondition(X) = evaluateCondition'(X)
END FOR
```

**Key Definitions:**
- **F**: `evaluateCondition` / `executeAction` — the original functions using strict `===` equality
- **F'**: `evaluateCondition'` / `executeAction'` — the fixed functions using `matchMode`-aware comparison (defaulting to `"starts_with"`)

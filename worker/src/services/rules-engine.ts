import type {
  StructuredRule,
  RuleCondition,
  RuleAction,
  EngineLineItem,
  AuditEntry,
  RulesEngineResult,
  ProductCatalogEntry,
} from 'shared';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface RulesEngineInput {
  lineItems: EngineLineItem[];
  rules: StructuredRule[];
  catalog: ProductCatalogEntry[];
  maxIterations?: number;
}

// ---------------------------------------------------------------------------
// Internal result types
// ---------------------------------------------------------------------------

interface ConditionResult {
  matched: boolean;
  matchingLineItemIds: string[];
}

interface ActionResult {
  modified: boolean;
  lineItems: EngineLineItem[];
  warning?: string;
  beforeSnapshot?: Array<{ id: string; productName: string; quantity: number; unitPrice: number }>;
  afterSnapshot?: Array<{ id: string; productName: string; quantity: number; unitPrice: number }>;
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

const CONDITION_TYPES = new Set([
  'line_item_exists',
  'line_item_not_exists',
  'line_item_quantity_gte',
  'line_item_quantity_lte',
  'always',
]);

const ACTION_TYPES = new Set([
  'add_line_item',
  'remove_line_item',
  'set_quantity',
  'adjust_quantity',
  'set_unit_price',
]);

export function validateCondition(condition: unknown): { valid: boolean; error?: string } {
  if (condition === null || condition === undefined || typeof condition !== 'object') {
    return { valid: false, error: 'Condition must be a non-null object' };
  }

  const cond = condition as Record<string, unknown>;

  if (typeof cond.type !== 'string') {
    return { valid: false, error: 'Condition must have a string "type" field' };
  }

  if (!CONDITION_TYPES.has(cond.type)) {
    return { valid: false, error: `Unknown condition type: "${cond.type}"` };
  }

  switch (cond.type) {
    case 'line_item_exists':
    case 'line_item_not_exists':
      if (typeof cond.productNamePattern !== 'string') {
        return { valid: false, error: `Condition type "${cond.type}" requires a string "productNamePattern" field` };
      }
      break;

    case 'line_item_quantity_gte':
    case 'line_item_quantity_lte':
      if (typeof cond.productNamePattern !== 'string') {
        return { valid: false, error: `Condition type "${cond.type}" requires a string "productNamePattern" field` };
      }
      if (typeof cond.threshold !== 'number') {
        return { valid: false, error: `Condition type "${cond.type}" requires a number "threshold" field` };
      }
      break;

    case 'always':
      // No additional fields required
      break;
  }

  return { valid: true };
}

export function validateAction(action: unknown): { valid: boolean; error?: string } {
  if (action === null || action === undefined || typeof action !== 'object') {
    return { valid: false, error: 'Action must be a non-null object' };
  }

  const act = action as Record<string, unknown>;

  if (typeof act.type !== 'string') {
    return { valid: false, error: 'Action must have a string "type" field' };
  }

  if (!ACTION_TYPES.has(act.type)) {
    return { valid: false, error: `Unknown action type: "${act.type}"` };
  }

  switch (act.type) {
    case 'add_line_item':
      if (typeof act.productName !== 'string') {
        return { valid: false, error: 'Action type "add_line_item" requires a string "productName" field' };
      }
      if (typeof act.quantity !== 'number') {
        return { valid: false, error: 'Action type "add_line_item" requires a number "quantity" field' };
      }
      if (typeof act.unitPrice !== 'number') {
        return { valid: false, error: 'Action type "add_line_item" requires a number "unitPrice" field' };
      }
      if (act.description !== undefined && typeof act.description !== 'string') {
        return { valid: false, error: 'Action type "add_line_item" optional "description" must be a string' };
      }
      break;

    case 'remove_line_item':
      if (typeof act.productNamePattern !== 'string') {
        return { valid: false, error: 'Action type "remove_line_item" requires a string "productNamePattern" field' };
      }
      break;

    case 'set_quantity':
      if (typeof act.productNamePattern !== 'string') {
        return { valid: false, error: 'Action type "set_quantity" requires a string "productNamePattern" field' };
      }
      if (typeof act.quantity !== 'number') {
        return { valid: false, error: 'Action type "set_quantity" requires a number "quantity" field' };
      }
      break;

    case 'adjust_quantity':
      if (typeof act.productNamePattern !== 'string') {
        return { valid: false, error: 'Action type "adjust_quantity" requires a string "productNamePattern" field' };
      }
      if (typeof act.delta !== 'number') {
        return { valid: false, error: 'Action type "adjust_quantity" requires a number "delta" field' };
      }
      break;

    case 'set_unit_price':
      if (typeof act.productNamePattern !== 'string') {
        return { valid: false, error: 'Action type "set_unit_price" requires a string "productNamePattern" field' };
      }
      if (typeof act.unitPrice !== 'number') {
        return { valid: false, error: 'Action type "set_unit_price" requires a number "unitPrice" field' };
      }
      break;
  }

  return { valid: true };
}

export function validateActions(actions: unknown): { valid: boolean; errors?: string[] } {
  if (!Array.isArray(actions)) {
    return { valid: false, errors: ['Actions must be an array'] };
  }

  if (actions.length === 0) {
    return { valid: false, errors: ['Actions array must not be empty'] };
  }

  const errors: string[] = [];
  for (let i = 0; i < actions.length; i++) {
    const result = validateAction(actions[i]);
    if (!result.valid) {
      errors.push(`Action[${i}]: ${result.error}`);
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ---------------------------------------------------------------------------
// Condition evaluator
// ---------------------------------------------------------------------------

function evaluateCondition(
  condition: RuleCondition,
  lineItems: EngineLineItem[],
): ConditionResult {
  switch (condition.type) {
    case 'line_item_exists': {
      const pattern = condition.productNamePattern.toLowerCase();
      const matching = lineItems.filter(
        (li) => li.productName.toLowerCase() === pattern,
      );
      return {
        matched: matching.length > 0,
        matchingLineItemIds: matching.map((li) => li.id),
      };
    }

    case 'line_item_not_exists': {
      const pattern = condition.productNamePattern.toLowerCase();
      const anyMatch = lineItems.some(
        (li) => li.productName.toLowerCase() === pattern,
      );
      // When no item matches the pattern, the condition is satisfied.
      // There are no specific "matching" line items to return.
      return { matched: !anyMatch, matchingLineItemIds: [] };
    }

    case 'line_item_quantity_gte': {
      const pattern = condition.productNamePattern.toLowerCase();
      const matching = lineItems.filter(
        (li) =>
          li.productName.toLowerCase() === pattern &&
          li.quantity >= condition.threshold,
      );
      return {
        matched: matching.length > 0,
        matchingLineItemIds: matching.map((li) => li.id),
      };
    }

    case 'line_item_quantity_lte': {
      const pattern = condition.productNamePattern.toLowerCase();
      const matching = lineItems.filter(
        (li) =>
          li.productName.toLowerCase() === pattern &&
          li.quantity <= condition.threshold,
      );
      return {
        matched: matching.length > 0,
        matchingLineItemIds: matching.map((li) => li.id),
      };
    }

    case 'always':
      return { matched: true, matchingLineItemIds: lineItems.map((li) => li.id) };

    default:
      return { matched: false, matchingLineItemIds: [] };
  }
}

// ---------------------------------------------------------------------------
// Action executor
// ---------------------------------------------------------------------------

function snapshot(
  items: EngineLineItem[],
): Array<{ id: string; productName: string; quantity: number; unitPrice: number }> {
  return items.map((li) => ({
    id: li.id,
    productName: li.productName,
    quantity: li.quantity,
    unitPrice: li.unitPrice,
  }));
}

function generateId(): string {
  return `engine-${crypto.randomUUID()}`;
}

function executeAction(
  action: RuleAction,
  lineItems: EngineLineItem[],
  catalog: ProductCatalogEntry[],
  ruleId: string,
): ActionResult {
  switch (action.type) {
    case 'add_line_item': {
      const catalogEntry = catalog.find(
        (c) => c.name.toLowerCase() === action.productName.toLowerCase(),
      );

      if (!catalogEntry) {
        return {
          modified: false,
          lineItems,
          warning: `Product "${action.productName}" not found in catalog — skipping add_line_item`,
        };
      }

      const newItem: EngineLineItem = {
        id: generateId(),
        productCatalogEntryId: catalogEntry.id,
        productName: catalogEntry.name,
        description: action.description ?? catalogEntry.description,
        quantity: action.quantity,
        unitPrice: action.unitPrice,
        confidenceScore: 100,
        originalText: '',
        ruleIdsApplied: [ruleId],
      };
      const updated = [...lineItems, newItem];
      return {
        modified: true,
        lineItems: updated,
        beforeSnapshot: [], // no existing items affected by an add
        afterSnapshot: snapshot([newItem]),
      };
    }

    case 'remove_line_item': {
      const pattern = action.productNamePattern.toLowerCase();
      const toRemove = lineItems.filter(
        (li) => li.productName.toLowerCase() === pattern,
      );

      if (toRemove.length === 0) {
        return { modified: false, lineItems };
      }

      const before = snapshot(toRemove);
      const updated = lineItems.filter(
        (li) => li.productName.toLowerCase() !== pattern,
      );
      return {
        modified: true,
        lineItems: updated,
        beforeSnapshot: before,
        afterSnapshot: [],
      };
    }

    case 'set_quantity': {
      const pattern = action.productNamePattern.toLowerCase();
      let modified = false;
      const affected: EngineLineItem[] = [];

      const updated = lineItems.map((li) => {
        if (li.productName.toLowerCase() === pattern) {
          affected.push(li);
          modified = true;
          return {
            ...li,
            quantity: action.quantity,
            ruleIdsApplied: [...li.ruleIdsApplied, ruleId],
          };
        }
        return li;
      });

      if (!modified) {
        return { modified: false, lineItems };
      }

      return {
        modified: true,
        lineItems: updated,
        beforeSnapshot: snapshot(affected),
        afterSnapshot: snapshot(
          updated.filter((li) => li.productName.toLowerCase() === pattern),
        ),
      };
    }

    case 'adjust_quantity': {
      const pattern = action.productNamePattern.toLowerCase();
      let modified = false;
      const affected: EngineLineItem[] = [];

      const updated = lineItems.map((li) => {
        if (li.productName.toLowerCase() === pattern) {
          affected.push(li);
          modified = true;
          return {
            ...li,
            quantity: Math.max(0, li.quantity + action.delta),
            ruleIdsApplied: [...li.ruleIdsApplied, ruleId],
          };
        }
        return li;
      });

      if (!modified) {
        return { modified: false, lineItems };
      }

      return {
        modified: true,
        lineItems: updated,
        beforeSnapshot: snapshot(affected),
        afterSnapshot: snapshot(
          updated.filter((li) => li.productName.toLowerCase() === pattern),
        ),
      };
    }

    case 'set_unit_price': {
      const pattern = action.productNamePattern.toLowerCase();
      let modified = false;
      const affected: EngineLineItem[] = [];

      const updated = lineItems.map((li) => {
        if (li.productName.toLowerCase() === pattern) {
          affected.push(li);
          modified = true;
          return {
            ...li,
            unitPrice: action.unitPrice,
            ruleIdsApplied: [...li.ruleIdsApplied, ruleId],
          };
        }
        return li;
      });

      if (!modified) {
        return { modified: false, lineItems };
      }

      return {
        modified: true,
        lineItems: updated,
        beforeSnapshot: snapshot(affected),
        afterSnapshot: snapshot(
          updated.filter((li) => li.productName.toLowerCase() === pattern),
        ),
      };
    }

    default:
      return { modified: false, lineItems };
  }
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ITERATIONS = 10;

export function executeRules(input: RulesEngineInput): RulesEngineResult {
  const { rules, catalog, maxIterations = DEFAULT_MAX_ITERATIONS } = input;

  // Clone input line items to avoid mutation
  let lineItems: EngineLineItem[] = input.lineItems.map((li) => ({
    ...li,
    ruleIdsApplied: [...li.ruleIdsApplied],
  }));

  const auditTrail: AuditEntry[] = [];

  // Early exit: no rules → return unmodified
  if (rules.length === 0) {
    return { lineItems, auditTrail, iterationCount: 0, converged: true };
  }

  // Track which (ruleId, lineItemId) pairs have been applied to prevent
  // duplicate applications within a single execution run.
  const applied = new Set<string>();

  let iterationCount = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    iterationCount = iteration;
    let anyModified = false;

    // Filter eligible rules by trigger mode
    const eligible = rules
      .filter((r) => {
        if (iteration === 1) return true; // first iteration: all rules
        return r.triggerMode === 'chained'; // subsequent: only chained
      })
      .sort((a, b) => a.priorityOrder - b.priorityOrder);

    for (const rule of eligible) {
      // Validate condition at runtime — skip invalid rules
      const condValid = validateCondition(rule.condition);
      if (!condValid.valid) {
        auditTrail.push({
          ruleId: rule.id,
          ruleName: rule.name,
          iteration,
          condition: rule.condition,
          action: rule.actions[0],
          matchingLineItemIds: [],
          beforeSnapshot: [],
          afterSnapshot: [],
          warning: `Skipping rule: invalid condition — ${condValid.error}`,
        });
        continue;
      }

      // Validate actions at runtime — skip invalid rules
      const actionsValid = validateActions(rule.actions);
      if (!actionsValid.valid) {
        auditTrail.push({
          ruleId: rule.id,
          ruleName: rule.name,
          iteration,
          condition: rule.condition,
          action: rule.actions[0],
          matchingLineItemIds: [],
          beforeSnapshot: [],
          afterSnapshot: [],
          warning: `Skipping rule: invalid actions — ${actionsValid.errors?.join('; ')}`,
        });
        continue;
      }

      // Evaluate condition
      const condResult = evaluateCondition(rule.condition, lineItems);
      if (!condResult.matched) continue;

      // Check duplicate application: skip if this rule has already been
      // applied to all of the matching line items in this execution run.
      const matchingIds = condResult.matchingLineItemIds;
      const allAlreadyApplied =
        matchingIds.length > 0 &&
        matchingIds.every((id) => applied.has(`${rule.id}:${id}`));
      if (allAlreadyApplied) continue;

      // Execute each action
      for (const action of rule.actions) {
        const actionResult = executeAction(action, lineItems, catalog, rule.id);
        lineItems = actionResult.lineItems;

        if (actionResult.modified || actionResult.warning) {
          auditTrail.push({
            ruleId: rule.id,
            ruleName: rule.name,
            iteration,
            condition: rule.condition,
            action,
            matchingLineItemIds: matchingIds,
            beforeSnapshot: actionResult.beforeSnapshot ?? [],
            afterSnapshot: actionResult.afterSnapshot ?? [],
            warning: actionResult.warning,
          });
        }

        if (actionResult.modified) {
          anyModified = true;
        }
      }

      // Mark this rule as applied to the matching line items
      for (const id of matchingIds) {
        applied.add(`${rule.id}:${id}`);
      }

      // For conditions with no specific matching IDs (e.g. line_item_not_exists,
      // always), track by a sentinel so the rule isn't re-applied identically.
      if (matchingIds.length === 0) {
        applied.add(`${rule.id}:__global__`);
      }
    }

    // Convergence: no modifications this iteration
    if (!anyModified) {
      return { lineItems, auditTrail, iterationCount, converged: true };
    }
  }

  // Max iterations reached without convergence — record a warning entry.
  // We use a synthetic audit entry with sentinel IDs so consumers can
  // distinguish engine-level warnings from rule-level entries.
  auditTrail.push({
    ruleId: '__engine__',
    ruleName: 'Rules Engine',
    iteration: iterationCount,
    condition: { type: 'always' },
    action: { type: 'adjust_quantity', productNamePattern: '', delta: 0 },
    matchingLineItemIds: [],
    beforeSnapshot: [],
    afterSnapshot: [],
    warning: `Rules engine did not converge after ${maxIterations} iterations`,
  });

  return { lineItems, auditTrail, iterationCount, converged: false };
}

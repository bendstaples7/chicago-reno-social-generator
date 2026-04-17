import type { RuleGroupWithRules } from 'shared';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sanitize ruleIdsApplied from AI response — filter to valid UUID strings only.
 */
export function sanitizeRuleIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === 'string' && UUID_PATTERN.test(id));
}

/**
 * Format active rules as a structured "BUSINESS RULES" prompt section,
 * grouped by group name with each rule's ID and description listed.
 */
export function buildRulesSection(rules: RuleGroupWithRules[]): string {
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

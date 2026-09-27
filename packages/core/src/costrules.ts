/**
 * Versioned cost rule sets as data: each rule is `key = expression` over whitelisted variables,
 * evaluated with the safe quantity parser (no eval). The observed legacy percentage variants are
 * stored as REFERENCE ONLY (status "reference_only") and are never selected as defaults.
 */
import { evalQuantity, parseQuantity, variablesOf } from './quantity.js';

export interface CostRule {
  key: string;
  formula: string;
  description?: string;
  /** Rounding of the rule result: 'none' or integer VND (half away from zero). */
  rounding?: 'none' | 'vnd';
}

export interface CostRuleSet {
  id: string;
  name: string;
  status: 'active' | 'reference_only';
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  projectType?: string | null;
  discipline?: string | null;
  location?: string | null;
  source: string;
  variables: string[];
  rules: CostRule[];
}

export const roundVnd = (v: number) => Math.sign(v) * Math.round(Math.abs(v));

/** Evaluate rules in order; each result becomes a variable for the following rules. */
export function evaluateRuleSet(set: CostRuleSet, inputs: Record<string, number>): { values: Record<string, number>; trace: { key: string; formula: string; value: number }[] } {
  const values: Record<string, number> = { ...inputs };
  const allowed = new Set([...set.variables, ...set.rules.map((r) => r.key)]);
  const trace: { key: string; formula: string; value: number }[] = [];
  for (const r of set.rules) {
    const ast = parseQuantity(r.formula);
    for (const v of variablesOf(ast)) if (!allowed.has(v)) throw new Error(`Biến "${v}" không nằm trong danh sách cho phép của bộ quy tắc ${set.id}`);
    let v = evalQuantity(ast, values);
    if (r.rounding === 'vnd') v = roundVnd(v);
    values[r.key] = v;
    trace.push({ key: r.key, formula: r.formula, value: v });
  }
  return { values, trace };
}

/** Select an ACTIVE rule set for a date/project type; reference-only sets are never returned. */
export function selectRuleSet(sets: CostRuleSet[], date: string, projectType?: string | null): CostRuleSet | null {
  return (
    sets.find(
      (s) =>
        s.status === 'active' &&
        (!s.effectiveFrom || s.effectiveFrom <= date) &&
        (!s.effectiveTo || date <= s.effectiveTo) &&
        (!s.projectType || !projectType || s.projectType === projectType),
    ) ?? null
  );
}

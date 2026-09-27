import { normalizeText } from './text.js';
import type { NormResource } from './types.js';

/**
 * TT 38/2026 Phụ lục VII cấp phối vật liệu (mix design): a "Vữa" / "Vữa bê tông" / "Vữa xi măng"
 * resource in a norm is a placeholder for a concrete or mortar mix – the actual cement/sand/stone/
 * water quantities depend on the grade (mác) and aggregate size, chosen per estimate item.
 */
export type MixKind = 'concrete' | 'mortar' | 'other';

export interface MixMaterial {
  material: string;
  unit: string;
  qty: number;
  /** Resolved library resource (set at import time); a material without one can't be priced yet. */
  resourceCode: string | null;
}

export interface MixDesign {
  code: string;
  section: string;
  spec: string | null;
  kind: MixKind;
  /** Mác bê tông / Mác vữa, e.g. "250". */
  grade: string | null;
  page: number | null;
  status: string;
  materials: MixMaterial[];
}

/** A resource whose price is a mix design's cement/sand/stone/water, not a priced VL item on its own. */
export function isMixResourceName(name: string): boolean {
  return /^vua\b/.test(normalizeText(name));
}

/**
 * Replace a norm's "Vữa..." resource line with its mix design's constituent materials, scaled by the
 * vữa consumption of the norm (e.g. 1,025 m3 vữa bê tông per m3 of concrete work). Materials without a
 * resolved resourceCode are skipped (nothing to price against yet). Returns null if there is no exactly
 * one mix-eligible resource line to expand.
 */
export function expandMixDesign(normResources: NormResource[], vuaResourceCode: string, vuaConsumption: number, mix: MixDesign): NormResource[] {
  const kept = normResources.filter((nr) => nr.resourceCode !== vuaResourceCode);
  const expanded: NormResource[] = mix.materials
    .filter((m): m is MixMaterial & { resourceCode: string } => !!m.resourceCode && m.qty > 0)
    .map((m) => ({ normCode: normResources[0]?.normCode ?? '', resourceCode: m.resourceCode, consumption: vuaConsumption * m.qty }));
  return [...kept, ...expanded];
}

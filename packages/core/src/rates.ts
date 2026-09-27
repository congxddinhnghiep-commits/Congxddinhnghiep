import type { BuildingType, CostSettings } from './types.js';

/** Legacy (TT 11/2021) rates shape, built from data/legal/tt11-2021.json by tt11RatesTable(). */
export interface RatesTable {
  _note: string;
  /** Upper bounds (VND) of each cost bracket; the last bracket is open-ended. */
  brackets: number[];
  bracketLabels: string[];
  bracketBasis: string;
  buildingTypes: Record<
    BuildingType,
    {
      label: string;
      cBase: 'T' | 'NC';
      c: number[];
      lt: number[];
      tt: number;
      gtk: number;
      tl: number;
    }
  >;
}

export interface ResolvedRates {
  cBase: 'T' | 'NC';
  cRate: number;
  ltRate: number;
  ttRate: number;
  gtkRate: number;
  tlRate: number;
  bracketIndex: number;
  source: string;
}

export function bracketIndex(table: RatesTable, amount: number): number {
  const i = table.brackets.findIndex((b) => amount <= b);
  return i === -1 ? table.brackets.length : i;
}

/** Pick default rates by building type and cost bracket (bracket measured on direct cost T). */
export function resolveDefaultRates(table: RatesTable, buildingType: BuildingType, directCost: number): ResolvedRates {
  const bt = table.buildingTypes[buildingType] ?? table.buildingTypes.dan_dung;
  const i = bracketIndex(table, directCost);
  const at = (arr: number[]) => arr[Math.min(i, arr.length - 1)];
  return {
    cBase: bt.cBase,
    cRate: at(bt.c),
    ltRate: at(bt.lt),
    ttRate: bt.tt,
    gtkRate: bt.gtk,
    tlRate: bt.tl,
    bracketIndex: i,
    source: `Bảng mặc định – ${bt.label}, nhóm chi phí ${table.bracketLabels[i] ?? ''} (${table._note})`,
  };
}

export const DEFAULT_COST_SETTINGS: CostSettings = {
  autoRates: true,
  cBase: 'T',
  cRate: 0,
  ltRate: 0,
  ttRate: 0,
  gtkRate: 0,
  tlRate: 0,
  equipment: 0,
  qlda: 0,
  tuVan: 0,
  other: 0,
  contingencyQtyRate: 5,
  contingencyPriceRate: 0,
};

/** Merge stored settings with default rates when autoRates is on. */
export function effectiveSettings(
  stored: Partial<CostSettings> | null | undefined,
  table: RatesTable,
  buildingType: BuildingType,
  directCost: number,
): { settings: CostSettings; source: string } {
  const s: CostSettings = { ...DEFAULT_COST_SETTINGS, ...(stored ?? {}) };
  if (!s.autoRates) return { settings: s, source: 'Hệ số do người dùng nhập' };
  const r = resolveDefaultRates(table, buildingType, directCost);
  return {
    settings: { ...s, cBase: r.cBase, cRate: r.cRate, ltRate: r.ltRate, ttRate: r.ttRate, gtkRate: r.gtkRate, tlRate: r.tlRate },
    source: r.source,
  };
}

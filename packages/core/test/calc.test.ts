import { describe, expect, it } from 'vitest';
import {
  computeCostSummary,
  computeEstimate,
  computeTotalEstimate,
  DEFAULT_COST_SETTINGS,
  evaluateFormula,
  resolveDefaultRates,
  type RatesTable,
} from '@dutoan/core';

/*
 * Hand-checked example
 * Norm N1 (1 m3 concrete): cement 350 kg @ 1.500 đ, sand 0,5 m3 @ 300.000 đ,
 *                          labour 2 công @ 250.000 đ, mixer 0,1 ca @ 400.000 đ
 *   VL = 350×1.500 + 0,5×300.000 = 525.000 + 150.000 = 675.000
 *   NC = 2×250.000 = 500.000
 *   M  = 0,1×400.000 = 40.000
 *   Đơn giá = 1.215.000 đ/m3
 * Item quantity 10 m3 → VL 6.750.000, NC 5.000.000, M 400.000, total 12.150.000
 * Norm N2: labour 1 công → NC 250.000; quantity 4 → 1.000.000
 */
const resources = [
  { code: 'XM', name: 'Xi măng PCB40', unit: 'kg', type: 'VL' as const, basePrice: 1500 },
  { code: 'CAT', name: 'Cát vàng', unit: 'm3', type: 'VL' as const, basePrice: 300000 },
  { code: 'NC', name: 'Nhân công 3,5/7', unit: 'công', type: 'NC' as const, basePrice: 250000 },
  { code: 'TRON', name: 'Máy trộn 250l', unit: 'ca', type: 'M' as const, basePrice: 400000 },
];
const normResources = [
  { normCode: 'N1', resourceCode: 'XM', consumption: 350 },
  { normCode: 'N1', resourceCode: 'CAT', consumption: 0.5 },
  { normCode: 'N1', resourceCode: 'NC', consumption: 2 },
  { normCode: 'N1', resourceCode: 'TRON', consumption: 0.1 },
  { normCode: 'N2', resourceCode: 'NC', consumption: 1 },
];
const categories = [
  { id: 1, name: 'Phần móng', order: 1 },
  { id: 2, name: 'Phần thân', order: 2 },
];
const items = [
  { id: 1, categoryId: 1, order: 1, normCode: 'N1', name: 'Bê tông', unit: 'm3', quantity: 10 },
  { id: 2, categoryId: 2, order: 1, normCode: 'N2', name: 'Công việc', unit: 'm2', quantity: 4 },
  { id: 3, categoryId: 2, order: 2, normCode: 'XX', name: 'Không có định mức', unit: 'm2', quantity: 4 },
];

describe('computeEstimate', () => {
  const r = computeEstimate({ categories, items, normResources, resources });

  it('computes unit cost per item', () => {
    const it1 = r.categories[0].items[0];
    expect(it1.unitCost).toEqual({ vl: 675000, nc: 500000, m: 40000, total: 1215000 });
    expect(it1.amount.total).toBe(12150000);
  });

  it('computes category and grand totals', () => {
    expect(r.categories[0].total.total).toBe(12150000);
    expect(r.categories[1].total.nc).toBe(1000000);
    expect(r.total).toEqual({ vl: 6750000, nc: 6000000, m: 400000, total: 13150000 });
  });

  it('flags items without norm', () => {
    expect(r.categories[1].items[1].missingNorm).toBe(true);
    expect(r.categories[1].items[1].amount.total).toBe(0);
  });

  it('builds resource analysis and summary', () => {
    const a = r.categories[0].items[0].analysis.find((x) => x.resourceCode === 'XM')!;
    expect(a.quantity).toBe(3500);
    expect(a.amount).toBe(5250000);
    const nc = r.resourceSummary.find((s) => s.code === 'NC')!;
    expect(nc.quantity).toBe(24); // 2×10 + 1×4
    expect(nc.amount).toBe(6000000);
    expect(r.resourceSummary.map((s) => s.type)).toEqual(['VL', 'VL', 'NC', 'M']);
  });

  it('applies project prices and price difference', () => {
    const r2 = computeEstimate({ categories, items, normResources, resources, projectPrices: { XM: 1650 } });
    expect(r2.categories[0].items[0].unitCost.vl).toBe(350 * 1650 + 150000);
    const xm = r2.resourceSummary.find((s) => s.code === 'XM')!;
    expect(xm.difference).toBe(3500 * 150);
  });
});

describe('computeCostSummary (TT11/2021)', () => {
  it('matches a hand-checked example', () => {
    // T = 100.000.000; C 6,5% → 6.500.000; LT 1% → 1.000.000; TT 2,5% → 2.500.000; GTk 0
    // GT = 10.000.000; TL = 110.000.000 × 5,5% = 6.050.000; G = 116.050.000
    // GTGT 8% = 9.284.000; Gxd = 125.334.000
    const s = { ...DEFAULT_COST_SETTINGS, autoRates: false, cRate: 6.5, ltRate: 1, ttRate: 2.5, gtkRate: 0, tlRate: 5.5 };
    const r = computeCostSummary({ vl: 60e6, nc: 30e6, m: 10e6 }, s, 8);
    expect(r.T).toBe(100e6);
    expect(r.GT).toBeCloseTo(10e6, 6);
    expect(r.TL).toBeCloseTo(6.05e6, 6);
    expect(r.G).toBeCloseTo(116.05e6, 6);
    expect(r.GTGT).toBeCloseTo(9.284e6, 6);
    expect(r.Gxd).toBeCloseTo(125.334e6, 6);
    expect(r.lines.find((l) => l.code === 'C')!.formula).toBe('T × 6,5%');
  });

  it('supports chi phí chung on labour (NC)', () => {
    const s = { ...DEFAULT_COST_SETTINGS, autoRates: false, cBase: 'NC' as const, cRate: 60 };
    const r = computeCostSummary({ vl: 0, nc: 10e6, m: 0 }, s, 10);
    expect(r.lines.find((l) => l.code === 'C')!.value).toBe(6e6);
    expect(r.GTGT).toBeCloseTo(1.6e6, 6);
  });

  it('computes tổng dự toán with contingency', () => {
    const s = { ...DEFAULT_COST_SETTINGS, equipment: 20e6, qlda: 5e6, tuVan: 10e6, other: 5e6, contingencyQtyRate: 5, contingencyPriceRate: 2 };
    const r = computeTotalEstimate(60e6, s);
    // base 100e6 → +5e6 +2e6
    expect(r.total).toBeCloseTo(107e6, 6);
  });
});

describe('rates', () => {
  const table: RatesTable = {
    _note: 'GIÁ TRỊ MẪU',
    brackets: [15e9, 100e9],
    bracketLabels: ['≤ 15 tỷ', '≤ 100 tỷ', '> 100 tỷ'],
    bracketBasis: 'T',
    buildingTypes: {
      dan_dung: { label: 'Dân dụng', cBase: 'T', c: [7, 6, 5], lt: [2, 1.5, 1], tt: 2.5, gtk: 0, tl: 5.5 },
    } as RatesTable['buildingTypes'],
  };
  it('selects bracket by direct cost', () => {
    expect(resolveDefaultRates(table, 'dan_dung', 1e9).cRate).toBe(7);
    expect(resolveDefaultRates(table, 'dan_dung', 50e9).cRate).toBe(6);
    expect(resolveDefaultRates(table, 'dan_dung', 500e9).ltRate).toBe(1);
  });
});

describe('evaluateFormula', () => {
  it.each([
    ['2*3.5*0.3', 2.1],
    ['2x3,5x0,3', 2.1],
    ['(2+3)*4 - 1', 19],
    ['10/4', 2.5],
    ['2^3', 8],
    ['2*3 [móng M1] + 1', 7],
  ])('%s = %d', (f, v) => {
    expect(evaluateFormula(f)).toBeCloseTo(v, 10);
  });
  it('rejects invalid input', () => {
    expect(() => evaluateFormula('2*abc')).toThrow();
    expect(() => evaluateFormula('1/0')).toThrow();
  });
});

import { amountInWords } from '@dutoan/core';
describe('amountInWords', () => {
  it.each([
    [1250000, 'Một triệu hai trăm năm mươi nghìn đồng'],
    [105, 'Một trăm lẻ năm đồng'],
    [2021, 'Hai nghìn không trăm hai mươi mốt đồng'],
    [15, 'Mười lăm đồng'],
  ])('%d', (n, s) => expect(amountInWords(n)).toBe(s));
});

import type { Category, CostSettings, EstimateItem, NormResource, Resource, ResourceType } from './types.js';

export interface CostTriple {
  vl: number;
  nc: number;
  m: number;
}

export interface UnitCost extends CostTriple {
  /** Đơn giá = VL + NC + M */
  total: number;
}

export interface AnalysisRow {
  resourceCode: string;
  name: string;
  unit: string;
  type: ResourceType;
  consumption: number;
  /** consumption × item quantity */
  quantity: number;
  price: number;
  /** consumption × price (per unit of the item) */
  unitAmount: number;
  /** quantity × price */
  amount: number;
}

export interface ItemResult extends EstimateItem {
  unitCost: UnitCost;
  /** Thành phần chi phí = quantity × unit cost */
  amount: UnitCost;
  analysis: AnalysisRow[];
  /** Norm has no resource definition (unknown code or empty norm). */
  missingNorm: boolean;
}

export interface CategoryResult extends Category {
  items: ItemResult[];
  total: UnitCost;
}

export interface ResourceSummaryRow {
  code: string;
  name: string;
  unit: string;
  type: ResourceType;
  quantity: number;
  basePrice: number;
  price: number;
  amount: number;
  /** (price − basePrice) × quantity — chênh lệch giá */
  difference: number;
}

export interface EstimateResult {
  categories: CategoryResult[];
  total: UnitCost;
  resourceSummary: ResourceSummaryRow[];
}

export interface EstimateInput {
  categories: Category[];
  items: EstimateItem[];
  normResources: NormResource[];
  resources: Resource[];
  /** Project prices overriding base prices, keyed by resource code. */
  projectPrices?: Record<string, number>;
}

const zero = (): UnitCost => ({ vl: 0, nc: 0, m: 0, total: 0 });
const typeKey = { VL: 'vl', NC: 'nc', M: 'm' } as const;

function add(a: UnitCost, b: UnitCost): void {
  a.vl += b.vl;
  a.nc += b.nc;
  a.m += b.m;
  a.total += b.total;
}

/** hao phí tài nguyên = khối lượng công tác × định mức × hệ số điều chỉnh */
export function expandResource(quantity: number, consumption: number, coefficient = 1): number {
  return quantity * consumption * coefficient;
}

export function priceOf(resource: Resource, projectPrices?: Record<string, number>): number {
  const p = projectPrices?.[resource.code];
  return p !== undefined && p !== null ? p : resource.basePrice;
}

interface PctContribution {
  resourceCode: string;
  type: ResourceType;
  base: 'VL' | 'M';
  pct: number;
  /** VNĐ per unit of the item, computed from the pre-percentage VL/M subtotal. */
  amount: number;
}

interface UnitCostBreakdown {
  /** Subtotal before percentage rows ("Vật liệu khác", "Máy khác") are applied. */
  pre: UnitCost;
  unitCost: UnitCost;
  pct: PctContribution[];
}

/**
 * Unit cost of one norm: VL = Σ(consumption × price) over VL resources, same for NC, M.
 * Resources with `pctBase` (e.g. "Vật liệu khác", "Máy khác" – TT 38/2026) are a PERCENTAGE of the
 * pre-percentage VL or M subtotal, applied in a second pass and added to their own resource type.
 */
function breakdownUnitCost(normResources: NormResource[], resources: Map<string, Resource>, projectPrices?: Record<string, number>): UnitCostBreakdown {
  const pre = zero();
  const pctRows: Omit<PctContribution, 'amount'>[] = [];
  for (const nr of normResources) {
    const r = resources.get(nr.resourceCode);
    if (!r) continue;
    if (nr.pctBase) {
      pctRows.push({ resourceCode: r.code, type: r.type, base: nr.pctBase, pct: nr.consumption });
      continue;
    }
    pre[typeKey[r.type]] += expandResource(1, nr.consumption, nr.coefficient ?? 1) * priceOf(r, projectPrices);
  }
  pre.total = pre.vl + pre.nc + pre.m;
  const unitCost = { ...pre };
  const pct = pctRows.map((p) => {
    const amount = ((p.base === 'VL' ? pre.vl : pre.m) * p.pct) / 100;
    unitCost[typeKey[p.type]] += amount;
    return { ...p, amount };
  });
  unitCost.total = unitCost.vl + unitCost.nc + unitCost.m;
  return { pre, unitCost, pct };
}

export function computeUnitCost(normResources: NormResource[], resources: Map<string, Resource>, projectPrices?: Record<string, number>): UnitCost {
  return breakdownUnitCost(normResources, resources, projectPrices).unitCost;
}

/**
 * Unit cost of a CUSTOM_GTT / MARKET_QUOTE item. A quote stated including VAT is converted to the
 * pre-VAT price (the summary adds VAT once).
 */
export function customUnitCost(it: Pick<EstimateItem, 'custom' | 'pricingMethod' | 'quote'>): UnitCost {
  const c = it.custom ?? { vl: 0, nc: 0, m: 0 };
  let k = 1;
  if (it.pricingMethod === 'MARKET_QUOTE' && it.quote?.vatStatus === 'including_vat') k = 1 / (1 + (it.quote.vatRate ?? 10) / 100);
  const u = { vl: (c.vl || 0) * k, nc: (c.nc || 0) * k, m: (c.m || 0) * k, total: 0 };
  u.total = u.vl + u.nc + u.m;
  return u;
}

export function computeEstimate(input: EstimateInput): EstimateResult {
  const resources = new Map(input.resources.map((r) => [r.code, r]));
  const byNorm = new Map<string, NormResource[]>();
  for (const nr of input.normResources) {
    const list = byNorm.get(nr.normCode) ?? [];
    list.push(nr);
    byNorm.set(nr.normCode, list);
  }

  const summary = new Map<string, ResourceSummaryRow>();
  /** Accumulated amount of percentage-rule resources (e.g. "Vật liệu khác"), which isn't quantity × price. */
  const pctAmounts = new Map<string, number>();
  const total = zero();
  const categories: CategoryResult[] = [...input.categories]
    .sort((a, b) => a.order - b.order || a.id - b.id)
    .map((cat) => {
      const catTotal = zero();
      const items = input.items
        .filter((it) => it.categoryId === cat.id)
        .sort((a, b) => a.order - b.order || a.id - b.id)
        .map((it): ItemResult => {
          if (it.pricingMethod && it.pricingMethod !== 'NORM_BASED') {
            const unitCost = customUnitCost(it);
            const q = it.quantity || 0;
            const amount: UnitCost = { vl: unitCost.vl * q, nc: unitCost.nc * q, m: unitCost.m * q, total: unitCost.total * q };
            add(catTotal, amount);
            // A file/custom price may still carry a norm code: show the norm-based price and analysis
            // for comparison only (never added to totals or the material summary).
            const cnrs = it.normCode ? it.normResourcesOverride ?? byNorm.get(it.normCode) ?? [] : [];
            if (!cnrs.length) return { ...it, unitCost, amount, analysis: [], missingNorm: false };
            const cb = breakdownUnitCost(cnrs, resources, input.projectPrices);
            const analysis: AnalysisRow[] = [];
            for (const nr of cnrs) {
              const r = resources.get(nr.resourceCode);
              if (!r) continue;
              if (nr.pctBase) {
                const p = cb.pct.find((x) => x.resourceCode === r.code && x.base === nr.pctBase && x.pct === nr.consumption);
                analysis.push({ resourceCode: r.code, name: r.name, unit: r.unit, type: r.type, consumption: nr.consumption, quantity: q, price: 0, unitAmount: p?.amount ?? 0, amount: (p?.amount ?? 0) * q });
                continue;
              }
              const price = priceOf(r, input.projectPrices);
              const quantity = expandResource(q, nr.consumption, nr.coefficient ?? 1);
              analysis.push({ resourceCode: r.code, name: r.name, unit: r.unit, type: r.type, consumption: nr.consumption, quantity, price, unitAmount: expandResource(1, nr.consumption, nr.coefficient ?? 1) * price, amount: quantity * price });
            }
            return { ...it, unitCost, amount, analysis, missingNorm: false, normUnitCost: cb.unitCost };
          }
          const nrs = it.normResourcesOverride ?? byNorm.get(it.normCode) ?? [];
          const breakdown = breakdownUnitCost(nrs, resources, input.projectPrices);
          const unitCost = breakdown.unitCost;
          const q = it.quantity || 0;
          const amount: UnitCost = {
            vl: unitCost.vl * q,
            nc: unitCost.nc * q,
            m: unitCost.m * q,
            total: unitCost.total * q,
          };
          const analysis: AnalysisRow[] = [];
          for (const nr of nrs) {
            const r = resources.get(nr.resourceCode);
            if (!r) continue;
            if (nr.pctBase) {
              const p = breakdown.pct.find((x) => x.resourceCode === r.code && x.base === nr.pctBase && x.pct === nr.consumption);
              const unitAmount = p?.amount ?? 0;
              analysis.push({ resourceCode: r.code, name: r.name, unit: r.unit, type: r.type, consumption: nr.consumption, quantity: q, price: 0, unitAmount, amount: unitAmount * q });
              const s = summary.get(r.code) ?? { code: r.code, name: r.name, unit: r.unit, type: r.type, quantity: 0, basePrice: r.basePrice, price: 0, amount: 0, difference: 0 };
              s.quantity += q;
              summary.set(r.code, s);
              pctAmounts.set(r.code, (pctAmounts.get(r.code) ?? 0) + unitAmount * q);
              continue;
            }
            const price = priceOf(r, input.projectPrices);
            const quantity = expandResource(q, nr.consumption, nr.coefficient ?? 1);
            analysis.push({
              resourceCode: r.code,
              name: r.name,
              unit: r.unit,
              type: r.type,
              consumption: nr.consumption,
              quantity,
              price,
              unitAmount: expandResource(1, nr.consumption, nr.coefficient ?? 1) * price,
              amount: quantity * price,
            });
            const s = summary.get(r.code) ?? {
              code: r.code,
              name: r.name,
              unit: r.unit,
              type: r.type,
              quantity: 0,
              basePrice: r.basePrice,
              price,
              amount: 0,
              difference: 0,
            };
            s.quantity += quantity;
            summary.set(r.code, s);
          }
          add(catTotal, amount);
          return { ...it, unitCost, amount, analysis, missingNorm: nrs.length === 0 };
        });
      add(total, catTotal);
      return { ...cat, items, total: catTotal };
    });

  const order: Record<ResourceType, number> = { VL: 0, NC: 1, M: 2 };
  const resourceSummary = [...summary.values()]
    .map((s) => (pctAmounts.has(s.code) ? { ...s, amount: pctAmounts.get(s.code)!, difference: 0 } : { ...s, amount: s.quantity * s.price, difference: (s.price - s.basePrice) * s.quantity }))
    .sort((a, b) => order[a.type] - order[b.type] || a.code.localeCompare(b.code));

  return { categories, total, resourceSummary };
}

// ---------------------------------------------------------------------------
// Bảng tổng hợp chi phí xây dựng (TT 11/2021/TT-BXD, sửa đổi bởi TT 09/2024/TT-BXD)
// ---------------------------------------------------------------------------

export interface CostLine {
  code: string;
  name: string;
  /** Human readable formula, e.g. "T × 6,5%" */
  formula: string;
  /** Percentage applied on this line (shown in the "Tỷ lệ" column). */
  rate?: number;
  /** Multiplier applied on this line (e.g. Knc, Km). */
  coef?: number;
  value: number;
  /** Visual level: 0 = main total, 1 = sub-line */
  level: 0 | 1;
  /** Roman numeral / number shown in the STT column (empty for unnumbered totals). */
  stt?: string;
  /** Legal source of the rate or method (document, table, bracket, status). */
  source?: string;
  /**
   * Spreadsheet-agnostic expression used by the Excel export. Tokens: {CODE} = value of another
   * line, {rate} / {coef} = this line's rate / coefficient cell, {rate:CODE} = another line's rate,
   * {DT.VL} / {DT.NC} / {DT.M} = direct-cost totals of the detailed estimate sheet.
   */
  expr?: string;
}

export interface CostSummary {
  lines: CostLine[];
  T: number;
  GT: number;
  TL: number;
  /** Chi phí xây dựng trước thuế (G / GXDTT) */
  G: number;
  GTGT: number;
  /** Chi phí xây dựng sau thuế (Gxd / GXD) */
  Gxd: number;
  /** Nhà tạm shown as a separate line after VAT (TT36: GXDNT). 0 when included in GT (TT11). */
  nhaTam?: number;
  /** Total construction cost carried to the total estimate = Gxd + nhaTam. */
  total?: number;
}

export const pct = (r: number) => `${String(r).replace('.', ',')}%`;

export function computeCostSummary(direct: CostTriple, s: CostSettings, vatRate: number): CostSummary {
  const T = direct.vl + direct.nc + direct.m;
  const cBaseValue = s.cBase === 'NC' ? direct.nc : T;
  const C = (cBaseValue * s.cRate) / 100;
  const LT = (T * s.ltRate) / 100;
  const TT = (T * s.ttRate) / 100;
  const GTk = (T * s.gtkRate) / 100;
  const GT = C + LT + TT + GTk;
  const TL = ((T + GT) * s.tlRate) / 100;
  const G = T + GT + TL;
  const GTGT = (G * vatRate) / 100;
  const Gxd = G + GTGT;

  const lines: CostLine[] = [
    { code: 'VL', name: 'Chi phí vật liệu', formula: 'Σ VL (bảng dự toán chi tiết)', value: direct.vl, level: 1, expr: '{DT.VL}' },
    { code: 'NC', name: 'Chi phí nhân công', formula: 'Σ NC (bảng dự toán chi tiết)', value: direct.nc, level: 1, expr: '{DT.NC}' },
    { code: 'M', name: 'Chi phí máy và thiết bị thi công', formula: 'Σ M (bảng dự toán chi tiết)', value: direct.m, level: 1, expr: '{DT.M}' },
    { code: 'T', name: 'Chi phí trực tiếp', formula: 'VL + NC + M', value: T, level: 0, stt: 'I', expr: '{VL}+{NC}+{M}' },
    { code: 'C', name: 'Chi phí chung', formula: `${s.cBase} × ${pct(s.cRate)}`, rate: s.cRate, value: C, level: 1, expr: `{${s.cBase}}*{rate}/100` },
    { code: 'LT', name: 'Chi phí nhà tạm để ở và điều hành thi công', formula: `T × ${pct(s.ltRate)}`, rate: s.ltRate, value: LT, level: 1, expr: '{T}*{rate}/100' },
    {
      code: 'TT',
      name: 'Chi phí một số công việc không xác định được khối lượng từ thiết kế',
      formula: `T × ${pct(s.ttRate)}`,
      rate: s.ttRate,
      value: TT,
      level: 1,
      expr: '{T}*{rate}/100',
    },
    { code: 'GTk', name: 'Chi phí gián tiếp khác', formula: `T × ${pct(s.gtkRate)}`, rate: s.gtkRate, value: GTk, level: 1, expr: '{T}*{rate}/100' },
    { code: 'GT', name: 'Chi phí gián tiếp', formula: 'C + LT + TT + GTk', value: GT, level: 0, stt: 'II', expr: '{C}+{LT}+{TT}+{GTk}' },
    { code: 'TL', name: 'Thu nhập chịu thuế tính trước', formula: `(T + GT) × ${pct(s.tlRate)}`, rate: s.tlRate, value: TL, level: 0, stt: 'III', expr: '({T}+{GT})*{rate}/100' },
    { code: 'G', name: 'Chi phí xây dựng trước thuế', formula: 'T + GT + TL', value: G, level: 0, stt: 'IV', expr: '{T}+{GT}+{TL}' },
    { code: 'GTGT', name: 'Thuế giá trị gia tăng', formula: `G × ${pct(vatRate)}`, rate: vatRate, value: GTGT, level: 0, stt: 'V', expr: '{G}*{rate}/100' },
    { code: 'Gxd', name: 'Chi phí xây dựng sau thuế', formula: 'G + GTGT', value: Gxd, level: 0, stt: 'VI', expr: '{G}+{GTGT}' },
  ];
  return { lines, T, GT, TL, G, GTGT, Gxd, nhaTam: 0, total: Gxd };
}

export interface TotalEstimateLine {
  code: string;
  name: string;
  formula: string;
  value: number;
  /** Legal source / origin of the amount. */
  source?: string;
}

/** Tổng dự toán: Gxd + thiết bị + QLDA + tư vấn + chi phí khác + dự phòng. */
export function computeTotalEstimate(Gxd: number, s: CostSettings): { lines: TotalEstimateLine[]; total: number } {
  const base = Gxd + s.equipment + s.qlda + s.tuVan + s.other;
  const dp1 = (base * s.contingencyQtyRate) / 100;
  const dp2 = (base * s.contingencyPriceRate) / 100;
  const total = base + dp1 + dp2;
  return {
    total,
    lines: [
      { code: 'Gxd', name: 'Chi phí xây dựng', formula: 'Bảng tổng hợp chi phí xây dựng', value: Gxd },
      { code: 'Gtb', name: 'Chi phí thiết bị', formula: 'Nhập', value: s.equipment },
      { code: 'Gqlda', name: 'Chi phí quản lý dự án', formula: 'Nhập', value: s.qlda },
      { code: 'Gtv', name: 'Chi phí tư vấn đầu tư xây dựng', formula: 'Nhập', value: s.tuVan },
      { code: 'Gk', name: 'Chi phí khác', formula: 'Nhập', value: s.other },
      {
        code: 'Gdp1',
        name: 'Dự phòng cho khối lượng phát sinh',
        formula: `(Gxd + Gtb + Gqlda + Gtv + Gk) × ${pct(s.contingencyQtyRate)}`,
        value: dp1,
      },
      {
        code: 'Gdp2',
        name: 'Dự phòng cho yếu tố trượt giá',
        formula: `(Gxd + Gtb + Gqlda + Gtv + Gk) × ${pct(s.contingencyPriceRate)}`,
        value: dp2,
      },
      { code: 'TDT', name: 'Tổng dự toán', formula: 'Tổng các khoản trên', value: total },
    ],
  };
}

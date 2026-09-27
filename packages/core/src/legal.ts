import { computeCostSummary, pct, type CostLine, type CostSummary, type CostTriple, type TotalEstimateLine } from './calc.js';
import type { RatesTable } from './rates.js';
import { DEFAULT_COST_SETTINGS } from './rates.js';
import type { BuildingType, CostSettings } from './types.js';

// ---------------------------------------------------------------------------
// Versioned legal sets and rate tables stored as data (data/legal/*.json)
// ---------------------------------------------------------------------------

export type LegalSetId = 'TT36_2026' | 'TT11_2021';
export type RateStatus = 'provisional' | 'verified';

export interface RateTableRow {
  key: string;
  label: string;
  /** One value per bracket, or a single value for flat tables. Percent. */
  values: number[];
}

export interface RateTable {
  id: string;
  title: string;
  source: string;
  /** Base the bracket is looked up on (and the rate applied to). */
  basis: 'T' | 'NC' | 'GXDTT' | 'T+GT';
  /** Upper bounds (VND, inclusive) of each bracket; the last bracket is open-ended. */
  brackets?: number[];
  bracketLabels?: string[];
  interpolation: 'none' | 'linear';
  status: RateStatus;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  rows: RateTableRow[];
}

export interface LegalSet {
  id: LegalSetId;
  label: string;
  method: LegalSetId;
  status: 'current' | 'historical';
  effectiveFrom: string | null;
  effectiveTo: string | null;
  normDataset: string;
  documents: string[];
  note: string;
  tables: Record<string, RateTable>;
}

export interface LegalDocument {
  id: string;
  number: string;
  type: string;
  title: string;
  issuer: string;
  issued: string | null;
  effective: string | null;
  status: 'active' | 'repealed';
  role: string;
  url: string | null;
  verified: boolean;
  amendedBy?: string[];
  repealedBy?: string;
}

export const LEGAL_SET_CUTOVER = '2026-07-01';

/** Default legal set for a price date (ISO yyyy-mm-dd). Empty date → today's rules (current set). */
export function defaultLegalSetFor(priceDate: string | null | undefined): LegalSetId {
  if (priceDate && /^\d{4}-\d{2}-\d{2}$/.test(priceDate) && priceDate < LEGAL_SET_CUTOVER) return 'TT11_2021';
  return 'TT36_2026';
}

/** Mismatch warning when the chosen legal set does not match the price date. */
export function legalSetDateWarning(set: LegalSetId, priceDate: string | null | undefined): string | null {
  if (!priceDate) return null;
  const expected = defaultLegalSetFor(priceDate);
  if (expected === set) return null;
  return set === 'TT11_2021'
    ? `Thời điểm lập giá ${priceDate} từ ngày ${LEGAL_SET_CUTOVER}: TT 11/2021 đã bị bãi bỏ, nên dùng bộ TT 36/2026 + TT 38/2026.`
    : `Thời điểm lập giá ${priceDate} trước ngày ${LEGAL_SET_CUTOVER}: TT 36/2026 chưa có hiệu lực, cân nhắc bộ lịch sử TT 11/2021.`;
}

export interface RateLookup {
  rate: number;
  rowLabel: string;
  bracketLabel: string;
  interpolated: boolean;
  table: RateTable;
}

/**
 * Look up a rate by row and base amount. Brackets are inclusive upper bounds ("≤ 40 tỷ").
 * Without interpolation the rate of the bracket containing the base is used; with linear
 * interpolation the value is interpolated between the neighbouring bracket bounds.
 */
export function lookupRate(table: RateTable, rowKey: string, base: number, interpolation = table.interpolation): RateLookup {
  const row = table.rows.find((r) => r.key === rowKey);
  if (!row) throw new Error(`Bảng ${table.id} không có dòng "${rowKey}"`);
  const b = table.brackets ?? [];
  if (!b.length || row.values.length === 1) {
    return { rate: row.values[0], rowLabel: row.label, bracketLabel: '', interpolated: false, table };
  }
  let i = b.findIndex((ub) => base <= ub);
  if (i === -1) i = b.length;
  const label = table.bracketLabels?.[i] ?? '';
  if (interpolation === 'linear' && i > 0 && i < b.length) {
    const x0 = b[i - 1];
    const x1 = b[i];
    const y0 = row.values[i - 1];
    const y1 = row.values[i];
    const rate = y0 + ((y1 - y0) * (base - x0)) / (x1 - x0);
    return { rate, rowLabel: row.label, bracketLabel: `nội suy ${table.bracketLabels?.[i - 1]} – ${label}`, interpolated: true, table };
  }
  return { rate: row.values[Math.min(i, row.values.length - 1)], rowLabel: row.label, bracketLabel: label, interpolated: false, table };
}

function describe(l: RateLookup, basisValue: string): string {
  const status = l.table.status === 'verified' ? 'đã xác minh' : 'TẠM – chưa đối chiếu bản ký';
  const bracket = l.bracketLabel ? `, ${basisValue} ${l.bracketLabel}` : '';
  return `${l.table.source} – ${l.rowLabel}${bracket} [${status}]`;
}

// ---------------------------------------------------------------------------
// TT 36/2026 – Bảng 3.8 (đính chính theo QĐ 1538/QĐ-BXD)
// ---------------------------------------------------------------------------

/** Work category of Bảng 3.3 / 3.5 (rows). */
export const TT36_WORK_CATEGORIES: Record<string, string> = {
  dan_dung: 'Dân dụng',
  tu_bo_di_tich: 'Tu bổ, phục hồi di tích',
  cong_nghiep: 'Công nghiệp',
  cong_nghiep_ham: 'Công nghiệp – hầm thủy điện, hầm lò',
  giao_thong: 'Giao thông',
  giao_thong_ham: 'Giao thông – hầm',
  nn_mt: 'Nông nghiệp và môi trường',
  nn_ham: 'Nông nghiệp – hầm',
  ha_tang: 'Hạ tầng kỹ thuật',
};

/** Default row of Bảng 3.5 / 3.6 for each work category (tables have fewer rows than Bảng 3.3). */
const TT_ROW: Record<string, string> = { tu_bo_di_tich: 'dan_dung' };
const TL_ROW: Record<string, string> = {
  tu_bo_di_tich: 'dan_dung',
  cong_nghiep_ham: 'cong_nghiep',
  giao_thong_ham: 'giao_thong',
  nn_ham: 'nn_mt',
};

export const BUILDING_TO_TT36: Record<BuildingType, string> = {
  dan_dung: 'dan_dung',
  cong_nghiep: 'cong_nghiep',
  giao_thong: 'giao_thong',
  nn_ptnt: 'nn_mt',
  ha_tang: 'ha_tang',
};

export interface Tt36Settings {
  autoRates: boolean;
  /** Row of Bảng 3.3 / 3.5. */
  workCategory: string;
  /** Chi phí chung on T (Bảng 3.3) or on NC for listed work types (Bảng 3.4). */
  cMode: 'T' | 'NC';
  /** Row of Bảng 3.4 when cMode = NC. */
  ncWorkType: string;
  /** Row of Bảng 3.6 (defaults from workCategory, or "lap_dat" for installation work). */
  tlCategory?: string;
  /** Công trình theo tuyến → Bảng 3.7 row "theo_tuyen". */
  linearWorks: boolean;
  /** Manual rates (%), used when autoRates = false. */
  cRate: number;
  ttRate: number;
  tlRate: number;
  ntRate: number;
  /** Knc = 1 + nightShare × nightPremium (both %). */
  nightShare: number;
  nightPremium: number;
  /** Km = 1 + g × (Knc − 1), g = machineLaborShare (%) – tỷ trọng tiền lương trong giá ca máy. */
  machineLaborShare: number;
  /** Tổng dự toán inputs (VND). */
  equipment: number;
  qlda: number;
  tuVan: number;
  other: number;
  /** Dự phòng khối lượng/công việc phát sinh (%). */
  contingencyQtyRate: number;
  /** Dự phòng trượt giá: fixed % or computed from duration and chỉ số giá xây dựng liên hoàn. */
  contingencyPriceMode: 'percent' | 'index';
  contingencyPriceRate: number;
  /** Mean yearly construction price index change (%/năm) and duration (years). */
  priceIndexRate: number;
  durationYears: number;
}

export function defaultTt36Settings(buildingType: BuildingType = 'dan_dung'): Tt36Settings {
  return {
    autoRates: true,
    workCategory: BUILDING_TO_TT36[buildingType] ?? 'dan_dung',
    cMode: 'T',
    ncWorkType: 'lap_dat',
    linearWorks: buildingType === 'giao_thong',
    cRate: 0,
    ttRate: 0,
    tlRate: 0,
    ntRate: 0,
    nightShare: 0,
    nightPremium: 0,
    machineLaborShare: 0,
    equipment: 0,
    qlda: 0,
    tuVan: 0,
    other: 0,
    contingencyQtyRate: 5,
    contingencyPriceMode: 'percent',
    contingencyPriceRate: 0,
    priceIndexRate: 0,
    durationYears: 1,
  };
}

export function knc(s: Pick<Tt36Settings, 'nightShare' | 'nightPremium'>): number {
  return 1 + (s.nightShare / 100) * (s.nightPremium / 100);
}

export function km(s: Pick<Tt36Settings, 'nightShare' | 'nightPremium' | 'machineLaborShare'>): number {
  return 1 + (s.machineLaborShare / 100) * (knc(s) - 1);
}

export interface Tt36Result extends CostSummary {
  Knc: number;
  Km: number;
  GXDTT: number;
  GXD: number;
  GXDNT: number;
  /** Resolved rates actually applied (%). */
  rates: { c: number; tt: number; tl: number; nt: number };
  warnings: string[];
}

/** Chi phí xây dựng per Bảng 3.8 TT 36/2026 (as corrected by QĐ 1538/QĐ-BXD). `direct` is before Knc/Km. */
export function computeTt36(direct: CostTriple, s: Tt36Settings, set: LegalSet, vatRate: number): Tt36Result {
  const t = set.tables;
  const warnings: string[] = [];
  const Knc = knc(s);
  const Km = km(s);
  const VL = direct.vl;
  const NC = direct.nc * Knc;
  const M = direct.m * Km;
  const T = VL + NC + M;

  const auto = s.autoRates;
  const manual = (rate: number) => ({ rate, source: 'Tỷ lệ do người dùng nhập (không lấy theo bảng)' });

  // C – chi phí chung
  let c: { rate: number; source: string };
  if (s.cMode === 'NC') {
    if (auto) {
      const l = lookupRate(t['3.4'], s.ncWorkType, NC);
      c = { rate: l.rate, source: describe(l, 'NC') };
    } else c = manual(s.cRate);
  } else if (auto) {
    const l = lookupRate(t['3.3'], s.workCategory, T);
    c = { rate: l.rate, source: describe(l, 'T') };
  } else c = manual(s.cRate);
  const C = ((s.cMode === 'NC' ? NC : T) * c.rate) / 100;

  // TT – công việc không xác định được khối lượng từ thiết kế
  let tt: { rate: number; source: string };
  if (auto) {
    const row = TT_ROW[s.workCategory] ?? s.workCategory;
    if (row !== s.workCategory) warnings.push(`Bảng 3.5 không có dòng riêng cho "${TT36_WORK_CATEGORIES[s.workCategory]}" – tạm dùng dòng "${TT36_WORK_CATEGORIES[row]}", cần kiểm tra.`);
    const l = lookupRate(t['3.5'], row, T);
    tt = { rate: l.rate, source: describe(l, 'T') };
  } else tt = manual(s.ttRate);
  const TT = (T * tt.rate) / 100;
  const GT = C + TT;

  // TL – thu nhập chịu thuế tính trước
  let tl: { rate: number; source: string };
  if (auto) {
    const row = s.tlCategory ?? (s.cMode === 'NC' && s.ncWorkType === 'lap_dat' ? 'lap_dat' : TL_ROW[s.workCategory] ?? s.workCategory);
    if (!s.tlCategory && TL_ROW[s.workCategory]) warnings.push(`Bảng 3.6 không có dòng riêng cho "${TT36_WORK_CATEGORIES[s.workCategory]}" – tạm dùng dòng gần nhất, cần kiểm tra.`);
    const l = lookupRate(t['3.6'], row, T + GT);
    tl = { rate: l.rate, source: describe(l, 'T + GT') };
  } else tl = manual(s.tlRate);
  const TL = ((T + GT) * tl.rate) / 100;

  const GXDTT = T + GT + TL;
  const GTGT = (GXDTT * vatRate) / 100;
  const GXD = GXDTT + GTGT;

  // V – nhà tạm (separate line after VAT)
  let nt: { rate: number; source: string };
  if (auto) {
    const l = lookupRate(t['3.7'], s.linearWorks ? 'theo_tuyen' : 'con_lai', GXDTT);
    nt = { rate: l.rate, source: describe(l, 'GXDTT') };
  } else nt = manual(s.ntRate);
  const GXDNT = ((GXDTT * nt.rate) / 100) * (1 + vatRate / 100);

  for (const tab of Object.values(t)) {
    if (tab.status !== 'verified') {
      warnings.unshift(`Các bảng tỷ lệ của ${set.label} đang ở trạng thái TẠM (provisional) – cần đối chiếu bản PDF đã ký và phụ lục thay thế theo CV 9947/BXD-VP.`);
      break;
    }
  }

  const src38 = 'TT 36/2026/TT-BXD, Phụ lục III, Bảng 3.8 (đính chính QĐ 1538/QĐ-BXD)';
  const kSrc = 'TT 37/2026/TT-BXD – hệ số điều chỉnh khi làm đêm';
  const lines: CostLine[] = [
    { code: 'VL', name: 'Chi phí vật liệu', formula: 'Σ Qj × Dj_vl', value: VL, level: 1, stt: '1', source: src38, expr: '{DT.VL}' },
    {
      code: 'NC',
      name: 'Chi phí nhân công',
      formula: `Σ Qj × Dj_nc × Knc (Knc = ${Knc.toFixed(4).replace('.', ',')})`,
      coef: Knc,
      value: NC,
      level: 1,
      stt: '2',
      source: `${src38}; ${kSrc}`,
      expr: '{DT.NC}*{coef}',
    },
    {
      code: 'M',
      name: 'Chi phí máy và thiết bị thi công',
      formula: `Σ Qj × Dj_m × Km (Km = ${Km.toFixed(4).replace('.', ',')})`,
      coef: Km,
      value: M,
      level: 1,
      stt: '3',
      source: `${src38}; ${kSrc}`,
      expr: '{DT.M}*{coef}',
    },
    { code: 'T', name: 'Chi phí trực tiếp', formula: 'VL + NC + M', value: T, level: 0, stt: 'I', source: src38, expr: '{VL}+{NC}+{M}' },
    {
      code: 'C',
      name: 'Chi phí chung',
      formula: `${s.cMode} × ${pct(+c.rate.toFixed(4))}`,
      rate: c.rate,
      value: C,
      level: 1,
      stt: '1',
      source: c.source,
      expr: `{${s.cMode}}*{rate}/100`,
    },
    {
      code: 'TT',
      name: 'Chi phí một số công việc không xác định được khối lượng từ thiết kế',
      formula: `T × ${pct(tt.rate)}`,
      rate: tt.rate,
      value: TT,
      level: 1,
      stt: '2',
      source: tt.source,
      expr: '{T}*{rate}/100',
    },
    { code: 'GT', name: 'Chi phí gián tiếp', formula: 'C + TT', value: GT, level: 0, stt: 'II', source: src38, expr: '{C}+{TT}' },
    {
      code: 'TL',
      name: 'Thu nhập chịu thuế tính trước',
      formula: `(T + GT) × ${pct(tl.rate)}`,
      rate: tl.rate,
      value: TL,
      level: 0,
      stt: 'III',
      source: tl.source,
      expr: '({T}+{GT})*{rate}/100',
    },
    { code: 'GXDTT', name: 'Chi phí xây dựng trước thuế', formula: 'T + GT + TL', value: GXDTT, level: 0, stt: '', source: src38, expr: '{T}+{GT}+{TL}' },
    {
      code: 'GTGT',
      name: 'Thuế giá trị gia tăng',
      formula: `GXDTT × ${pct(vatRate)}`,
      rate: vatRate,
      value: GTGT,
      level: 0,
      stt: 'IV',
      source: 'Thuế suất GTGT theo quy định hiện hành (nhập theo công trình)',
      expr: '{GXDTT}*{rate}/100',
    },
    { code: 'GXD', name: 'Chi phí xây dựng sau thuế', formula: 'GXDTT + GTGT', value: GXD, level: 0, stt: '', source: src38, expr: '{GXDTT}+{GTGT}' },
    {
      code: 'GXDNT',
      name: 'Chi phí nhà tạm để ở và điều hành thi công',
      formula: `GXDTT × ${pct(nt.rate)} × (1 + ${pct(vatRate)})`,
      rate: nt.rate,
      value: GXDNT,
      level: 0,
      stt: 'V',
      source: nt.source,
      expr: '{GXDTT}*{rate}/100*(1+{rate:GTGT}/100)',
    },
  ];

  return {
    lines,
    T,
    GT,
    TL,
    G: GXDTT,
    GTGT,
    Gxd: GXD,
    nhaTam: GXDNT,
    total: GXD + GXDNT,
    Knc,
    Km,
    GXDTT,
    GXD,
    GXDNT,
    rates: { c: c.rate, tt: tt.rate, tl: tl.rate, nt: nt.rate },
    warnings,
  };
}

export interface ContingencyResult {
  lines: TotalEstimateLine[];
  total: number;
  dp1: number;
  dp2: number;
}

/**
 * Tổng dự toán with the two dự phòng components (TT 36/2026, wording corrected by QĐ 1538):
 *  - Gdp1 = base × tỷ lệ khối lượng/công việc phát sinh
 *  - Gdp2 = fixed % of base, or Σ_t (base / N) × [(1 + i)^t − 1] from duration N (years) and
 *    mean yearly construction price index change i (chỉ số giá xây dựng liên hoàn). Base excludes dự phòng.
 */
export function computeTotalEstimateTt36(constructionCost: number, s: Tt36Settings): ContingencyResult {
  const base = constructionCost + s.equipment + s.qlda + s.tuVan + s.other;
  const dp1 = (base * s.contingencyQtyRate) / 100;
  let dp2: number;
  let dp2Formula: string;
  if (s.contingencyPriceMode === 'index') {
    const n = Math.max(1, Math.round(s.durationYears));
    const i = s.priceIndexRate / 100;
    dp2 = 0;
    for (let y = 1; y <= n; y++) dp2 += (base / n) * (Math.pow(1 + i, y) - 1);
    dp2Formula = `Σ (V/${n}) × [(1 + ${pct(s.priceIndexRate)})^t − 1], t = 1…${n} năm`;
  } else {
    dp2 = (base * s.contingencyPriceRate) / 100;
    dp2Formula = `V × ${pct(s.contingencyPriceRate)}`;
  }
  const total = base + dp1 + dp2;
  return {
    total,
    dp1,
    dp2,
    lines: [
      { code: 'Gxd', name: 'Chi phí xây dựng (GXD + GXDNT)', formula: 'Bảng tổng hợp chi phí xây dựng', value: constructionCost },
      { code: 'Gtb', name: 'Chi phí thiết bị', formula: 'Nhập', value: s.equipment },
      { code: 'Gqlda', name: 'Chi phí quản lý dự án', formula: 'Nhập', value: s.qlda },
      { code: 'Gtv', name: 'Chi phí tư vấn đầu tư xây dựng', formula: 'Nhập', value: s.tuVan },
      { code: 'Gk', name: 'Chi phí khác', formula: 'Nhập', value: s.other },
      { code: 'Gdp1', name: 'Dự phòng cho khối lượng, công việc phát sinh', formula: `V × ${pct(s.contingencyQtyRate)}`, value: dp1 },
      { code: 'Gdp2', name: 'Dự phòng cho yếu tố trượt giá', formula: dp2Formula, value: dp2 },
      { code: 'TDT', name: 'Tổng dự toán', formula: 'V + Gdp1 + Gdp2 (V = Gxd + Gtb + Gqlda + Gtv + Gk)', value: total },
    ],
  };
}

// ---------------------------------------------------------------------------
// TT 11/2021 (historical) – adapter from data tables to the Phase 1 engine
// ---------------------------------------------------------------------------

export function tt11RatesTable(set: LegalSet): RatesTable {
  const c = set.tables.C;
  const lt = set.tables.LT;
  const tt = set.tables.TT;
  const tl = set.tables.TL;
  const types: Record<string, RatesTable['buildingTypes'][BuildingType]> = {};
  for (const row of c.rows) {
    types[row.key] = {
      label: row.label,
      cBase: 'T',
      c: row.values,
      lt: lt.rows.find((r) => r.key === row.key)?.values ?? [0],
      tt: tt.rows.find((r) => r.key === row.key)?.values[0] ?? 0,
      gtk: 0,
      tl: tl.rows.find((r) => r.key === row.key)?.values[0] ?? 0,
    };
  }
  return {
    _note: set.note,
    brackets: c.brackets ?? [],
    bracketLabels: c.bracketLabels ?? [],
    bracketBasis: 'T',
    buildingTypes: types as RatesTable['buildingTypes'],
  };
}

// ---------------------------------------------------------------------------
// Dispatcher used by the server
// ---------------------------------------------------------------------------

export type ProjectCostSettings = Partial<CostSettings> & Partial<Tt36Settings>;

export interface ProjectCost {
  legalSetId: LegalSetId;
  costSummary: CostSummary & { warnings?: string[]; Knc?: number; Km?: number };
  totalEstimate: { lines: TotalEstimateLine[]; total: number };
  /** Settings actually applied (auto rates resolved). */
  settings: ProjectCostSettings;
  ratesSource: string;
  warnings: string[];
}

export function computeProjectCost(
  set: LegalSet,
  direct: CostTriple,
  stored: ProjectCostSettings | null | undefined,
  buildingType: BuildingType,
  vatRate: number,
): ProjectCost {
  if (set.method === 'TT36_2026') {
    const s: Tt36Settings = { ...defaultTt36Settings(buildingType), ...(stored ?? {}) } as Tt36Settings;
    const cs = computeTt36(direct, s, set, vatRate);
    const tdt = computeTotalEstimateTt36(cs.total!, s);
    const warnings = [...cs.warnings];
    if (tdt.dp2 === 0) warnings.push('Dự phòng trượt giá đang bằng 0 – kiểm tra thời gian thực hiện và chỉ số giá xây dựng.');
    return {
      legalSetId: set.id,
      costSummary: cs,
      totalEstimate: tdt,
      settings: { ...s, cRate: cs.rates.c, ttRate: cs.rates.tt, tlRate: cs.rates.tl, ntRate: cs.rates.nt },
      ratesSource: s.autoRates ? `${set.label} – Phụ lục III TT 36/2026, Bảng 3.3–3.7` : 'Tỷ lệ do người dùng nhập',
      warnings,
    };
  }
  // Historical TT 11/2021 engine (Phase 1) – unchanged results for existing projects.
  const table = tt11RatesTable(set);
  const s: CostSettings = { ...DEFAULT_COST_SETTINGS, ...(stored ?? {}) } as CostSettings;
  let settings = s;
  let source = 'Hệ số do người dùng nhập';
  if (s.autoRates) {
    const bt = table.buildingTypes[buildingType] ?? table.buildingTypes.dan_dung;
    const i = (() => {
      const k = table.brackets.findIndex((b) => direct.vl + direct.nc + direct.m <= b);
      return k === -1 ? table.brackets.length : k;
    })();
    const at = (arr: number[]) => arr[Math.min(i, arr.length - 1)];
    settings = { ...s, cBase: bt.cBase, cRate: at(bt.c), ltRate: at(bt.lt), ttRate: bt.tt, gtkRate: bt.gtk, tlRate: bt.tl };
    source = `${set.label} – ${bt.label}, nhóm chi phí ${table.bracketLabels[i] ?? ''} (GIÁ TRỊ MẪU)`;
  }
  const cs = computeCostSummary(direct, settings, vatRate);
  for (const l of cs.lines) if (['C', 'LT', 'TT', 'GTk', 'TL'].includes(l.code)) l.source = source;
  const base = cs.Gxd + s.equipment + s.qlda + s.tuVan + s.other;
  const dp1 = (base * s.contingencyQtyRate) / 100;
  const dp2 = (base * s.contingencyPriceRate) / 100;
  const warnings = [`Công trình dùng bộ pháp lý lịch sử ${set.label}. TT 11/2021/TT-BXD đã bị bãi bỏ từ 01/07/2026.`];
  if (Object.values(set.tables).some((t) => t.status !== 'verified')) warnings.push('Tỷ lệ của bộ lịch sử là GIÁ TRỊ MẪU Phase 1 – chưa đối chiếu văn bản gốc.');
  return {
    legalSetId: set.id,
    costSummary: { ...cs, warnings },
    totalEstimate: {
      total: base + dp1 + dp2,
      lines: [
        { code: 'Gxd', name: 'Chi phí xây dựng', formula: 'Bảng tổng hợp chi phí xây dựng', value: cs.Gxd },
        { code: 'Gtb', name: 'Chi phí thiết bị', formula: 'Nhập', value: s.equipment },
        { code: 'Gqlda', name: 'Chi phí quản lý dự án', formula: 'Nhập', value: s.qlda },
        { code: 'Gtv', name: 'Chi phí tư vấn đầu tư xây dựng', formula: 'Nhập', value: s.tuVan },
        { code: 'Gk', name: 'Chi phí khác', formula: 'Nhập', value: s.other },
        { code: 'Gdp1', name: 'Dự phòng cho khối lượng phát sinh', formula: `V × ${pct(s.contingencyQtyRate)}`, value: dp1 },
        { code: 'Gdp2', name: 'Dự phòng cho yếu tố trượt giá', formula: `V × ${pct(s.contingencyPriceRate)}`, value: dp2 },
        { code: 'TDT', name: 'Tổng dự toán', formula: 'Tổng các khoản trên', value: base + dp1 + dp2 },
      ],
    },
    settings,
    ratesSource: source,
    warnings,
  };
}

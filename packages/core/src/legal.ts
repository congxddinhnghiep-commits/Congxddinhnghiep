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
  basis: 'T' | 'NC' | 'GXDTT' | 'T+GT' | 'GXDTT_TMDT';
  /** Amount the rate is applied to (may differ from the bracket base). */
  appliedTo?: string;
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

/**
 * Parent row rule (docs/UPDATE-2.md A2): Bảng 3.5 has no row for tu bổ di tích → use "dân dụng";
 * Bảng 3.6 has no sub-rows for hầm / di tích → use the parent loại công trình.
 */
const TT_PARENT: Record<string, string> = { tu_bo_di_tich: 'dan_dung' };
const TL_PARENT: Record<string, string> = {
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

/** Maximum rate for dự phòng khối lượng/công việc phát sinh (TT 36/2026 PL II, công thức 2.8). */
export const MAX_KPS = 5;

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
  /**
   * Chi phí xây dựng trước thuế của công trình trong TMĐT được duyệt (tỷ đồng) – base for the
   * brackets of Bảng 3.3 and 3.7. Empty → the estimate's own GXDTT is used (iterated) with a warning.
   */
  gxdttTmdt?: number | null;
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
  /** kps – dự phòng khối lượng/công việc phát sinh (%), ≤ 5%. */
  contingencyQtyRate: number;
  /**
   * 'formula' = công thức 2.9 TT 36/2026; 'percent' = tỷ lệ nhập tay (không theo công thức 2.9);
   * 'index' = legacy (Update 1) setting, read as 'formula' with I_bq = 1 + priceIndexRate/100.
   */
  contingencyPriceMode: 'formula' | 'percent' | 'index';
  contingencyPriceRate: number;
  /** Number of periods T and their unit. */
  contingencyPeriods: number;
  contingencyPeriodUnit: 'nam' | 'quy';
  /** Share (%) of G_TDP executed in each period t; empty/invalid → equal split. */
  contingencySchedule?: number[];
  /** I_bq – chỉ số giá XD bình quân dùng tính dự phòng (e.g. 1,03). */
  priceIndexAvg: number;
  /** ΔI – mức biến động bình quân của chỉ số giá XD (e.g. 0,005). */
  priceIndexDelta: number;
  /** Legacy (Update 1). */
  priceIndexRate?: number;
  durationYears?: number;
}

export function defaultTt36Settings(buildingType: BuildingType = 'dan_dung'): Tt36Settings {
  return {
    autoRates: true,
    workCategory: BUILDING_TO_TT36[buildingType] ?? 'dan_dung',
    cMode: 'T',
    ncWorkType: 'lap_dat',
    linearWorks: buildingType === 'giao_thong',
    gxdttTmdt: null,
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
    contingencyPriceMode: 'formula',
    contingencyPriceRate: 0,
    contingencyPeriods: 1,
    contingencyPeriodUnit: 'nam',
    contingencySchedule: [],
    priceIndexAvg: 1,
    priceIndexDelta: 0,
  };
}

export function knc(s: Pick<Tt36Settings, 'nightShare' | 'nightPremium'>): number {
  return 1 + (s.nightShare / 100) * (s.nightPremium / 100);
}

export function km(s: Pick<Tt36Settings, 'nightShare' | 'nightPremium' | 'machineLaborShare'>): number {
  return 1 + (s.machineLaborShare / 100) * (knc(s) - 1);
}

/** Direct cost of one hạng mục, with an optional TT rate override (e.g. công tác trong đường hầm). */
export interface CategoryCost {
  id: number;
  name: string;
  direct: CostTriple;
  ttRate?: number | null;
}

export interface Tt36Result extends CostSummary {
  Knc: number;
  Km: number;
  GXDTT: number;
  GXD: number;
  GXDNT: number;
  /** Resolved rates actually applied (%). */
  rates: { c: number; tt: number; tl: number; nt: number };
  /** Amount (VND) used to look up the brackets of Bảng 3.3 / 3.7 and where it came from. */
  bracketBase: { value: number; from: 'tmdt' | 'estimate' };
  warnings: string[];
  /** Informational notes (rules applied), not problems. */
  notes: string[];
}

interface Tt36Pass {
  lines: CostLine[];
  T: number;
  GT: number;
  TL: number;
  GXDTT: number;
  GTGT: number;
  GXD: number;
  GXDNT: number;
  rates: { c: number; tt: number; tl: number; nt: number };
  /** Bracket index used for Bảng 3.3 (-1 when not used) and 3.7. */
  brackets: [number, number];
}

function bracketOf(table: RateTable, base: number): number {
  const b = table.brackets ?? [];
  const i = b.findIndex((ub) => base <= ub);
  return i === -1 ? b.length : i;
}

/**
 * Chi phí xây dựng per Bảng 3.8 TT 36/2026 (as corrected by QĐ 1538/QĐ-BXD). `direct` is before Knc/Km.
 * Bảng 3.3 / 3.7 brackets are looked up by the công trình's chi phí XD trước thuế in the approved TMĐT
 * (settings.gxdttTmdt, tỷ đồng); without it, the estimate's own GXDTT is used and iterated until stable.
 */
export function computeTt36(
  direct: CostTriple,
  s: Tt36Settings,
  set: LegalSet,
  vatRate: number,
  opts: { categories?: CategoryCost[] } = {},
): Tt36Result {
  const t = set.tables;
  const warnings: string[] = [];
  const notes: string[] = [];
  const Knc = knc(s);
  const Km = km(s);
  const VL = direct.vl;
  const NC = direct.nc * Knc;
  const M = direct.m * Km;
  const T = VL + NC + M;
  const auto = s.autoRates;
  const manual = (rate: number) => ({ rate, source: 'Tỷ lệ do người dùng nhập (không lấy theo bảng)' });

  const provisional = Object.values(t).filter((tab) => tab.status !== 'verified');
  if (provisional.length) {
    warnings.push(
      `Bảng ${provisional.map((x) => x.id).join(', ')} của ${set.label} đang ở trạng thái TẠM (provisional) – cần đối chiếu bản PDF đã ký trước khi dùng.`,
    );
  }
  for (const tab of Object.values(t)) {
    if (tab.interpolation === 'linear') {
      warnings.push(`Bảng ${tab.id} đang bật nội suy – không có căn cứ trong TT 36/2026 (chỉ tra theo khoảng).`);
    }
  }

  // Rows that do not depend on the bracket base
  const ttRow = TT_PARENT[s.workCategory] ?? s.workCategory;
  if (auto && ttRow !== s.workCategory) {
    notes.push(`Bảng 3.5 không có dòng riêng cho "${TT36_WORK_CATEGORIES[s.workCategory]}" – áp dụng dòng loại công trình cha "${TT36_WORK_CATEGORIES[ttRow]}".`);
  }
  const tlRow = s.tlCategory ?? (s.cMode === 'NC' && s.ncWorkType === 'lap_dat' ? 'lap_dat' : TL_PARENT[s.workCategory] ?? s.workCategory);
  if (auto && !s.tlCategory && TL_PARENT[s.workCategory]) {
    notes.push(`Bảng 3.6 không có dòng riêng cho "${TT36_WORK_CATEGORIES[s.workCategory]}" – áp dụng dòng loại công trình cha "${TT36_WORK_CATEGORIES[tlRow]}".`);
  }

  const tmdt = s.gxdttTmdt && s.gxdttTmdt > 0 ? s.gxdttTmdt * 1e9 : null;

  const pass = (bracketBase: number): Tt36Pass => {
    let c: { rate: number; source: string };
    let b33 = -1;
    if (s.cMode === 'NC') {
      if (auto) {
        const l = lookupRate(t['3.4'], s.ncWorkType, NC);
        c = { rate: l.rate, source: describe(l, 'chi phí nhân công') };
      } else c = manual(s.cRate);
    } else if (auto) {
      const l = lookupRate(t['3.3'], s.workCategory, bracketBase);
      b33 = bracketOf(t['3.3'], bracketBase);
      c = { rate: l.rate, source: describe(l, 'chi phí XD trước thuế trong TMĐT') };
    } else c = manual(s.cRate);
    const C = ((s.cMode === 'NC' ? NC : T) * c.rate) / 100;

    let tt: { rate: number; source: string };
    if (auto) {
      const l = lookupRate(t['3.5'], ttRow, T);
      tt = { rate: l.rate, source: describe(l, '') };
    } else tt = manual(s.ttRate);
    // Per-hạng mục override (công tác XD trong đường hầm…): TT = Σ T_hm × tỷ lệ_hm
    let TT = (T * tt.rate) / 100;
    let ttAdjust = 0;
    const overridden = (opts.categories ?? []).filter((cat) => cat.ttRate !== null && cat.ttRate !== undefined);
    for (const cat of overridden) {
      const Tcat = cat.direct.vl + cat.direct.nc * Knc + cat.direct.m * Km;
      ttAdjust += (Tcat * (cat.ttRate! - tt.rate)) / 100;
    }
    TT += ttAdjust;
    const GT = C + TT;

    let tl: { rate: number; source: string };
    if (auto) {
      const l = lookupRate(t['3.6'], tlRow, T + GT);
      tl = { rate: l.rate, source: describe(l, '') };
    } else tl = manual(s.tlRate);
    const TL = ((T + GT) * tl.rate) / 100;
    const GXDTT = T + GT + TL;
    const GTGT = (GXDTT * vatRate) / 100;
    const GXD = GXDTT + GTGT;

    let nt: { rate: number; source: string };
    let b37 = -1;
    if (auto) {
      const l = lookupRate(t['3.7'], s.linearWorks ? 'theo_tuyen' : 'con_lai', bracketBase);
      b37 = bracketOf(t['3.7'], bracketBase);
      nt = { rate: l.rate, source: describe(l, 'chi phí XD trước thuế trong TMĐT') };
    } else nt = manual(s.ntRate);
    const GXDNT = ((GXDTT * nt.rate) / 100) * (1 + vatRate / 100);

    const src38 = 'TT 36/2026/TT-BXD, Phụ lục III, Bảng 3.8 (đính chính QĐ 1538/QĐ-BXD)';
    const kSrc = 'hệ số điều chỉnh khi làm đêm (Knc, Km)';
    const ttLine: CostLine = {
      code: 'TT',
      name: 'Chi phí một số công việc không xác định được khối lượng từ thiết kế',
      formula: overridden.length ? `T × ${pct(tt.rate)}; hạng mục ${overridden.map((o) => `"${o.name}" ${pct(o.ttRate!)}`).join(', ')}` : `T × ${pct(tt.rate)}`,
      rate: tt.rate,
      value: TT,
      level: 1,
      stt: '2',
      source: overridden.length ? `${tt.source}; tỷ lệ riêng theo hạng mục (công tác XD trong đường hầm)` : tt.source,
      expr: overridden.length ? `{T}*{rate}/100+${ttAdjust}` : '{T}*{rate}/100',
    };
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
      ttLine,
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
    return { lines, T, GT, TL, GXDTT, GTGT, GXD, GXDNT, rates: { c: c.rate, tt: tt.rate, tl: tl.rate, nt: nt.rate }, brackets: [b33, b37] };
  };

  let result: Tt36Pass;
  let bracketBase: { value: number; from: 'tmdt' | 'estimate' };
  if (tmdt !== null) {
    result = pass(tmdt);
    bracketBase = { value: tmdt, from: 'tmdt' };
  } else {
    // Fixed-point iteration: bracket from T first, then from the resulting GXDTT until the brackets are stable.
    let base = T;
    const seen = new Map<string, Tt36Pass>();
    result = pass(base);
    for (let i = 0; i < 20; i++) {
      const key = result.brackets.join(',');
      const next = pass(result.GXDTT);
      if (next.brackets.join(',') === key) {
        result = next;
        break;
      }
      if (seen.has(next.brackets.join(','))) {
        // Oscillating at a bracket boundary: keep the pass whose own GXDTT is larger (higher bracket).
        const candidates = [...seen.values(), result, next];
        result = candidates.reduce((a, b) => (b.GXDTT > a.GXDTT ? b : a));
        warnings.push('Giá trị dự toán dao động quanh biên khoảng của Bảng 3.3/3.7 – đã chọn khoảng theo GXDTT lớn hơn, cần kiểm tra.');
        break;
      }
      seen.set(key, result);
      result = next;
      base = result.GXDTT;
    }
    bracketBase = { value: result.GXDTT, from: 'estimate' };
    if (auto) {
      warnings.push('Chưa nhập chi phí XD trong TMĐT được duyệt – đang dùng giá trị dự toán để tra khoảng.');
    }
  }

  return {
    lines: result.lines,
    T: result.T,
    GT: result.GT,
    TL: result.TL,
    G: result.GXDTT,
    GTGT: result.GTGT,
    Gxd: result.GXD,
    nhaTam: result.GXDNT,
    total: result.GXD + result.GXDNT,
    Knc,
    Km,
    GXDTT: result.GXDTT,
    GXD: result.GXD,
    GXDNT: result.GXDNT,
    rates: result.rates,
    bracketBase,
    warnings,
    notes,
  };
}

export interface ContingencyResult {
  lines: TotalEstimateLine[];
  total: number;
  dp1: number;
  dp2: number;
  warnings: string[];
}

/** Resolve the dự phòng trượt giá inputs, mapping the Update 1 'index' setting onto công thức 2.9. */
export function contingencyInputs(s: Tt36Settings): { periods: number; shares: number[]; index: number; mode: 'formula' | 'percent' } {
  let mode: 'formula' | 'percent' = s.contingencyPriceMode === 'percent' ? 'percent' : 'formula';
  let periods = Math.max(1, Math.round(s.contingencyPeriods || 1));
  let index = (s.priceIndexAvg || 1) + (s.priceIndexDelta || 0);
  if (s.contingencyPriceMode === 'index') {
    mode = 'formula';
    periods = Math.max(1, Math.round(s.durationYears || 1));
    index = 1 + (s.priceIndexRate ?? 0) / 100;
  }
  const sched = s.contingencySchedule ?? [];
  const valid = sched.length === periods && sched.every((x) => Number.isFinite(x) && x >= 0) && Math.abs(sched.reduce((a, b) => a + b, 0) - 100) < 1e-6;
  const shares = valid ? sched : Array.from({ length: periods }, () => 100 / periods);
  return { periods, shares, index, mode };
}

/**
 * Tổng dự toán with the two dự phòng components of TT 36/2026, Phụ lục II:
 *  - (2.8) GDP1 = G_TDP × kps, kps ≤ 5%
 *  - (2.9) GDP2 = Σ_{t=1..T} G_TDP_t × [(I_bq + ΔI)^t − 1]
 * G_TDP = dự toán XD công trình before dự phòng = (GXD + GXDNT) + thiết bị + QLDA + tư vấn + khác.
 */
export function computeTotalEstimateTt36(constructionCost: number, s: Tt36Settings): ContingencyResult {
  const warnings: string[] = [];
  const base = constructionCost + s.equipment + s.qlda + s.tuVan + s.other;
  if (s.contingencyQtyRate > MAX_KPS) warnings.push(`kps = ${pct(s.contingencyQtyRate)} vượt mức tối đa ${MAX_KPS}% (TT 36/2026, công thức 2.8).`);
  const dp1 = (base * s.contingencyQtyRate) / 100;
  const ci = contingencyInputs(s);
  let dp2: number;
  let dp2Formula: string;
  let dp2Source: string;
  const unit = s.contingencyPeriodUnit === 'quy' ? 'quý' : 'năm';
  if (ci.mode === 'formula') {
    dp2 = 0;
    ci.shares.forEach((share, i) => {
      dp2 += ((base * share) / 100) * (Math.pow(ci.index, i + 1) - 1);
    });
    const idx = ci.index.toFixed(4).replace('.', ',');
    dp2Formula = `Σ G_TDP,t × [(I_bq + ΔI)^t − 1]; T = ${ci.periods} ${unit}, I_bq + ΔI = ${idx}, phân bổ ${ci.shares.map((x) => pct(+x.toFixed(2))).join(' / ')}`;
    dp2Source = 'TT 36/2026/TT-BXD, Phụ lục II, công thức 2.9 (đính chính QĐ 1538/QĐ-BXD)';
  } else {
    dp2 = (base * s.contingencyPriceRate) / 100;
    dp2Formula = `G_TDP × ${pct(s.contingencyPriceRate)}`;
    dp2Source = 'Tỷ lệ nhập tay – không theo công thức 2.9 TT 36/2026';
    warnings.push('Dự phòng trượt giá đang tính theo tỷ lệ nhập tay, không theo công thức 2.9 TT 36/2026.');
  }
  const total = base + dp1 + dp2;
  const input = 'Nhập theo công trình';
  return {
    total,
    dp1,
    dp2,
    warnings,
    lines: [
      { code: 'Gxd', name: 'Chi phí xây dựng (GXD + GXDNT)', formula: 'Bảng tổng hợp chi phí xây dựng', value: constructionCost, source: 'TT 36/2026/TT-BXD, PL III, Bảng 3.8' },
      { code: 'Gtb', name: 'Chi phí thiết bị', formula: 'Nhập', value: s.equipment, source: input },
      { code: 'Gqlda', name: 'Chi phí quản lý dự án', formula: 'Nhập', value: s.qlda, source: input },
      { code: 'Gtv', name: 'Chi phí tư vấn đầu tư xây dựng', formula: 'Nhập', value: s.tuVan, source: input },
      { code: 'Gk', name: 'Chi phí khác', formula: 'Nhập', value: s.other, source: input },
      {
        code: 'Gdp1',
        name: 'Dự phòng cho khối lượng, công việc phát sinh',
        formula: `G_TDP × kps = G_TDP × ${pct(s.contingencyQtyRate)}`,
        value: dp1,
        source: 'TT 36/2026/TT-BXD, Phụ lục II, công thức 2.8 (kps ≤ 5%)',
      },
      { code: 'Gdp2', name: 'Dự phòng cho yếu tố trượt giá', formula: dp2Formula, value: dp2, source: dp2Source },
      { code: 'TDT', name: 'Tổng dự toán', formula: 'G_TDP + GDP1 + GDP2 (G_TDP = Gxd + Gtb + Gqlda + Gtv + Gk)', value: total },
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
  notes?: string[];
}

export function computeProjectCost(
  set: LegalSet,
  direct: CostTriple,
  stored: ProjectCostSettings | null | undefined,
  buildingType: BuildingType,
  vatRate: number,
  opts: { gxdttTmdt?: number | null; categories?: CategoryCost[] } = {},
): ProjectCost {
  if (set.method === 'TT36_2026') {
    const s: Tt36Settings = { ...defaultTt36Settings(buildingType), ...(stored ?? {}) } as Tt36Settings;
    if (opts.gxdttTmdt !== undefined) s.gxdttTmdt = opts.gxdttTmdt;
    const cs = computeTt36(direct, s, set, vatRate, { categories: opts.categories });
    const tdt = computeTotalEstimateTt36(cs.total!, s);
    const warnings = [...cs.warnings, ...tdt.warnings];
    if (tdt.dp2 === 0) warnings.push('Dự phòng trượt giá đang bằng 0 – kiểm tra thời gian xây dựng và chỉ số giá xây dựng (I_bq, ΔI).');
    return {
      legalSetId: set.id,
      notes: cs.notes,
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

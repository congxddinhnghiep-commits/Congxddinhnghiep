import { splitChinese } from './encoding.js';
import { normalizeText } from './text.js';
import { canonicalUnit, isKnownUnit } from './units.js';

/** A cell as read from a spreadsheet (cached formula values, dates as ISO strings). */
export type Cell = string | number | boolean | null;

export interface Merge {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

export type SheetKind = 'du_toan_chi_tiet' | 'tong_hop_chi_phi' | 'phan_tich_vat_tu' | 'tong_hop_vat_tu' | 'gia_vat_lieu' | 'khac';

export const SHEET_KIND_LABELS: Record<SheetKind, string> = {
  du_toan_chi_tiet: 'Dự toán chi tiết / BOQ',
  tong_hop_chi_phi: 'Tổng hợp chi phí',
  phan_tich_vat_tu: 'Phân tích vật tư',
  tong_hop_vat_tu: 'Tổng hợp vật tư',
  gia_vat_lieu: 'Giá vật liệu',
  khac: 'Khác',
};

export type ImportField =
  | 'stt'
  | 'code'
  | 'name'
  | 'unit'
  | 'quantity'
  | 'formula'
  | 'priceVL'
  | 'priceNC'
  | 'priceM'
  | 'unitPrice'
  | 'amount'
  | 'amountVL'
  | 'amountNC'
  | 'amountM'
  | 'note'
  | 'spec'
  | 'price'
  | 'subArea'
  | 'nameZh'
  | 'dimL'
  | 'dimW'
  | 'dimH'
  | 'dimN'
  | 'brand';

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  stt: 'STT / phân cấp',
  code: 'Mã hiệu',
  name: 'Hạng mục công việc (tên công tác)',
  unit: 'Đơn vị',
  quantity: 'Khối lượng',
  formula: 'Diễn giải khối lượng',
  priceVL: 'Đơn giá vật liệu',
  priceNC: 'Đơn giá nhân công',
  priceM: 'Đơn giá máy',
  unitPrice: 'Đơn giá (tổng hợp)',
  amount: 'Thành tiền',
  amountVL: 'Thành tiền – vật liệu',
  amountNC: 'Thành tiền – nhân công',
  amountM: 'Thành tiền – máy',
  note: 'Ghi chú',
  spec: 'Quy cách / thông số',
  price: 'Giá',
  subArea: 'Khu vực',
  nameZh: 'Tên tiếng Trung (内容)',
  dimL: 'Kích thước – Dài',
  dimW: 'Kích thước – Rộng',
  dimH: 'Kích thước – Cao',
  dimN: 'Số cấu kiện',
  brand: 'Nhãn hiệu / Xuất xứ',
};

export const ESTIMATE_FIELDS: ImportField[] = ['stt', 'code', 'name', 'nameZh', 'spec', 'brand', 'unit', 'dimL', 'dimW', 'dimH', 'dimN', 'quantity', 'formula', 'priceVL', 'priceNC', 'priceM', 'unitPrice', 'amount', 'amountVL', 'amountNC', 'amountM', 'note'];
export const PRICE_FIELDS: ImportField[] = ['stt', 'code', 'name', 'spec', 'unit', 'price', 'subArea', 'note'];

/** Synonyms (normalised, no diacritics) and Chinese headers of bilingual files. */
const SYNONYMS: Record<ImportField, string[]> = {
  stt: ['stt', 'tt', 'so tt', 'so thu tu', 'thu tu', '序号'],
  code: ['ma hieu don gia', 'ma hieu dinh muc', 'ma hieu dm', 'ma hieu', 'ma dinh muc', 'ma dm', 'ma cong viec', 'ma cv', 'ma so', 'ma vat tu', 'ma vt', 'ma tai nguyen', 'ma', '编码', '项目编码', '定额编号', '编号'],
  name: [
    'ten cong viec', 'noi dung cong viec', 'cong viec', 'ten cong tac', 'hang muc cong viec', 'noi dung', 'hang muc', 'dien giai', 'mo ta', 'ten vat tu',
    'ten vat lieu', 'ten hang', 'ten', 'vat tu', 'vat lieu', 'loai vat lieu', '项目名称', '名称', '工作内容', '材料名称',
  ],
  unit: ['don vi tinh', 'don vi', 'dvt', 'dv', '单位'],
  quantity: ['khoi luong', 'so luong', 'kl', 'sl', '工程量', '数量'],
  formula: ['dien giai khoi luong', 'dien giai kl', 'cach tinh', 'cong thuc tinh', 'cong thuc', '计算式'],
  priceVL: [],
  priceNC: [],
  priceM: [],
  unitPrice: ['don gia', 'dg', '单价', '综合单价'],
  amount: ['thanh tien', 'gia tri', 'thanh tien truoc thue', '合价', '金额'],
  amountVL: [],
  amountNC: [],
  amountM: [],
  note: ['ghi chu', '备注'],
  spec: ['quy cach ky thuat', 'quy cach', 'thong so ky thuat', 'thong so', 'tieu chi ky thuat', 'tieu chuan ky thuat', 'tieu chuan', '规格', '规格型号', '技术要求'],
  price: ['gia chua thue', 'gia chua vat', 'gia truoc thue', 'gia ban', 'gia cong bo', 'gia vat lieu', 'gia', 'don gia', '单价', '价格'],
  subArea: ['khu vuc', 'dia ban', 'dia diem'],
  nameZh: ['内容', '中文名称', '中文'],
  dimL: ['chieu dai', 'dai', 'length', '长'],
  dimW: ['chieu rong', 'rong', 'width', '宽'],
  dimH: ['chieu cao', 'cao', 'height', '高'],
  dimN: ['so cau kien', 'so luong cau kien', 'so cau', 'cau kien', 'so lan', 'he so'],
  brand: ['nhan hieu', 'xuat xu', 'hang san xuat', 'brand', 'origin', '品牌', '产地'],
};

const SHORT_EXACT = new Set(['tt', 'ma', 'kl', 'sl', 'dv', 'dg', 'ten', 'gia', 'stt', 'dvt']);

function labelOf(v: Cell): string {
  if (v === null || v === undefined) return '';
  // "Công việc内容" → "Công việc 内容": Latin and Chinese text glued together must still match word-wise
  const spaced = String(v).replace(/([^\s\u2e80-\u9fff\uff00-\uffef])([\u2e80-\u9fff\uff00-\uffef])/g, '$1 $2').replace(/([\u2e80-\u9fff\uff00-\uffef])([^\s\u2e80-\u9fff\uff00-\uffef])/g, '$1 $2');
  return normalizeText(spaced.replace(/[\r\n]+/g, ' ').replace(/[()（）:：.]/g, ' '));
}

function synMatch(label: string, syn: string): boolean {
  if (!label) return false;
  if (/[一-鿿]/.test(syn)) return label.includes(syn);
  if (SHORT_EXACT.has(syn)) return label === syn || label.split(' ').includes(syn) && label.split(' ').length <= 2;
  return label === syn || label.startsWith(syn + ' ') || label.endsWith(' ' + syn) || label.includes(' ' + syn + ' ');
}

const VL_RE = /\b(vat lieu|vat tu|vl)\b|材料/;
const NC_RE = /\b(nhan cong|nc)\b|人工/;
const M_RE = /\b(may thi cong|may|mtc|m)\b|机械/;

/** Best field for one header label, with the length of the matched synonym (priority). */
function fieldOf(label: string, fields: ImportField[]): [ImportField, number] | null {
  if (!label) return null;
  const isPrice = /\b(don gia|dg)\b|单价/.test(label);
  if (isPrice && fields.includes('priceVL')) {
    if (VL_RE.test(label)) return ['priceVL', 100];
    if (NC_RE.test(label)) return ['priceNC', 100];
    if (M_RE.test(label.replace(/\bdon gia\b/, ''))) return ['priceM', 100];
  }
  // "Thành tiền" split into VL / NC / M: kept as separate amount parts (their sum is the row's Thành tiền).
  if (/\bthanh tien\b|合价|金额/.test(label) && fields.includes('amountVL')) {
    if (VL_RE.test(label)) return ['amountVL', 100];
    if (NC_RE.test(label)) return ['amountNC', 100];
    if (M_RE.test(label.replace(/\bthanh tien\b/, ''))) return ['amountM', 100];
  }
  let best: [ImportField, number] | null = null;
  for (const f of fields) {
    if (f === 'nameZh' && /[a-z]/.test(label)) continue; // only a purely Chinese header ("内容")
    for (const syn of SYNONYMS[f]) {
      if (f === 'name' && syn === 'cong viec' && isPrice) continue; // "Đơn giá công việc" is a price column
      if (synMatch(label, syn) && (!best || syn.length > best[1])) best = [f, syn.length];
    }
  }
  return best;
}

export interface HeaderDetection {
  headerRow: number;
  headerRows: 1 | 2;
  /** Combined label per column (normalised). */
  labels: string[];
  /** Original header text per column. */
  rawLabels: string[];
  mapping: Partial<Record<ImportField, number>>;
  confidence: number;
}

/** Fill merged ranges (top-left value) – used for header rows only. */
function mergedValue(rows: Cell[][], merges: Merge[], r: number, c: number): Cell {
  const v = rows[r]?.[c];
  if (v !== null && v !== undefined && v !== '') return v;
  for (const m of merges) {
    if (r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c) return rows[m.s.r]?.[m.s.c] ?? null;
  }
  return null;
}

function mapLabels(labels: string[], fields: ImportField[]): { mapping: Partial<Record<ImportField, number>>; score: number } {
  const cands: { f: ImportField; c: number; p: number }[] = [];
  labels.forEach((l, c) => {
    const m = fieldOf(l, fields);
    if (m) cands.push({ f: m[0], c, p: m[1] });
  });
  cands.sort((a, b) => b.p - a.p || a.c - b.c);
  const mapping: Partial<Record<ImportField, number>> = {};
  const used = new Set<number>();
  for (const k of cands) {
    if (mapping[k.f] !== undefined || used.has(k.c)) continue;
    mapping[k.f] = k.c;
    used.add(k.c);
  }
  const w: Partial<Record<ImportField, number>> = { name: 3, unit: 2, quantity: 2, code: 2, price: 2, stt: 1, unitPrice: 1, amount: 1, amountVL: 0.5, amountNC: 0.5, amountM: 0.5, formula: 1, priceVL: 1, priceNC: 1, priceM: 1, spec: 1, note: 0.5 };
  const score = Object.keys(mapping).reduce((a, f) => a + (w[f as ImportField] ?? 0.5), 0);
  return { mapping, score };
}

/**
 * Header texts per column for an explicit header position. A group label ("Đơn giá") whose right
 * neighbours are empty above sub-labels ("Vật liệu", "Nhân công") spans those columns even when the
 * cells are NOT merged.
 */
export function headerTexts(rows: Cell[][], merges: Merge[], headerRow: number, span: 1 | 2, width?: number): { raw: string[]; labels: string[]; parts: string[][] } {
  const w = width ?? Math.max(0, ...rows.slice(headerRow, headerRow + span + 1).map((r) => r?.length ?? 0));
  const isText = (x: Cell) => x !== null && x !== undefined && x !== '' && typeof x !== 'number';
  const tops: Cell[] = [];
  for (let c = 0; c < w; c++) tops.push(mergedValue(rows, merges, headerRow, c));
  const subs: Cell[] = [];
  for (let c = 0; c < w; c++) subs.push(span === 2 ? mergedValue(rows, merges, headerRow + 1, c) : null);
  if (span === 2) {
    let source = -1;
    for (let c = 0; c < w; c++) {
      if (isText(rows[headerRow]?.[c])) source = isText(subs[c]) ? c : -1;
      else if (source >= 0 && !isText(rows[headerRow]?.[c]) && isText(subs[c]) && !isText(tops[c])) tops[c] = tops[source];
      else if (!isText(subs[c])) source = -1;
    }
  }
  const raw: string[] = [];
  const labels: string[] = [];
  const parts: string[][] = [];
  for (let c = 0; c < w; c++) {
    const ps = [tops[c], subs[c] !== tops[c] ? subs[c] : null].filter((x) => isText(x)).map((x) => String(x).replace(/\s+/g, ' ').trim());
    const text = ps.join(' ').trim();
    parts.push(ps);
    raw.push(text);
    labels.push(labelOf(text));
  }
  return { raw, labels, parts };
}

/**
 * Find the header row(s) in the first `scan` rows: single-row headers and two-row headers where
 * a merged group label ("Đơn giá") sits above sub-labels ("Vật liệu", "Nhân công", "Máy").
 */
export function detectHeader(rows: Cell[][], merges: Merge[] = [], fields: ImportField[] = ESTIMATE_FIELDS, scan = 30): HeaderDetection | null {
  let best: (HeaderDetection & { score: number }) | null = null;
  const all = new Map<string, HeaderDetection & { score: number }>();
  const width = Math.max(0, ...rows.slice(0, scan + 2).map((r) => r?.length ?? 0));
  for (let r = 0; r < Math.min(scan, rows.length); r++) {
    for (const span of [1, 2] as const) {
      if (span === 2 && r + 1 >= rows.length) continue;
      const { raw, labels } = headerTexts(rows, merges, r, span, width);
      const { mapping, score } = mapLabels(labels, fields);
      const hasName = mapping.name !== undefined;
      const hasValue = mapping.quantity !== undefined || mapping.price !== undefined || mapping.unit !== undefined || mapping.unitPrice !== undefined;
      if (!hasName || !hasValue) continue;
      // a 2-row header must add information over the single row
      const s = score - (span === 2 ? 0.25 : 0);
      const cand = { headerRow: r, headerRows: span, labels, rawLabels: raw, mapping, confidence: Math.min(1, score / 10), score: s };
      all.set(`${r}:${span}`, cand);
      if (!best || s > best.score + 1e-9) best = cand;
    }
  }
  if (!best) return null;
  // Vertically merged cells make the second header row look complete on its own; prefer the
  // two-row header that starts on the row above when it scores (almost) the same.
  if (best.headerRows === 1) {
    const two = all.get(`${best.headerRow - 1}:2`);
    if (two && two.score >= best.score - 0.25 - 1e-9) best = two;
  }
  const { score: _s, ...rest } = best;
  return rest;
}

/** "1.2 Hạng mục : Cầu nối 连廊" → "Cầu nối" (numbering, "Hạng mục :" prefix and the Chinese tail removed). */
export function cleanBlockTitle(raw: string): string {
  let t = splitChinese(raw.replace(/\s+/g, ' ').trim()).vi;
  t = t.replace(/^\(\d+(?:\.\d+)*\)\s*/, '').replace(/^\d+(?:\.\d+)*[A-Za-z]?\.?\s+/, '');
  t = t.replace(/^(hạng mục|hang muc|hm)\s*[:：]?\s*/i, '').replace(/^\d+(?:\.\d+)*[A-Za-z]?\.?\s+/, '');
  t = t.replace(/[\s:：]+$/, '').trim();
  // generic headings are no title
  return /^(bang khoi luong|bang gia tri du toan|cong trinh|bang tong hop|hang muc|du toan)\b/.test(normalizeText(t)) && normalizeText(t).split(' ').length <= 4 ? '' : t;
}

/** One table of a sheet: an estimate sheet may repeat its header row for every sub-hạng-mục. */
export interface SheetBlock extends HeaderDetection {
  index: number;
  /** Title line above the header ("1.2B. Hạng mục : …"), cleaned; '' when none. */
  title: string;
  titleRow: number | null;
  /** First data row (0-based) and last row of the block (inclusive). */
  first: number;
  last: number;
}

const isTextCell = (v: Cell | undefined) => typeof v === 'string' && v.trim() !== '';

/**
 * Find every table of a sheet (a header row repeated for each sub-hạng-mục, each preceded by a title line and closed
 * by a "Cộng trước thuế" row). A sheet with a single header gives one block.
 */
export function detectBlocks(rows: Cell[][], merges: Merge[] = [], fields: ImportField[] = ESTIMATE_FIELDS): SheetBlock[] {
  const width = Math.max(0, ...rows.map((r) => r?.length ?? 0));
  type Cand = HeaderDetection & { score: number };
  const cands = new Map<string, Cand>();
  for (let r = 0; r < rows.length; r++) {
    if (!(rows[r] ?? []).some(isTextCell)) continue;
    for (const span of [1, 2] as const) {
      if (span === 2 && r + 1 >= rows.length) continue;
      const { raw, labels } = headerTexts(rows, merges, r, span, width);
      const { mapping, score } = mapLabels(labels, fields);
      const hasValue = mapping.quantity !== undefined || mapping.unitPrice !== undefined || mapping.priceVL !== undefined;
      if (mapping.name === undefined || !hasValue || score < 5) continue;
      cands.set(`${r}:${span}`, { headerRow: r, headerRows: span, labels, rawLabels: raw, mapping, confidence: Math.min(1, score / 10), score: score - (span === 2 ? 0.25 : 0) });
    }
  }
  // best candidates first; a candidate never overlaps an accepted header (a 2-row header's second row is not a header of its own)
  const taken = new Set<number>();
  const accepted: Cand[] = [];
  for (const c of [...cands.values()].sort((a, b) => b.score - a.score || a.headerRow - b.headerRow || a.headerRows - b.headerRows)) {
    const rowsOf = c.headerRows === 2 ? [c.headerRow, c.headerRow + 1] : [c.headerRow];
    if (rowsOf.some((x) => taken.has(x))) continue;
    // vertically merged cells make the 2nd header row look complete on its own: prefer the two-row header that starts on the row above
    let pick = c;
    if (c.headerRows === 1) {
      const two = cands.get(`${c.headerRow - 1}:2`);
      if (two && two.score >= c.score - 0.25 - 1e-9 && !taken.has(two.headerRow)) pick = two;
    }
    (pick.headerRows === 2 ? [pick.headerRow, pick.headerRow + 1] : [pick.headerRow]).forEach((x) => taken.add(x));
    accepted.push(pick);
  }
  const found: HeaderDetection[] = accepted.sort((a, b) => a.headerRow - b.headerRow).map(({ score: _s, ...rest }) => rest);
  const isTotalRow = (row: Cell[]) => SUBTOTAL_RE.test(normalizeText(row.filter(isTextCell).slice(0, 2).join(' '))) || SUBTOTAL_CN.test(row.map((c) => String(c ?? '')).join(' '));
  // title = the nearest text-only line above the header (preferring "Hạng mục : …"), never a total row
  const titleOf = (h: HeaderDetection, from: number): { title: string; row: number | null } => {
    let nearest: { title: string; row: number } | null = null;
    for (let r = h.headerRow - 1; r >= Math.max(from, h.headerRow - 6); r--) {
      const row = rows[r] ?? [];
      const texts = row.filter(isTextCell);
      if (!texts.length || row.some((c) => typeof c === 'number') || texts.length > 3 || isTotalRow(row)) continue;
      const t = String(texts[0]).trim();
      if (/^(hang muc|\d+(\.\d+)*[a-z]?\.?\s*(hang muc|hm))/i.test(normalizeText(t))) return { title: cleanBlockTitle(t), row: r };
      nearest ??= { title: cleanBlockTitle(t), row: r };
    }
    return nearest ?? { title: '', row: null };
  };
  const blocks: SheetBlock[] = [];
  found.forEach((h, i) => {
    const prevEnd = i > 0 ? blocks[i - 1].first : 0;
    const t = titleOf(h, Math.max(prevEnd, i > 0 ? found[i - 1].headerRow + found[i - 1].headerRows : 0));
    blocks.push({ ...h, index: i, title: t.title, titleRow: t.row, first: h.headerRow + h.headerRows, last: rows.length - 1 });
  });
  blocks.forEach((b, i) => {
    if (i + 1 < blocks.length) b.last = (blocks[i + 1].titleRow ?? blocks[i + 1].headerRow) - 1;
    while (b.last > b.first && (rows[b.last] ?? []).every((c) => c === null || c === undefined || c === '')) b.last--;
  });
  return blocks;
}

/** Stable fingerprint of a header layout (normalised non-empty labels and their positions). */
export function headerFingerprint(labels: string[], headerRows: number): string {
  const key = headerRows + '|' + labels.map((l, i) => (l ? `${i}:${l}` : '')).filter(Boolean).join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Parse numbers written as 1.234,56 (VN) or 1,234.56 (EN), "12 500", "(1.000)". */
export function parseFlexibleNumber(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/[\s ]/g, '').replace(/(đ|vnđ|vnd|đồng)$/i, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let t: string;
  if (lastDot >= 0 && lastComma >= 0) {
    t = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    t = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot >= 0) {
    // Only dots: "1.650.000" / "12.500" are thousands (Vietnamese convention); "2.5" / "1.25" are decimals.
    t = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
  } else t = s;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

export type RowType = 'header' | 'category' | 'item' | 'detail' | 'subtotal' | 'note' | 'empty';

export const ROW_TYPE_LABELS: Record<RowType, string> = {
  header: 'Tiêu đề',
  category: 'Hạng mục',
  item: 'Công việc',
  detail: 'Diễn giải khối lượng',
  subtotal: 'Cộng/Tổng (bỏ qua)',
  note: 'Ghi chú',
  empty: 'Trống',
};

/** Kích thước of a quantity-breakdown row ("Móng M1: 1 × 20 × 10 = 200"). */
export interface DetailLine {
  index: number;
  text: string;
  dims: { l: number | null; w: number | null; h: number | null; n: number | null };
  /** "Khối lượng" of the line as in the file (or the product of the dimensions). */
  quantity: number | null;
  /** Product of the filled dimensions, "1*20*10" ("" without dimensions). */
  expression: string;
}

export interface ClassifiedRow {
  /** 0-based index in the sheet. */
  index: number;
  type: RowType;
  stt: string;
  code: string;
  name: string;
  unit: string;
  quantity: number | null;
  formula: string;
  prices: { vl: number | null; nc: number | null; m: number | null; unit: number | null };
  /** "Thành tiền" of the row as in the file (formulas without cached values are evaluated on import). */
  amount: number | null;
  /** Price-book mode: the quoted price of the row. */
  price: number | null;
  spec: string;
  brand: string;
  subArea: string;
  note: string;
  category: string | null;
  warnings: string[];
  /** Chinese name (own column, or the Chinese tail of a bilingual cell). */
  nameZh: string;
  /** Breakdown rows directly under this item (items only). */
  details: DetailLine[];
}

const noPriceParts = (r: ClassifiedRow) => r.prices.vl === null && r.prices.nc === null && r.prices.m === null && r.prices.unit === null;
const NOTE_START = /^(ghi chu|luu y|chu thich|note|dien giai|ke hoach|nguon|can cu|theo|ma so thue|dia chi)\b/;
/** A row that carries only a short heading text (nothing numeric anywhere) is a category header. */
function isBareHeading(cells: string[], name: string, mapping: Partial<Record<ImportField, number>>): boolean {
  if (!name || name.length > 80 || /[:;]/.test(name) || NOTE_START.test(normalizeText(name))) return false;
  const others = cells.filter((c, i) => c && i !== mapping.name && i !== mapping.stt);
  return others.length === 0 && !/\d{3,}/.test(name);
}

// "Cộng"/"Tổng" close a block; "CÔNG TÁC BÊ TÔNG", "CÔNG TRÌNH…" are headings, not totals.
const SUBTOTAL_RE = /^(cong(?!\s+(tac|trinh|viec|nghiep|ty|suat|dung|van|nhan|tho|cu|ich|nghe|thuc))|tong cong|tong(?!\s+(dai|the|thau|giam|thanh|nhan|dien|kho|luc|bo|quan|cuc|cot))|cong hang muc|cong phan|tong gia tri|tong so|gia tri|cong truoc thue|cong sau thue|tong chi phi|tong tien)\b/;
const SUBTOTAL_CN = /小计|合计|总计/;
const ROMAN_RE = /^(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv|xvi|xvii|xviii|xix|xx)\.?$/;

/** "Cổng xếp" (gate) normalises to "cong" like "Cộng" (sum): with diacritics the first word must really be Cộng / Tổng. */
function subtotalWordOk(name: string): boolean {
  const first = name.trim().split(/\s+/)[0] ?? '';
  if (!/[^\x00-\x7f]/.test(first)) return true;
  const f = first.normalize('NFC').toLowerCase();
  return !/^(cong|tong)$/.test(normalizeText(first)) || f === 'cộng' || f === 'tổng';
}

const str = (v: Cell | undefined): string => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());
/** Work names keep their inner spacing ("Φ400  L=20m") – only line breaks / tabs become spaces. */
const strKeep = (v: Cell | undefined): string => (v === null || v === undefined ? '' : String(v).replace(/[\r\n\t]+/g, ' ').trim());

/** Classify data rows below the header. */
export function classifyRows(
  rows: Cell[][],
  header: Pick<HeaderDetection, 'headerRow' | 'headerRows' | 'mapping'>,
  /** Rows (0-based) whose "Thành tiền" is a SUM formula – treated as subtotal rows. */
  sumRows?: ReadonlySet<number>,
): ClassifiedRow[] {
  const m = header.mapping;
  const get = (r: Cell[], f: ImportField) => (m[f] === undefined || m[f]! < 0 ? undefined : r[m[f]!]);
  // Price lists have no quantity column: a row is an item when it has a name/code and a price.
  const priceMode = m.quantity === undefined && m.price !== undefined;
  const out: ClassifiedRow[] = [];
  let category: string | null = null;
  let lastItem: ClassifiedRow | null = null;
  const lumps: ClassifiedRow[] = [];
  const seen = new Map<string, number>();
  const finishItem = (it: ClassifiedRow | null) => {
    if (!it || !it.details.length) return;
    const sum = it.details.reduce((a, d) => a + (d.quantity ?? 0), 0);
    if (it.quantity !== null && Math.abs(sum - it.quantity) > Math.max(1e-6, Math.abs(it.quantity) * 0.0005)) {
      it.warnings.push(`Tổng diễn giải khối lượng (${Math.round(sum * 1e6) / 1e6}) khác khối lượng của file (${it.quantity}) – giữ khối lượng của file`);
    }
  };
  for (let i = header.headerRow + header.headerRows; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const cells = r.map(str);
    const stt = str(get(r, 'stt'));
    const code = str(get(r, 'code'));
    const split = splitChinese(strKeep(get(r, 'name')));
    const name = split.vi;
    const nameZh = split.zh || str(get(r, 'nameZh'));
    const unit = str(get(r, 'unit'));
    const numOf = (f: ImportField) => parseFlexibleNumber(get(r, f) ?? null);
    const dims = { l: numOf('dimL'), w: numOf('dimW'), h: numOf('dimH'), n: numOf('dimN') };
    const hasDims = Object.values(dims).some((x) => x !== null);
    const qRaw = priceMode ? get(r, 'price') : get(r, 'quantity');
    const qVal = parseFlexibleNumber(qRaw ?? null);
    const quantity = priceMode ? null : qVal;
    const price = priceMode ? qVal : parseFlexibleNumber(get(r, 'price') ?? null);
    const row: ClassifiedRow = {
      index: i,
      type: 'note',
      stt,
      code,
      name,
      unit,
      quantity,
      formula: str(get(r, 'formula')),
      prices: {
        vl: parseFlexibleNumber(get(r, 'priceVL') ?? null),
        nc: parseFlexibleNumber(get(r, 'priceNC') ?? null),
        m: parseFlexibleNumber(get(r, 'priceM') ?? null),
        unit: parseFlexibleNumber(get(r, 'unitPrice') ?? null),
      },
      amount: ((): number | null => {
        const total = parseFlexibleNumber(get(r, 'amount') ?? null);
        if (total !== null) return total;
        const parts = [get(r, 'amountVL'), get(r, 'amountNC'), get(r, 'amountM')].map((x) => parseFlexibleNumber(x ?? null));
        return parts.some((x) => x !== null) ? parts.reduce<number>((a, x) => a + (x ?? 0), 0) : null;
      })(),
      price,
      spec: str(get(r, 'spec')),
      brand: str(get(r, 'brand')),
      subArea: str(get(r, 'subArea')),
      note: str(get(r, 'note')),
      category,
      warnings: [],
      nameZh,
      details: [],
    };
    if (cells.every((c) => !c)) {
      row.type = 'empty';
      out.push(row);
      continue;
    }
    // Column-number row right below the header: "1 2 3 4 …" or "(1) (2) …"
    const nonEmpty = cells.filter(Boolean);
    if (i < header.headerRow + header.headerRows + 2 && nonEmpty.length >= 3 && nonEmpty.every((c) => /^\(?\d{1,2}\)?$/.test(c) || /^\(?[a-z]\)?$/i.test(c))) {
      row.type = 'header';
      out.push(row);
      continue;
    }
    const firstText = normalizeText([stt, code, name, ...cells.slice(0, 4)].filter(Boolean).join(' '));
    const nameN = normalizeText(name || firstText);
    if ((SUBTOTAL_RE.test(nameN) && subtotalWordOk(name || firstText)) || SUBTOTAL_CN.test(cells.join(' ')) || stt === '***' || (!name && SUBTOTAL_RE.test(firstText) && subtotalWordOk(firstText)) || (sumRows?.has(i) && quantity === null)) {
      row.type = 'subtotal';
      finishItem(lastItem);
      lastItem = null;
      out.push(row);
      continue;
    }
    const hasQty = qVal !== null;
    const noPrice = row.prices.vl === null && row.prices.nc === null && row.prices.m === null && row.prices.unit === null && row.amount === null;
    if (!priceMode && lastItem && !stt && !code && !unit && name && (hasQty || hasDims) && noPrice) {
      // Quantity-breakdown row ("Móng M1: Dài × Rộng × Cao × Số cấu kiện") under an item: a diễn giải line, not a new item.
      const factors = [dims.l, dims.w, dims.h, dims.n].filter((x): x is number => x !== null);
      const expression = factors.join('*');
      const product = factors.length ? factors.reduce((a, x) => a * x, 1) : null;
      const q = quantity ?? (product !== null ? Math.round(product * 1e9) / 1e9 : null);
      row.type = 'detail';
      const line: DetailLine = { index: i, text: name, dims, quantity: q, expression: expression && (quantity === null || product === null || Math.abs(product - quantity) < 1e-9) ? expression : q !== null ? String(q) : expression };
      lastItem.details.push(line);
      out.push(row);
      continue;
    }
    if (!priceMode && name && !hasQty && !unit && !hasDims && !sumRows?.has(i) && row.amount !== null && row.amount > 0 && noPriceParts(row) && !ROMAN_RE.test(normalizeText(stt)) && !/^[a-e]\.?$/.test(normalizeText(stt)) && name !== name.toUpperCase() && !NOTE_START.test(normalizeText(name))) {
      // lump-sum row ("Cổng xếp tự động … 60.000.000"): only a Thành tiền → 1 trọn gói, never dropped from the total
      row.type = 'item';
      row.quantity = 1;
      row.prices.unit = row.amount;
      row.warnings.push('Trọn gói: file chỉ có Thành tiền – khối lượng đặt = 1');
      lumps.push(row);
      finishItem(lastItem);
      lastItem = row;
    } else if (priceMode && (name || code) && hasQty) {
      row.type = 'item';
      if (!unit) row.warnings.push('Thiếu đơn vị');
      else if (!isKnownUnit(unit)) row.warnings.push(`Đơn vị lạ "${unit}"`);
      if (qVal! <= 0) row.warnings.push('Giá bằng 0 hoặc âm');
    } else if (!priceMode && (name || code) && hasQty && (unit || code || (stt && !ROMAN_RE.test(normalizeText(stt))))) {
      row.type = 'item';
      finishItem(lastItem);
      lastItem = row;
      if (!unit) row.warnings.push('Thiếu đơn vị');
      else if (!isKnownUnit(unit)) row.warnings.push(`Đơn vị lạ "${unit}"`);
      if (quantity === 0) row.warnings.push('Khối lượng bằng 0');
      if (quantity !== null && quantity < 0) row.warnings.push('Khối lượng âm');
      const key = `${category ?? ''}|${normalizeText(code)}|${normalizeText(name)}|${canonicalUnit(unit)}`;
      if (seen.has(key)) row.warnings.push(`Trùng với dòng ${seen.get(key)! + 1}`);
      else seen.set(key, i);
    } else if ((name || code) && !hasQty && qRaw !== undefined && qRaw !== null && str(qRaw) !== '') {
      row.type = 'item';
      row.warnings.push(`Khối lượng không đọc được "${str(qRaw)}"`);
    } else if (name && !hasQty && !unit) {
      const sttN = normalizeText(stt);
      const upper = name === name.toUpperCase() && /[A-ZÀ-Ỹ]/.test(name);
      if (ROMAN_RE.test(sttN) || /^[a-e]\.?$/.test(sttN) || upper || /^(hang muc|phan|hm)\b/.test(normalizeText(name)) || /^[ivx]+[.\s]/i.test(name)) {
        row.type = 'category';
        finishItem(lastItem);
        lastItem = null;
        category = name.replace(/^[IVX]+[.\s]+/, '').trim();
        row.category = category;
      } else if (isBareHeading(cells, name, m)) {
        // only a capitalised phrase and no quantity / unit / price / code anywhere in the row
        row.type = 'category';
        finishItem(lastItem);
        lastItem = null;
        category = name.replace(/^[IVX]+[.\s]+/, '').trim();
        row.category = category;
      } else row.type = 'note';
    } else row.type = 'note';
    out.push(row);
  }
  finishItem(lastItem);
  // A "lump-sum" row whose amount equals the sum of the items right below it is a group heading carrying its own subtotal
  // (not an item – counting it would double the total).
  for (const lump of lumps) {
    let acc = 0;
    let n = 0;
    let match = false;
    for (let k = out.indexOf(lump) + 1; k < out.length; k++) {
      const x = out[k];
      if (x.type === 'subtotal' || (x.type === 'category' && n > 0)) break;
      if (x.type !== 'item' || lumps.includes(x)) continue;
      acc += x.amount ?? 0;
      n++;
      if (Math.abs(acc - lump.amount!) <= 1) {
        match = true;
        break;
      }
      if (acc > lump.amount! + 1) break;
    }
    if (match) {
      lump.type = 'category';
      lump.category = lump.name;
      lump.quantity = null;
      lump.prices.unit = null;
      lump.warnings = lump.warnings.filter((w) => !w.startsWith('Trọn gói'));
    }
  }
  return out;
}

/** Classify a sheet by its name and detected columns. */
export function classifySheet(name: string, header: HeaderDetection | null): SheetKind {
  const n = normalizeText(name);
  if (/phan tich vat tu|ptvt|phan tich don gia|phan tich/.test(n)) return 'phan_tich_vat_tu';
  if (/tong hop vat tu|thvt|tong hop vat lieu|tong hop vl/.test(n)) return 'tong_hop_vat_tu';
  if (/gia vat lieu|gia vl|bang gia|cong bo gia|clvt|chenh lech|don gia vat lieu|材料价格/.test(n)) return 'gia_vat_lieu';
  if (/tong hop chi phi|tong hop kinh phi|tong hop du toan|^th$|^tdt$|^th |汇总/.test(n)) return 'tong_hop_chi_phi';
  if (/du toan chi tiet|dtct|du toan|boq|khoi luong|^kl|工程量|清单|预算/.test(n)) return 'du_toan_chi_tiet';
  if (!header) return 'khac';
  const mp = header.mapping;
  if (mp.name !== undefined && mp.quantity !== undefined) return 'du_toan_chi_tiet';
  if (mp.name !== undefined && (mp.price !== undefined || mp.unitPrice !== undefined) && mp.quantity === undefined) return 'gia_vat_lieu';
  return 'khac';
}

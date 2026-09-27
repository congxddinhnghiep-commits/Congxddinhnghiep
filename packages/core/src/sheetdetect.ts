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
  | 'note'
  | 'spec'
  | 'price'
  | 'subArea';

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  stt: 'STT',
  code: 'Mã hiệu',
  name: 'Tên công việc / nội dung',
  unit: 'Đơn vị',
  quantity: 'Khối lượng',
  formula: 'Diễn giải khối lượng',
  priceVL: 'Đơn giá vật liệu',
  priceNC: 'Đơn giá nhân công',
  priceM: 'Đơn giá máy',
  unitPrice: 'Đơn giá (tổng hợp)',
  amount: 'Thành tiền',
  note: 'Ghi chú',
  spec: 'Quy cách / thông số',
  price: 'Giá',
  subArea: 'Khu vực',
};

export const ESTIMATE_FIELDS: ImportField[] = ['stt', 'code', 'name', 'unit', 'quantity', 'formula', 'priceVL', 'priceNC', 'priceM', 'unitPrice', 'amount', 'note'];
export const PRICE_FIELDS: ImportField[] = ['stt', 'code', 'name', 'spec', 'unit', 'price', 'subArea', 'note'];

/** Synonyms (normalised, no diacritics) and Chinese headers of bilingual files. */
const SYNONYMS: Record<ImportField, string[]> = {
  stt: ['stt', 'tt', 'so tt', 'so thu tu', 'thu tu', '序号'],
  code: ['ma hieu don gia', 'ma hieu dinh muc', 'ma hieu dm', 'ma hieu', 'ma dinh muc', 'ma dm', 'ma cong viec', 'ma cv', 'ma so', 'ma vat tu', 'ma vt', 'ma tai nguyen', 'ma', '编码', '项目编码', '定额编号', '编号'],
  name: [
    'ten cong viec', 'noi dung cong viec', 'ten cong tac', 'hang muc cong viec', 'noi dung', 'hang muc', 'dien giai', 'mo ta', 'ten vat tu',
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
  note: ['ghi chu', '备注'],
  spec: ['quy cach ky thuat', 'quy cach', 'thong so ky thuat', 'thong so', 'tieu chuan', '规格', '规格型号'],
  price: ['gia chua thue', 'gia chua vat', 'gia truoc thue', 'gia ban', 'gia cong bo', 'gia vat lieu', 'gia', 'don gia', '单价', '价格'],
  subArea: ['khu vuc', 'dia ban', 'dia diem'],
};

const SHORT_EXACT = new Set(['tt', 'ma', 'kl', 'sl', 'dv', 'dg', 'ten', 'gia', 'stt', 'dvt']);

function labelOf(v: Cell): string {
  if (v === null || v === undefined) return '';
  return normalizeText(String(v).replace(/[\r\n]+/g, ' ').replace(/[()（）:：.]/g, ' '));
}

function synMatch(label: string, syn: string): boolean {
  if (!label) return false;
  if (/[一-鿿]/.test(syn)) return label.includes(syn);
  if (SHORT_EXACT.has(syn)) return label === syn || label.split(' ').includes(syn) && label.split(' ').length <= 2;
  return label === syn || label.startsWith(syn + ' ') || label.endsWith(' ' + syn) || label.includes(' ' + syn + ' ');
}

const VL_RE = /\b(vat lieu|vl)\b|材料/;
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
  // "Thành tiền" split into VL / NC / M is not needed for import – only the total column is used.
  if (/\bthanh tien\b|合价|金额/.test(label) && (VL_RE.test(label) || NC_RE.test(label) || M_RE.test(label.replace(/\bthanh tien\b/, '')))) return null;
  let best: [ImportField, number] | null = null;
  for (const f of fields) {
    for (const syn of SYNONYMS[f]) {
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
  const w: Partial<Record<ImportField, number>> = { name: 3, unit: 2, quantity: 2, code: 2, price: 2, stt: 1, unitPrice: 1, amount: 1, formula: 1, priceVL: 1, priceNC: 1, priceM: 1, spec: 1, note: 0.5 };
  const score = Object.keys(mapping).reduce((a, f) => a + (w[f as ImportField] ?? 0.5), 0);
  return { mapping, score };
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
      const raw: string[] = [];
      const labels: string[] = [];
      for (let c = 0; c < width; c++) {
        const top = mergedValue(rows, merges, r, c);
        const sub = span === 2 ? mergedValue(rows, merges, r + 1, c) : null;
        const text = [top, sub !== top ? sub : null].filter((x) => x !== null && x !== '' && typeof x !== 'number').map(String).join(' ');
        raw.push(text.trim());
        labels.push(labelOf(text));
      }
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

export type RowType = 'header' | 'category' | 'item' | 'subtotal' | 'note' | 'empty';

export const ROW_TYPE_LABELS: Record<RowType, string> = {
  header: 'Tiêu đề',
  category: 'Hạng mục',
  item: 'Công việc',
  subtotal: 'Cộng/Tổng (bỏ qua)',
  note: 'Ghi chú',
  empty: 'Trống',
};

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
  note: string;
  category: string | null;
  warnings: string[];
}

const SUBTOTAL_RE = /^(cong|tong cong|tong|cong hang muc|cong phan|tong gia tri|tong so|gia tri|cong truoc thue|cong sau thue|tong chi phi)\b/;
const SUBTOTAL_CN = /小计|合计|总计/;
const ROMAN_RE = /^(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv|xvi|xvii|xviii|xix|xx)\.?$/;

const str = (v: Cell | undefined): string => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());

/** Classify data rows below the header. */
export function classifyRows(rows: Cell[][], header: Pick<HeaderDetection, 'headerRow' | 'headerRows' | 'mapping'>): ClassifiedRow[] {
  const m = header.mapping;
  const get = (r: Cell[], f: ImportField) => (m[f] === undefined || m[f]! < 0 ? undefined : r[m[f]!]);
  const out: ClassifiedRow[] = [];
  let category: string | null = null;
  const seen = new Map<string, number>();
  for (let i = header.headerRow + header.headerRows; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const cells = r.map(str);
    const stt = str(get(r, 'stt'));
    const code = str(get(r, 'code'));
    const name = str(get(r, 'name'));
    const unit = str(get(r, 'unit'));
    const qRaw = get(r, 'quantity');
    const quantity = parseFlexibleNumber(qRaw ?? null);
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
      note: str(get(r, 'note')),
      category,
      warnings: [],
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
    if (SUBTOTAL_RE.test(nameN) || SUBTOTAL_CN.test(cells.join(' ')) || (!name && SUBTOTAL_RE.test(firstText))) {
      row.type = 'subtotal';
      out.push(row);
      continue;
    }
    const hasQty = quantity !== null;
    if ((name || code) && hasQty && (unit || code)) {
      row.type = 'item';
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
        category = name.replace(/^[IVX]+[.\s]+/, '').trim();
        row.category = category;
      } else row.type = 'note';
    } else row.type = 'note';
    out.push(row);
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

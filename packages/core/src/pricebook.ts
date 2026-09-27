import { normalizeText } from './text.js';
import type { ResourceType } from './types.js';
import { unitFactor } from './units.js';

export type PeriodType = 'month' | 'quarter' | 'year';
export type BookType = 'VL' | 'NC' | 'M' | 'TH';

export const BOOK_TYPE_LABELS: Record<BookType, string> = {
  VL: 'Vật liệu',
  NC: 'Nhân công',
  M: 'Ca máy',
  TH: 'Đơn giá tổng hợp',
};

export interface PriceBook {
  id: number;
  region: string;
  subArea: string | null;
  issuer: string;
  docNumber: string;
  docDate: string | null;
  periodType: PeriodType;
  periodYear: number;
  /** month 1–12 or quarter 1–4; null for a year */
  periodValue: number | null;
  periodStart: string;
  periodEnd: string;
  bookType: BookType;
  vat: 'included' | 'excluded' | 'unknown';
  /** VAT rate (%) contained in the prices when vat = included. */
  vatRate: number | null;
  delivery: string | null;
  sourceUrl: string | null;
  sourceFile: string | null;
  status: 'draft' | 'verified';
  note: string | null;
  title: string;
}

export interface PriceBookRow {
  id: number;
  bookId: number;
  resourceCode: string | null;
  rawCode: string | null;
  name: string;
  spec: string | null;
  unit: string;
  price: number;
  subArea: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** ISO start/end dates of a price period (tháng / quý / năm). */
export function periodRange(type: PeriodType, year: number, value: number | null): { start: string; end: string } {
  if (type === 'month') {
    const m = value ?? 1;
    return { start: `${year}-${pad(m)}-01`, end: `${year}-${pad(m)}-${pad(lastDay(year, m))}` };
  }
  if (type === 'quarter') {
    const q = value ?? 1;
    const m1 = (q - 1) * 3 + 1;
    return { start: `${year}-${pad(m1)}-01`, end: `${year}-${pad(m1 + 2)}-${pad(lastDay(year, m1 + 2))}` };
  }
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function periodLabel(type: PeriodType, year: number, value: number | null): string {
  if (type === 'month') return `tháng ${pad(value ?? 1)}/${year}`;
  if (type === 'quarter') return `quý ${['I', 'II', 'III', 'IV'][(value ?? 1) - 1]}/${year}`;
  return `năm ${year}`;
}

/**
 * Propose books for a project: same region (and sub-area when both are set), period starting on or
 * before the price date; per book type the latest period first.
 */
export function proposeBooks<T extends Pick<PriceBook, 'region' | 'subArea' | 'periodStart' | 'bookType' | 'status'>>(
  books: T[],
  region: string | null,
  priceDate: string | null,
  subArea?: string | null,
): T[] {
  if (!region) return [];
  const r = normalizeText(region);
  const date = priceDate || new Date().toISOString().slice(0, 10);
  return books
    .filter((b) => normalizeText(b.region) === r)
    .filter((b) => !b.subArea || !subArea || normalizeText(b.subArea) === normalizeText(subArea))
    .filter((b) => b.periodStart <= date)
    .sort((a, b) => a.bookType.localeCompare(b.bookType) || b.periodStart.localeCompare(a.periodStart));
}

export interface ResolvableResource {
  code: string;
  unit: string;
  type: ResourceType;
  basePrice: number;
  isSample?: boolean;
}

export interface BookSelection {
  book: PriceBook;
  rows: PriceBookRow[];
  /** Resource type this selection is used for. */
  resourceType: ResourceType;
  /** 1 = highest priority */
  priority: number;
}

export interface PriceSource {
  kind: 'manual' | 'book' | 'base';
  label: string;
  bookId?: number;
  rowId?: number;
  /** Original quoted price before VAT removal / unit conversion. */
  quoted?: number;
  notes?: string[];
}

export interface ResolvedPrice {
  price: number;
  source: PriceSource;
}

export function bookTitle(b: Pick<PriceBook, 'issuer' | 'docNumber' | 'periodType' | 'periodYear' | 'periodValue' | 'region'>): string {
  return `${b.docNumber ? b.docNumber + ' – ' : ''}${b.issuer || b.region}, ${periodLabel(b.periodType, b.periodYear, b.periodValue)}`;
}

/** Price of one book row converted to the resource unit and made VAT-exclusive. Null if not usable. */
export function bookRowPrice(row: PriceBookRow, book: PriceBook, resourceUnit: string): { price: number; notes: string[] } | null {
  const notes: string[] = [];
  let price = row.price;
  if (book.vat === 'included') {
    const rate = book.vatRate ?? 10;
    price = price / (1 + rate / 100);
    notes.push(`đã trừ VAT ${rate}%`);
  } else if (book.vat === 'unknown') notes.push('chưa rõ giá đã gồm VAT hay chưa');
  if (row.unit && resourceUnit) {
    const f = unitFactor(resourceUnit, row.unit);
    if (f === null) return null;
    if (f !== 1) {
      price = price * f;
      notes.push(`quy đổi đ/${row.unit} → đ/${resourceUnit}`);
    }
  }
  return { price, notes };
}

/**
 * Price resolution per resource: project manual override → selected books by priority
 * (matching resource type, row sub-area = project sub-area or general) → base price (flagged).
 */
export function resolvePrices(
  resources: ResolvableResource[],
  manual: Record<string, number>,
  selections: BookSelection[],
  subArea?: string | null,
): Record<string, ResolvedPrice> {
  const out: Record<string, ResolvedPrice> = {};
  const sorted = [...selections].sort((a, b) => a.priority - b.priority);
  const sa = subArea ? normalizeText(subArea) : null;
  for (const r of resources) {
    if (manual[r.code] !== undefined && manual[r.code] !== null) {
      out[r.code] = { price: manual[r.code], source: { kind: 'manual', label: 'Giá nhập tay cho công trình' } };
      continue;
    }
    let found: ResolvedPrice | null = null;
    for (const sel of sorted) {
      if (sel.resourceType !== r.type || sel.book.bookType === 'TH') continue;
      const candidates = sel.rows.filter((row) => row.resourceCode === r.code);
      const exact = sa ? candidates.find((row) => row.subArea && normalizeText(row.subArea) === sa) : undefined;
      const general = candidates.find((row) => !row.subArea);
      const row = exact ?? general;
      if (!row) continue;
      const p = bookRowPrice(row, sel.book, r.unit);
      if (!p) continue;
      const status = sel.book.status === 'draft' ? ' [bản nháp – chưa xác minh]' : '';
      found = {
        price: p.price,
        source: {
          kind: 'book',
          label: `${sel.book.title}${row.subArea ? ` – ${row.subArea}` : ''}${status}`,
          bookId: sel.book.id,
          rowId: row.id,
          quoted: row.price,
          notes: p.notes,
        },
      };
      break;
    }
    out[r.code] = found ?? {
      price: r.basePrice,
      source: { kind: 'base', label: r.isSample ? 'Giá gốc thư viện (MẪU – không phải giá công bố)' : 'Giá gốc thư viện' },
    };
  }
  return out;
}

/** Fuzzy match of a price-book row to library resources by name/spec and unit (Jaccard on tokens). */
export function matchResource<T extends { code: string; name: string; unit: string }>(
  row: { name: string; spec?: string | null; unit?: string | null },
  resources: T[],
): { resource: T; score: number } | null {
  const tok = (s: string) => new Set(normalizeText(s).split(/[^a-z0-9]+/).filter((t) => t.length > 1 || /\d/.test(t)));
  const q = tok(`${row.name} ${row.spec ?? ''}`);
  if (!q.size) return null;
  let best: { resource: T; score: number } | null = null;
  let second = 0;
  for (const r of resources) {
    if (row.unit && r.unit && unitFactor(r.unit, row.unit) === null) continue;
    const d = tok(r.name);
    const inter = [...q].filter((t) => d.has(t)).length;
    const score = inter / (q.size + d.size - inter);
    if (!best || score > best.score) {
      second = best?.score ?? 0;
      best = { resource: r, score };
    } else if (score > second) second = score;
  }
  if (!best || best.score < 0.5 || best.score - second < 0.1) return null;
  return best;
}

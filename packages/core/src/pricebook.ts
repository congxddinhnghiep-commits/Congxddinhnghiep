import { normalizeText } from './text.js';
import type { ResourceType } from './types.js';
import { transportAmount, type TransportLeg } from './transport.js';
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
  /** Province name at the time of issue (before the 2025 merger it may differ from `region`). */
  jurisdictionAtIssue?: string | null;
  /** Whether the quoted prices already include transport to site: yes / no / unknown. */
  transportIncluded?: 'yes' | 'no' | 'unknown';
  verificationStatus?: 'verified' | 'needs_review' | 'not_verified' | 'superseded';
}

export interface ProvinceMerger {
  successor: string;
  predecessors: string[];
}

/** Current province for a province name at issue (post-2025 merger); null when unknown. */
export function successorOf(name: string, mergers: ProvinceMerger[]): string | null {
  const n = normalizeText(name);
  for (const m of mergers) if (m.predecessors.some((p) => normalizeText(p) === n) || normalizeText(m.successor) === n) return m.successor;
  return null;
}

/**
 * A book issued for a former province (jurisdiction at issue ≠ current region) may only be applied
 * when the project's area is known to lie in that former province (sub-area matches) – never to the
 * whole merged province by default.
 */
export function bookScopeFits(book: Pick<PriceBook, 'region' | 'subArea' | 'jurisdictionAtIssue'>, projectSubArea: string | null | undefined): boolean {
  if (!book.jurisdictionAtIssue || normalizeText(book.jurisdictionAtIssue) === normalizeText(book.region)) return true;
  if (!projectSubArea) return false;
  const sa = normalizeText(projectSubArea);
  return normalizeText(book.jurisdictionAtIssue) === sa || (!!book.subArea && normalizeText(book.subArea) === sa);
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
export function proposeBooks<T extends Pick<PriceBook, 'region' | 'subArea' | 'periodStart' | 'bookType' | 'status'> & Partial<Pick<PriceBook, 'jurisdictionAtIssue' | 'verificationStatus'>>>(
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
    .filter((b) => b.verificationStatus !== 'superseded')
    .filter((b) => bookScopeFits(b, subArea))
    .filter((b) => !b.subArea || !subArea || normalizeText(b.subArea) === normalizeText(subArea) || (!!b.jurisdictionAtIssue && normalizeText(b.jurisdictionAtIssue) === normalizeText(subArea)))
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
  /** Source price before transport to site. */
  sourcePrice?: number;
  /** Transport to site added (VND per unit), 0 when the source already includes it. */
  transport?: number;
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
  legs: Record<string, TransportLeg[]> = {},
): Record<string, ResolvedPrice> {
  const out = resolveSourcePrices(resources, manual, selections, subArea);
  // Transport to site – never added twice
  for (const [code, list] of Object.entries(legs)) {
    const r = out[code];
    if (!r || !list.length) continue;
    const t = transportAmount(list);
    const book = r.source.bookId !== undefined ? selections.find((s) => s.book.id === r.source.bookId)?.book : undefined;
    const included = r.source.kind === 'manual' ? true : r.source.kind === 'book' ? book?.transportIncluded === 'yes' : false;
    r.source.sourcePrice = r.price;
    r.source.notes = [...(r.source.notes ?? [])];
    if (included) {
      r.source.transport = 0;
      r.source.notes.push(
        r.source.kind === 'manual'
          ? 'giá nhập tay coi là giá đến công trình – không cộng vận chuyển (tránh tính 2 lần)'
          : 'nguồn giá đã gồm vận chuyển – không cộng cự ly vận chuyển (tránh tính 2 lần)',
      );
    } else {
      r.source.transport = t;
      r.price += t;
      r.source.notes.push(`+ vận chuyển đến công trình ${Math.round(t).toLocaleString('vi-VN')} đ/đv`);
      if (book?.transportIncluded === 'unknown' || (r.source.kind === 'book' && !book?.transportIncluded)) r.source.notes.push('chưa rõ nguồn giá đã gồm vận chuyển hay chưa');
    }
  }
  return out;
}

function resolveSourcePrices(
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

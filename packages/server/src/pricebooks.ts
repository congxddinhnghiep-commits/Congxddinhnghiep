import fs from 'node:fs';
import path from 'node:path';
import {
  bookTitle,
  matchResource,
  normalizeText,
  periodRange,
  proposeBooks,
  resolvePrices,
  type BookSelection,
  type BookType,
  type PeriodType,
  type PriceBook,
  type PriceBookRow,
  type ResolvedPrice,
  type ResourceType,
} from '@dutoan/core';
import { DATA_DIR } from './config.js';
import type { DB } from './db.js';
import { analyze, saveTemplate, type AnalyzeOptions } from './estimate-import.js';
import type { ParsedFile } from './importer.js';
import { HttpError, type Repo } from './repo.js';

interface BookRow {
  id: number;
  region: string;
  sub_area: string | null;
  issuer: string;
  doc_number: string;
  doc_date: string | null;
  period_type: PeriodType;
  period_year: number;
  period_value: number | null;
  period_start: string;
  period_end: string;
  book_type: BookType;
  vat: PriceBook['vat'];
  vat_rate: number | null;
  delivery: string | null;
  source_url: string | null;
  source_file: string | null;
  status: 'draft' | 'verified';
  note: string | null;
  created_by: string;
  created_at: string;
  verified_by: string | null;
  verified_at: string | null;
  row_count?: number;
  unmatched?: number;
}

const toBook = (r: BookRow) => {
  const b: PriceBook & { createdBy: string; createdAt: string; verifiedBy: string | null; verifiedAt: string | null; rowCount: number; unmatched: number } = {
    id: r.id,
    region: r.region,
    subArea: r.sub_area,
    issuer: r.issuer,
    docNumber: r.doc_number,
    docDate: r.doc_date,
    periodType: r.period_type,
    periodYear: r.period_year,
    periodValue: r.period_value,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    bookType: r.book_type,
    vat: r.vat,
    vatRate: r.vat_rate,
    delivery: r.delivery,
    sourceUrl: r.source_url,
    sourceFile: r.source_file,
    status: r.status,
    note: r.note,
    title: '',
    createdBy: r.created_by,
    createdAt: r.created_at,
    verifiedBy: r.verified_by,
    verifiedAt: r.verified_at,
    rowCount: r.row_count ?? 0,
    unmatched: r.unmatched ?? 0,
  };
  b.title = bookTitle(b);
  return b;
};

interface RowRow {
  id: number;
  book_id: number;
  resource_code: string | null;
  raw_code: string | null;
  name: string;
  spec: string | null;
  unit: string;
  price: number;
  sub_area: string | null;
  source_row: number | null;
  match_status: 'matched' | 'unmatched' | 'manual' | 'ignored';
  match_note: string | null;
}
const toRow = (r: RowRow) => ({
  id: r.id,
  bookId: r.book_id,
  resourceCode: r.resource_code,
  rawCode: r.raw_code,
  name: r.name,
  spec: r.spec,
  unit: r.unit,
  price: r.price,
  subArea: r.sub_area,
  sourceRow: r.source_row,
  matchStatus: r.match_status,
  matchNote: r.match_note,
});

let regionsCache: string[] | null = null;
export function regions(): string[] {
  if (!regionsCache) regionsCache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'regions.json'), 'utf8')).regions;
  return regionsCache!;
}

export interface BookInput {
  region?: string;
  subArea?: string | null;
  issuer?: string;
  docNumber?: string;
  docDate?: string | null;
  periodType?: PeriodType;
  periodYear?: number;
  periodValue?: number | null;
  bookType?: BookType;
  vat?: PriceBook['vat'];
  vatRate?: number | null;
  delivery?: string | null;
  sourceUrl?: string | null;
  sourceFile?: string | null;
  note?: string | null;
}

export class PriceBookService {
  constructor(
    private db: DB,
    private repo: Repo,
  ) {}

  list(filter: { region?: string; type?: string } = {}) {
    const rows = this.db
      .prepare(
        `SELECT b.*, (SELECT COUNT(*) FROM price_book_rows r WHERE r.book_id = b.id AND r.match_status <> 'ignored') AS row_count,
                (SELECT COUNT(*) FROM price_book_rows r WHERE r.book_id = b.id AND r.match_status = 'unmatched') AS unmatched
         FROM price_books b ORDER BY b.region, b.book_type, b.period_start DESC, b.id DESC`,
      )
      .all() as BookRow[];
    return rows
      .map(toBook)
      .filter((b) => !filter.region || normalizeText(b.region) === normalizeText(filter.region))
      .filter((b) => !filter.type || b.bookType === filter.type);
  }

  get(id: number) {
    const b = this.list().find((x) => x.id === id);
    if (!b) throw new HttpError(404, 'Không tìm thấy bộ đơn giá');
    return b;
  }

  rows(bookId: number) {
    return (this.db.prepare('SELECT * FROM price_book_rows WHERE book_id = ? ORDER BY id').all(bookId) as RowRow[]).map(toRow);
  }

  private validate(i: BookInput, cur?: ReturnType<PriceBookService['get']>) {
    const region = (i.region ?? cur?.region ?? '').trim();
    if (!region) throw new HttpError(400, 'Chưa chọn tỉnh/thành');
    const periodType = i.periodType ?? cur?.periodType ?? 'month';
    if (!['month', 'quarter', 'year'].includes(periodType)) throw new HttpError(400, 'Kỳ giá không hợp lệ');
    const periodYear = Number(i.periodYear ?? cur?.periodYear);
    if (!(periodYear >= 2000 && periodYear <= 2100)) throw new HttpError(400, 'Năm của kỳ giá không hợp lệ');
    let periodValue = i.periodValue !== undefined ? i.periodValue : cur?.periodValue ?? null;
    if (periodType === 'year') periodValue = null;
    else {
      periodValue = Number(periodValue);
      const max = periodType === 'month' ? 12 : 4;
      if (!(periodValue >= 1 && periodValue <= max)) throw new HttpError(400, periodType === 'month' ? 'Tháng không hợp lệ' : 'Quý không hợp lệ');
    }
    const bookType = i.bookType ?? cur?.bookType ?? 'VL';
    if (!['VL', 'NC', 'M', 'TH'].includes(bookType)) throw new HttpError(400, 'Loại bộ giá không hợp lệ');
    const vat = i.vat ?? cur?.vat ?? 'unknown';
    if (!['included', 'excluded', 'unknown'].includes(vat)) throw new HttpError(400, 'Trạng thái VAT không hợp lệ');
    const vatRate = i.vatRate !== undefined ? i.vatRate : cur?.vatRate ?? null;
    if (vat === 'included' && vatRate !== null && !(Number(vatRate) >= 0 && Number(vatRate) <= 20)) throw new HttpError(400, 'Thuế suất VAT không hợp lệ');
    const { start, end } = periodRange(periodType, periodYear, periodValue);
    return {
      region,
      subArea: (i.subArea !== undefined ? i.subArea : cur?.subArea) || null,
      issuer: (i.issuer ?? cur?.issuer ?? '').trim(),
      docNumber: (i.docNumber ?? cur?.docNumber ?? '').trim(),
      docDate: (i.docDate !== undefined ? i.docDate : cur?.docDate) || null,
      periodType,
      periodYear,
      periodValue,
      start,
      end,
      bookType,
      vat,
      vatRate: vat === 'included' ? Number(vatRate ?? 10) : null,
      delivery: (i.delivery !== undefined ? i.delivery : cur?.delivery) || null,
      sourceUrl: (i.sourceUrl !== undefined ? i.sourceUrl : cur?.sourceUrl) || null,
      sourceFile: (i.sourceFile !== undefined ? i.sourceFile : cur?.sourceFile) || null,
      note: (i.note !== undefined ? i.note : cur?.note) || null,
    };
  }

  create(i: BookInput, user: string) {
    const v = this.validate(i);
    const info = this.db
      .prepare(
        `INSERT INTO price_books (region, sub_area, issuer, doc_number, doc_date, period_type, period_year, period_value, period_start, period_end,
           book_type, vat, vat_rate, delivery, source_url, source_file, note, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(v.region, v.subArea, v.issuer, v.docNumber, v.docDate, v.periodType, v.periodYear, v.periodValue, v.start, v.end, v.bookType, v.vat, v.vatRate, v.delivery, v.sourceUrl, v.sourceFile, v.note, user);
    return this.get(Number(info.lastInsertRowid));
  }

  update(id: number, i: BookInput) {
    const cur = this.get(id);
    const v = this.validate(i, cur);
    this.db
      .prepare(
        `UPDATE price_books SET region = ?, sub_area = ?, issuer = ?, doc_number = ?, doc_date = ?, period_type = ?, period_year = ?, period_value = ?,
           period_start = ?, period_end = ?, book_type = ?, vat = ?, vat_rate = ?, delivery = ?, source_url = ?, source_file = ?, note = ?,
           status = 'draft', verified_by = NULL, verified_at = NULL WHERE id = ?`,
      )
      .run(v.region, v.subArea, v.issuer, v.docNumber, v.docDate, v.periodType, v.periodYear, v.periodValue, v.start, v.end, v.bookType, v.vat, v.vatRate, v.delivery, v.sourceUrl, v.sourceFile, v.note, id);
    return this.get(id);
  }

  delete(id: number) {
    this.get(id);
    this.db.prepare('DELETE FROM price_books WHERE id = ?').run(id);
  }

  setStatus(id: number, status: 'draft' | 'verified', user: string) {
    const b = this.get(id);
    if (status === 'verified' && b.rowCount === 0) throw new HttpError(400, 'Bộ đơn giá chưa có dòng giá nào – không thể xác minh.');
    this.db
      .prepare(`UPDATE price_books SET status = ?, verified_by = ?, verified_at = ? WHERE id = ?`)
      .run(status, status === 'verified' ? user : null, status === 'verified' ? new Date().toISOString() : null, id);
    return this.get(id);
  }

  /** Import rows from an analysed sheet (price-list mode) and match them to library resources. */
  importRows(bookId: number, f: ParsedFile, o: AnalyzeOptions & { replace?: boolean; saveTemplate?: string | null }, user: string) {
    const book = this.get(bookId);
    const a = analyze(this.db, this.repo, f, { ...o, kind: 'pricebook' });
    if (!a.header) throw new HttpError(400, 'Chưa xác định được dòng tiêu đề');
    if (a.header.mapping.name === undefined || a.header.mapping.price === undefined) throw new HttpError(400, 'Cần gán cột Tên vật tư và Giá');
    const resources = this.repo.listResources().filter((r) => book.bookType === 'TH' || r.type === book.bookType);
    const byCode = new Map(resources.map((r) => [r.code.toUpperCase(), r]));
    const ins = this.db.prepare(
      `INSERT INTO price_book_rows (book_id, resource_code, raw_code, name, spec, unit, price, sub_area, source_row, match_status, match_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let matched = 0;
    let unmatched = 0;
    this.db.transaction(() => {
      if (o.replace) this.db.prepare('DELETE FROM price_book_rows WHERE book_id = ?').run(bookId);
      for (const r of a.rows) {
        if (r.type !== 'item' || r.price === null) continue;
        const code = r.code.trim().toUpperCase();
        let res = code ? byCode.get(code) : undefined;
        let note = res ? 'khớp theo mã' : '';
        if (!res) {
          const m = matchResource({ name: r.name, spec: r.spec, unit: r.unit }, resources);
          if (m) {
            res = m.resource;
            note = `khớp theo tên ${Math.round(m.score * 100)}%`;
          }
        }
        if (res) matched++;
        else unmatched++;
        ins.run(bookId, res?.code ?? null, code || null, r.name || code, r.spec || null, r.unit, r.price, r.subArea || null, r.excelRow, res ? 'matched' : 'unmatched', note || null);
      }
      this.db.prepare(`UPDATE price_books SET status = 'draft', verified_by = NULL, verified_at = NULL, source_file = COALESCE(source_file, ?) WHERE id = ?`).run(f.fileName, bookId);
      if (o.saveTemplate && a.fingerprint) saveTemplate(this.db, 'pricebook', o.saveTemplate, a.fingerprint, a.header!.headerRows, a.header!.mapping, user);
    })();
    return { imported: matched + unmatched, matched, unmatched, message: `Đã nhập ${matched + unmatched} dòng giá: ${matched} khớp tài nguyên, ${unmatched} cần xem lại.` };
  }

  /** Manual matching from the review list (resourceCode null + ignore to exclude a row). */
  matchRow(bookId: number, rowId: number, resourceCode: string | null, ignore = false) {
    const row = this.rows(bookId).find((r) => r.id === rowId);
    if (!row) throw new HttpError(404, 'Không tìm thấy dòng giá');
    if (ignore) {
      this.db.prepare(`UPDATE price_book_rows SET resource_code = NULL, match_status = 'ignored', match_note = 'bỏ qua' WHERE id = ?`).run(rowId);
    } else if (resourceCode) {
      if (!this.repo.getResource(resourceCode)) throw new HttpError(404, 'Không tìm thấy tài nguyên');
      this.db.prepare(`UPDATE price_book_rows SET resource_code = ?, match_status = 'manual', match_note = 'gán thủ công' WHERE id = ?`).run(resourceCode.toUpperCase(), rowId);
    } else {
      this.db.prepare(`UPDATE price_book_rows SET resource_code = NULL, match_status = 'unmatched', match_note = NULL WHERE id = ?`).run(rowId);
    }
    this.db.prepare(`UPDATE price_books SET status = 'draft', verified_by = NULL, verified_at = NULL WHERE id = ?`).run(bookId);
    return this.rows(bookId).find((r) => r.id === rowId);
  }

  // ---------------- project selection ----------------
  selection(projectId: number) {
    return (
      this.db.prepare('SELECT book_id, resource_type, priority FROM project_price_books WHERE project_id = ? ORDER BY resource_type, priority').all(projectId) as {
        book_id: number;
        resource_type: ResourceType;
        priority: number;
      }[]
    ).map((r) => ({ bookId: r.book_id, resourceType: r.resource_type, priority: r.priority }));
  }

  saveSelection(projectId: number, sel: { bookId: number; resourceType: ResourceType; priority: number }[]) {
    for (const s of sel) {
      const b = this.get(s.bookId);
      if (!['VL', 'NC', 'M'].includes(s.resourceType)) throw new HttpError(400, 'Loại tài nguyên không hợp lệ');
      if (b.bookType !== 'TH' && b.bookType !== s.resourceType) throw new HttpError(400, `Bộ "${b.title}" là bộ giá ${b.bookType}, không dùng cho ${s.resourceType}`);
    }
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM project_price_books WHERE project_id = ?').run(projectId);
      const ins = this.db.prepare('INSERT INTO project_price_books (project_id, book_id, resource_type, priority) VALUES (?, ?, ?, ?)');
      for (const s of sel) ins.run(projectId, s.bookId, s.resourceType, Math.max(1, Math.round(s.priority)));
      this.repo.touchProject(projectId);
    })();
  }

  proposals(projectId: number) {
    const p = this.repo.getProject(projectId)!;
    const list = proposeBooks(this.list(), p.region, p.priceDate, p.subArea);
    return { region: p.region, subArea: p.subArea, priceDate: p.priceDate, books: list };
  }

  selectionsFor(sel: { bookId: number; resourceType: ResourceType; priority: number }[]): BookSelection[] {
    const cache = new Map<number, PriceBookRow[]>();
    return sel.map((s) => {
      if (!cache.has(s.bookId)) {
        cache.set(
          s.bookId,
          this.rows(s.bookId)
            .filter((r) => r.matchStatus !== 'ignored' && r.resourceCode)
            .map((r) => ({ id: r.id, bookId: r.bookId, resourceCode: r.resourceCode, rawCode: r.rawCode, name: r.name, spec: r.spec, unit: r.unit, price: r.price, subArea: r.subArea })),
        );
      }
      return { book: this.get(s.bookId), rows: cache.get(s.bookId)!, resourceType: s.resourceType, priority: s.priority };
    });
  }

  /** Effective price and source of every library resource for a project. */
  resolve(projectId: number, sel = this.selection(projectId)): Record<string, ResolvedPrice> {
    const p = this.repo.getProject(projectId)!;
    return resolvePrices(this.repo.listResources(), this.repo.projectPrices(projectId), this.selectionsFor(sel), p.subArea);
  }

  /** Price differences for the resources used by the project when switching to another selection. */
  preview(projectId: number, next: { bookId: number; resourceType: ResourceType; priority: number }[]) {
    const before = this.resolve(projectId);
    const after = this.resolve(projectId, next);
    const calc = this.repo.calculate(projectId);
    const rows = calc.resourceSummary
      .map((r) => {
        const a = before[r.code];
        const b = after[r.code];
        return {
          code: r.code,
          name: r.name,
          unit: r.unit,
          type: r.type,
          quantity: r.quantity,
          oldPrice: a.price,
          newPrice: b.price,
          oldSource: a.source.label,
          newSource: b.source.label,
          delta: (b.price - a.price) * r.quantity,
        };
      })
      .filter((r) => Math.abs(r.newPrice - r.oldPrice) > 1e-9 || r.oldSource !== r.newSource);
    return { rows, totalDelta: rows.reduce((s, r) => s + r.delta, 0) };
  }

  history(code: string) {
    const res = this.repo.getResource(code);
    if (!res) throw new HttpError(404, 'Không tìm thấy tài nguyên');
    const rows = this.db
      .prepare(`SELECT r.*, b.id AS bid FROM price_book_rows r JOIN price_books b ON b.id = r.book_id WHERE r.resource_code = ? ORDER BY b.period_start, b.region`)
      .all(res.code) as (RowRow & { bid: number })[];
    const books = new Map(this.list().map((b) => [b.id, b]));
    return {
      resource: res,
      points: rows.map((r) => {
        const b = books.get(r.book_id)!;
        return {
          bookId: b.id,
          title: b.title,
          region: b.region,
          subArea: r.sub_area,
          periodStart: b.periodStart,
          period: b.title,
          vat: b.vat,
          status: b.status,
          unit: r.unit,
          price: r.price,
        };
      }),
    };
  }
}

/** Metadata-only example (Update 2, D5): no prices are invented. */
export function seedPriceBookExample(db: DB): void {
  const exists = db.prepare(`SELECT 1 FROM price_books WHERE doc_number = ?`).get('7563/TB-SXD-KTVLXD');
  if (exists) return;
  const { start, end } = periodRange('month', 2026, 2);
  db.prepare(
    `INSERT INTO price_books (region, issuer, doc_number, doc_date, period_type, period_year, period_value, period_start, period_end, book_type,
       vat, source_url, status, note, created_by)
     VALUES (?, ?, ?, ?, 'month', 2026, 2, ?, ?, 'VL', 'unknown', ?, 'draft', ?, 'seed')`,
  ).run(
    'TP. Hồ Chí Minh',
    'Sở Xây dựng TP. Hồ Chí Minh',
    '7563/TB-SXD-KTVLXD',
    '2026-03-10',
    start,
    end,
    'https://soxaydung.hochiminhcity.gov.vn',
    'Công bố giá vật liệu xây dựng tháng 02/2026. Chỉ có thông tin văn bản (nguồn tóm tắt: dutoanf1.com.vn; trang chính thức: soxaydung.hochiminhcity.gov.vn) – chưa có dòng giá. Tải file công bố giá chính thức và nhập vào để sử dụng.',
  );
}

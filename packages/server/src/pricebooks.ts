import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import {
  bookTitle,
  canonicalUnit,
  successorOf,
  transportAmount,
  type ProvinceMerger,
  type TransportLeg,
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
  jurisdiction_at_issue: string | null;
  source_file_url: string | null;
  source_sha256: string | null;
  verification_status: 'verified' | 'needs_review' | 'not_verified' | 'superseded';
  transport_included: 'yes' | 'no' | 'unknown';
  work_type: string | null;
  row_count?: number;
  unmatched?: number;
}

const toBook = (r: BookRow) => {
  const b: PriceBook & {
    createdBy: string;
    createdAt: string;
    verifiedBy: string | null;
    verifiedAt: string | null;
    rowCount: number;
    unmatched: number;
    sourceFileUrl: string | null;
    sourceSha256: string | null;
    workType: string | null;
  } = {
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
    jurisdictionAtIssue: r.jurisdiction_at_issue ?? r.region,
    sourceFileUrl: r.source_file_url,
    sourceSha256: r.source_sha256,
    verificationStatus: r.verification_status,
    transportIncluded: r.transport_included,
    workType: r.work_type,
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
  description_original: string | null;
  unit_original: string | null;
  value_original: string | null;
  vat_status: string | null;
  source_locator: string | null;
  commercial_terms: string | null;
  normalization_formula: string | null;
  verification_status: string | null;
  notes: string | null;
  work_type: string | null;
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
  descriptionOriginal: r.description_original,
  unitOriginal: r.unit_original,
  valueOriginal: r.value_original,
  vatStatus: r.vat_status,
  sourceLocator: r.source_locator,
  commercialTerms: r.commercial_terms,
  verificationStatus: r.verification_status,
});

let mergerCache: { effectiveDate: string; source: string; mergers: ProvinceMerger[] } | null = null;
export function provinceMergers() {
  if (!mergerCache) mergerCache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'province-mergers.json'), 'utf8'));
  return mergerCache!;
}

const VAT_STATUS = { included: 'including_vat', excluded: 'before_vat', unknown: 'not_stated' } as const;
const RECORD_TYPE = { VL: 'material_price', NC: 'labor_rate', M: 'machine_rate', TH: 'unit_price' } as const;

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
  jurisdictionAtIssue?: string | null;
  sourceFileUrl?: string | null;
  transportIncluded?: 'yes' | 'no' | 'unknown';
  workType?: string | null;
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

  /** Source register of suppliers cited in the notice (used when the book itself has no price rows yet). */
  suppliers(bookId: number) {
    return (
      this.db.prepare('SELECT group_no, group_name, item_no, supplier, reference, status FROM price_book_suppliers WHERE book_id = ? ORDER BY sort_order').all(bookId) as {
        group_no: string;
        group_name: string;
        item_no: string | null;
        supplier: string;
        reference: string | null;
        status: string | null;
      }[]
    ).map((r) => ({ groupNo: r.group_no, groupName: r.group_name, itemNo: r.item_no, supplier: r.supplier, reference: r.reference, status: r.status }));
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
    const atIssue = ((i.jurisdictionAtIssue !== undefined ? i.jurisdictionAtIssue : cur?.jurisdictionAtIssue) || region).trim();
    if (normalizeText(atIssue) !== normalizeText(region)) {
      const m = provinceMergers();
      const succ = successorOf(atIssue, m.mergers);
      if (!succ) throw new HttpError(400, `Không có thông tin sáp nhập cho địa bàn "${atIssue}" (data/province-mergers.json)`);
      if (normalizeText(succ) !== normalizeText(region)) throw new HttpError(400, `Địa bàn "${atIssue}" sau 01/07/2025 thuộc ${succ}, không phải ${region}`);
      if (start >= m.effectiveDate) throw new HttpError(400, `Kỳ giá từ ${m.effectiveDate} phải ghi theo địa giới mới (${succ})`);
    }
    const transportIncluded = i.transportIncluded ?? cur?.transportIncluded ?? 'unknown';
    if (!['yes', 'no', 'unknown'].includes(transportIncluded)) throw new HttpError(400, 'Trạng thái vận chuyển không hợp lệ');
    return {
      atIssue,
      transportIncluded,
      sourceFileUrl: (i.sourceFileUrl !== undefined ? i.sourceFileUrl : cur?.sourceFileUrl) || null,
      workType: (i.workType !== undefined ? i.workType : cur?.workType) || null,
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
           book_type, vat, vat_rate, delivery, source_url, source_file, note, created_by, jurisdiction_at_issue, source_file_url, transport_included, work_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(v.region, v.subArea, v.issuer, v.docNumber, v.docDate, v.periodType, v.periodYear, v.periodValue, v.start, v.end, v.bookType, v.vat, v.vatRate, v.delivery, v.sourceUrl, v.sourceFile, v.note, user, v.atIssue, v.sourceFileUrl, v.transportIncluded, v.workType);
    return this.get(Number(info.lastInsertRowid));
  }

  update(id: number, i: BookInput) {
    const cur = this.get(id);
    const v = this.validate(i, cur);
    this.db
      .prepare(
        `UPDATE price_books SET region = ?, sub_area = ?, issuer = ?, doc_number = ?, doc_date = ?, period_type = ?, period_year = ?, period_value = ?,
           period_start = ?, period_end = ?, book_type = ?, vat = ?, vat_rate = ?, delivery = ?, source_url = ?, source_file = ?, note = ?,
           jurisdiction_at_issue = ?, source_file_url = ?, transport_included = ?, work_type = ?,
           status = 'draft', verification_status = 'needs_review', verified_by = NULL, verified_at = NULL WHERE id = ?`,
      )
      .run(v.region, v.subArea, v.issuer, v.docNumber, v.docDate, v.periodType, v.periodYear, v.periodValue, v.start, v.end, v.bookType, v.vat, v.vatRate, v.delivery, v.sourceUrl, v.sourceFile, v.note, v.atIssue, v.sourceFileUrl, v.transportIncluded, v.workType, id);
    return this.get(id);
  }

  delete(id: number) {
    this.get(id);
    this.db.prepare('DELETE FROM price_books WHERE id = ?').run(id);
  }

  /** verification_status per data-contract: verified / needs_review / not_verified / superseded. */
  setStatus(id: number, status: 'draft' | 'verified' | 'needs_review' | 'not_verified' | 'superseded', user: string) {
    const b = this.get(id);
    const vs = status === 'draft' ? 'needs_review' : status;
    if (vs === 'verified' && b.rowCount === 0) throw new HttpError(400, 'Bộ đơn giá chưa có dòng giá nào – không thể xác minh.');
    const verified = vs === 'verified';
    this.db.transaction(() => {
      this.db
        .prepare(`UPDATE price_books SET status = ?, verification_status = ?, verified_by = ?, verified_at = ? WHERE id = ?`)
        .run(verified ? 'verified' : 'draft', vs, verified ? user : null, verified ? new Date().toISOString() : null, id);
      if (verified) this.db.prepare(`UPDATE price_book_rows SET verification_status = 'verified' WHERE book_id = ? AND match_status <> 'ignored'`).run(id);
    })();
    return this.get(id);
  }

  /** Rows as data-contract records (du-toan-xay-dung-data-vn/data-contract.md). */
  records(bookId: number) {
    const b = this.get(bookId);
    return this.rows(bookId).map((r) => ({
      record_id: `PB${b.id}-R${r.id}`,
      record_type: RECORD_TYPE[b.bookType],
      jurisdiction_current: b.region,
      jurisdiction_at_issue: b.jurisdictionAtIssue ?? b.region,
      area_code_or_name: r.subArea ?? b.subArea ?? null,
      work_type: b.workType ?? null,
      item_code: r.rawCode ?? r.resourceCode ?? null,
      description_original: r.descriptionOriginal ?? [r.name, r.spec].filter(Boolean).join(' – '),
      description_normalized: [r.name, r.spec].filter(Boolean).join(' – '),
      unit_original: r.unitOriginal ?? r.unit,
      unit_normalized: canonicalUnit(r.unit) || null,
      value_original: r.valueOriginal ?? String(r.price),
      currency: 'VND',
      vat_status: r.vatStatus ?? VAT_STATUS[b.vat],
      period_from: b.periodStart,
      period_to: b.periodEnd,
      publication_no: b.docNumber || null,
      publication_date: b.docDate,
      issuing_body: b.issuer || null,
      source_page_url: b.sourceUrl,
      source_file_url: b.sourceFileUrl ?? b.sourceUrl,
      source_file_name: b.sourceFile,
      source_sha256: b.sourceSha256,
      source_locator: r.sourceLocator ?? (r.sourceRow ? `dòng ${r.sourceRow}` : null),
      commercial_terms: r.commercialTerms ?? b.delivery,
      normalization_formula: null,
      verification_status: r.matchStatus === 'ignored' ? 'not_verified' : r.verificationStatus ?? 'needs_review',
      verified_at: b.verifiedAt,
      verified_by: b.verifiedBy,
      notes: [r.matchNote, r.resourceCode ? `→ tài nguyên ${r.resourceCode}` : 'chưa khớp tài nguyên'].filter(Boolean).join('; '),
    }));
  }

  // ---------------- transport to site ----------------
  transportLegs(projectId: number): Record<string, (TransportLeg & { amount: number })[]> {
    const rows = this.db.prepare('SELECT * FROM project_transport_legs WHERE project_id = ? ORDER BY resource_code, sort_order, id').all(projectId) as {
      id: number;
      resource_code: string;
      from_location: string;
      to_location: string;
      road_class: string | null;
      distance: number;
      freight_rate: number;
      load_factor: number;
      weight_factor: number;
      handling: number;
      toll: number;
      note: string | null;
    }[];
    const out: Record<string, (TransportLeg & { amount: number })[]> = {};
    for (const r of rows) {
      const leg: TransportLeg = {
        id: r.id,
        fromLocation: r.from_location,
        toLocation: r.to_location,
        roadClass: r.road_class,
        distance: r.distance,
        freightRate: r.freight_rate,
        loadFactor: r.load_factor,
        weightFactor: r.weight_factor,
        handling: r.handling,
        toll: r.toll,
        note: r.note,
      };
      (out[r.resource_code] ??= []).push({ ...leg, amount: transportAmount([leg]) });
    }
    return out;
  }

  saveTransportLegs(projectId: number, code: string, legs: TransportLeg[]) {
    if (!this.repo.getResource(code)) throw new HttpError(404, 'Không tìm thấy tài nguyên');
    for (const l of legs) {
      for (const k of ['distance', 'freightRate', 'loadFactor', 'weightFactor', 'handling', 'toll'] as const) {
        if (!Number.isFinite(l[k]) || l[k] < 0) throw new HttpError(400, `Giá trị không hợp lệ: ${k}`);
      }
    }
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM project_transport_legs WHERE project_id = ? AND resource_code = ?').run(projectId, code);
      const ins = this.db.prepare(
        `INSERT INTO project_transport_legs (project_id, resource_code, sort_order, from_location, to_location, road_class, distance, freight_rate,
           load_factor, weight_factor, handling, toll, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      legs.forEach((l, i) =>
        ins.run(projectId, code, i + 1, l.fromLocation ?? '', l.toLocation ?? '', l.roadClass ?? null, l.distance, l.freightRate, l.loadFactor, l.weightFactor, l.handling, l.toll, l.note ?? null),
      );
      this.repo.touchProject(projectId);
    })();
    return this.transportLegs(projectId)[code] ?? [];
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
      `INSERT INTO price_book_rows (book_id, resource_code, raw_code, name, spec, unit, price, sub_area, source_row, match_status, match_note,
         description_original, unit_original, value_original, vat_status, source_locator, commercial_terms, verification_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'needs_review')`,
    );
    const sheet = f.sheets[a.sheetIndex];
    const priceCol = a.header.mapping.price!;
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
        const rawName = r.rawName ?? r.name;
        const valueCell = sheet.rows[r.index]?.[priceCol];
        ins.run(
          bookId,
          res?.code ?? null,
          code || null,
          r.name || code,
          r.spec || null,
          r.unit,
          r.price,
          r.subArea || null,
          r.excelRow,
          res ? 'matched' : 'unmatched',
          note || null,
          [rawName, r.spec].filter(Boolean).join(' – '),
          sheet.raw?.[`${r.index}:${a.header!.mapping.unit}`] ?? r.unit,
          valueCell === null || valueCell === undefined ? null : String(valueCell),
          VAT_STATUS[book.vat],
          `${sheet.name}!dòng ${r.excelRow}`,
          book.delivery,
        );
      }
      this.db
        .prepare(
          `UPDATE price_books SET status = 'draft', verification_status = 'needs_review', verified_by = NULL, verified_at = NULL,
             source_file = ?, source_sha256 = ? WHERE id = ?`,
        )
        .run(f.fileName, f.sha256 ?? null, bookId);
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
    this.db.prepare(`UPDATE price_books SET status = 'draft', verification_status = 'needs_review', verified_by = NULL, verified_at = NULL WHERE id = ?`).run(bookId);
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
    const all = this.list();
    const list = proposeBooks(all, p.region, p.priceDate, p.subArea);
    const excluded = all
      .filter((b) => p.region && normalizeText(b.region) === normalizeText(p.region) && !list.includes(b))
      .map((b) => ({
        id: b.id,
        title: b.title,
        reason:
          b.verificationStatus === 'superseded'
            ? 'đã bị thay thế'
            : b.jurisdictionAtIssue && normalizeText(b.jurisdictionAtIssue) !== normalizeText(b.region)
              ? `ban hành cho địa giới cũ "${b.jurisdictionAtIssue}" – chỉ áp dụng khi khu vực công trình thuộc địa bàn đó`
              : b.periodStart > (p.priceDate ?? '') ? 'kỳ giá sau ngày lập giá' : 'khác khu vực',
      }));
    return { region: p.region, subArea: p.subArea, priceDate: p.priceDate, books: list, excluded };
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
    return resolvePrices(this.repo.listResources(), this.repo.projectPrices(projectId), this.selectionsFor(sel), p.subArea, this.transportLegs(projectId));
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

/** Metadata-only: Công bố giá VLXD TP. Hồ Chí Minh tháng 8/2026 (số 32431/TB-SXD-KTVLXD). No prices are invented. */
export function seedTt38PriceBookAugust2026(db: DB): void {
  const docNumber = '32431/TB-SXD-KTVLXD';
  const exists = db.prepare(`SELECT 1 FROM price_books WHERE doc_number = ?`).get(docNumber);
  if (exists) return;
  const { start, end } = periodRange('month', 2026, 8);
  db.prepare(
    `INSERT INTO price_books (region, issuer, doc_number, doc_date, period_type, period_year, period_value, period_start, period_end, book_type,
       vat, status, verification_status, note, created_by)
     VALUES (?, ?, ?, ?, 'month', 2026, 8, ?, ?, 'VL', 'unknown', 'draft', 'needs_review', ?, ?)`,
  ).run(
    'TP. Hồ Chí Minh',
    'Sở Xây dựng',
    docNumber,
    '2026-09-09',
    start,
    end,
    `Công bố giá vật liệu xây dựng tháng 08/2026, số ${docNumber} ngày 09/09/2026. Ngày ban hành đọc từ dấu ký số (e-sign) trên file – verification_status = needs_review, cần đối chiếu bản gốc. ` +
      'Chỉ có thông tin văn bản, chưa có dòng giá (0 dòng): cần nhập bổ sung Phụ lục 1-19 (giá VLXD theo khu vực) từ file công bố chính thức.',
    'import:tt38',
  );
}

interface SupplierCsvRow {
  nhom: string;
  ten_nhom: string;
  stt: string;
  don_vi: string;
  can_cu: string;
  trang_thai: string;
}

/**
 * Metadata-only: Công bố giá VLXD TP. Hồ Chí Minh tháng 6/2026 (trước 01/07/2026, căn cứ NĐ 10/2021 +
 * TT 11/2021). The notice's own number isn't in the PDF text layer (likely a scanned stamp) – flagged
 * needs_review instead of guessed. No price rows; imports its supplier source register instead
 * (data/pricebooks/hcm_2026_06/hcm_2026_06_suppliers.csv – 25 material groups, 49 supplier letters).
 */
export function seedHcmJune2026PriceBook(db: DB): void {
  const { start, end } = periodRange('month', 2026, 6);
  const exists = db.prepare(`SELECT id FROM price_books WHERE region = ? AND period_start = ? AND period_end = ? AND book_type = 'VL'`).get('TP. Hồ Chí Minh', start, end) as
    | { id: number }
    | undefined;
  if (exists) return;
  const info = db
    .prepare(
      `INSERT INTO price_books (region, issuer, doc_number, doc_date, period_type, period_year, period_value, period_start, period_end, book_type,
         vat, status, verification_status, note, created_by)
       VALUES (?, ?, ?, NULL, 'month', 2026, 6, ?, ?, 'VL', 'unknown', 'draft', 'needs_review', ?, ?)`,
    )
    .run(
      'TP. Hồ Chí Minh',
      'Sở Xây dựng',
      '',
      start,
      end,
      'Công bố giá vật liệu xây dựng tháng 06/2026. Căn cứ pháp lý ghi trong thông báo: Nghị định số 10/2021/NĐ-CP và Thông tư số 11/2021/TT-BXD ' +
        '(trước ngày 01/07/2026, chưa theo địa giới/quy định hợp nhất từ 01/07/2026). Số hiệu thông báo không có trong lớp văn bản (text layer) của file – ' +
        'verification_status = needs_review, cần đối chiếu bản gốc để lấy số hiệu. Chưa có dòng giá (0 dòng): phụ lục là bản scan độ phân giải thấp, chưa trích được số liệu – ' +
        'xem danh sách đơn vị công bố giá (nguồn) bên dưới; cần trích giá từ bản scan gốc.',
      'import:hcm-2026-06',
    );
  const bookId = Number(info.lastInsertRowid);

  const file = path.join(DATA_DIR, 'pricebooks/hcm_2026_06/hcm_2026_06_suppliers.csv');
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const parsed = Papa.parse<SupplierCsvRow>(raw, { header: true, skipEmptyLines: true });
  const insSupplier = db.prepare(
    `INSERT INTO price_book_suppliers (book_id, group_no, group_name, item_no, supplier, reference, status, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  parsed.data.forEach((r, i) => {
    const groupNo = (r.nhom ?? '').trim();
    const supplier = (r.don_vi ?? '').trim();
    if (!groupNo || !supplier) return;
    insSupplier.run(bookId, groupNo, (r.ten_nhom ?? '').trim(), (r.stt ?? '').trim() || null, supplier, (r.can_cu ?? '').trim() || null, (r.trang_thai ?? '').trim() || null, i);
  });
}

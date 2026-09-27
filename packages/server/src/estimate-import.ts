import {
  canonicalNormCode,
  classifyRows,
  classifySheet,
  detectHeader,
  ESTIMATE_FIELDS,
  evaluateFormula,
  headerFingerprint,
  IMPORT_FIELD_LABELS,
  isFormula,
  normalizeText,
  PRICE_FIELDS,
  ROW_TYPE_LABELS,
  SHEET_KIND_LABELS,
  type ClassifiedRow,
  type HeaderDetection,
  type ImportField,
  type RowType,
} from '@dutoan/core';
import type { UndoOp } from './actions.js';
import type { DB } from './db.js';
import type { ParsedFile } from './importer.js';
import { HttpError, type Repo } from './repo.js';

export type ImportKind = 'estimate' | 'pricebook';

export interface AnalyzeOptions {
  sheetIndex?: number;
  headerRow?: number;
  headerRows?: 1 | 2;
  mapping?: Partial<Record<ImportField, number>>;
  kind?: ImportKind;
  /** Project whose norm dataset is used to check codes and suggest (estimate imports). */
  projectId?: number;
}

interface TemplateRow {
  id: number;
  name: string;
  kind: ImportKind;
  fingerprint: string;
  header_rows: number;
  mapping_json: string;
  created_by: string;
  created_at: string;
  used_count: number;
}

export function listTemplates(db: DB, kind?: ImportKind) {
  const rows = (kind
    ? db.prepare('SELECT * FROM import_templates WHERE kind = ? ORDER BY used_count DESC, id DESC').all(kind)
    : db.prepare('SELECT * FROM import_templates ORDER BY id DESC').all()) as TemplateRow[];
  return rows.map((t) => ({ id: t.id, name: t.name, kind: t.kind, fingerprint: t.fingerprint, headerRows: t.header_rows, mapping: JSON.parse(t.mapping_json), createdBy: t.created_by, createdAt: t.created_at, usedCount: t.used_count }));
}

export function saveTemplate(db: DB, kind: ImportKind, name: string, fingerprint: string, headerRows: number, mapping: Partial<Record<ImportField, number>>, user: string) {
  db.prepare(
    `INSERT INTO import_templates (name, kind, fingerprint, header_rows, mapping_json, created_by) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, fingerprint) DO UPDATE SET name = excluded.name, header_rows = excluded.header_rows, mapping_json = excluded.mapping_json`,
  ).run(name.trim() || 'Mẫu nhập', kind, fingerprint, headerRows, JSON.stringify(mapping), user);
}

function labelsAt(rows: (string | number | null)[][], merges: ParsedFile['sheets'][number]['merges'], headerRow: number, headerRows: number) {
  // Recompute labels for an explicit header position (same rules as detectHeader).
  const width = Math.max(0, ...rows.slice(headerRow, headerRow + headerRows + 1).map((r) => r?.length ?? 0));
  const val = (r: number, c: number) => {
    const v = rows[r]?.[c];
    if (v !== null && v !== undefined && v !== '') return v;
    for (const m of merges ?? []) if (r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c) return rows[m.s.r]?.[m.s.c] ?? null;
    return null;
  };
  const raw: string[] = [];
  const labels: string[] = [];
  for (let c = 0; c < width; c++) {
    const top = val(headerRow, c);
    const sub = headerRows === 2 ? val(headerRow + 1, c) : null;
    const text = [top, sub !== top ? sub : null].filter((x) => x !== null && typeof x !== 'number').map(String).join(' ').trim();
    raw.push(text);
    labels.push(normalizeText(text.replace(/[\r\n]+/g, ' ').replace(/[()（）:：.]/g, ' ')));
  }
  return { raw, labels };
}

export interface AnalyzedRow extends ClassifiedRow {
  /** 1-based row number as shown in Excel. */
  excelRow: number;
  /** Canonical norm code (AF11121 → AF.11121); raw code stays in `code`. */
  normalizedCode?: string;
  pricingMethod?: 'NORM_BASED' | 'CUSTOM_GTT' | null;
  /** Original (legacy-encoded) description when it was converted to Unicode. */
  rawName?: string | null;
  /** FLAG_EXTERNAL_LINK_OR_BROKEN_FORMULA etc. */
  flags?: string[];
  codeKnown?: boolean;
  suggestion?: { code: string; name: string; confidence: number; why: string } | null;
}

/** Analyse one sheet: sheet kinds, header (detected, template or user mapping), classified rows. */
export function analyze(db: DB, repo: Repo, f: ParsedFile, o: AnalyzeOptions) {
  const kind = o.kind ?? 'estimate';
  const fields = kind === 'estimate' ? ESTIMATE_FIELDS : PRICE_FIELDS;
  const sheetInfo = f.sheets.map((s, i) => {
    const h = detectHeader(s.rows, s.merges, fields);
    const k = classifySheet(s.name, h);
    return { index: i, name: s.name, rowCount: s.rows.length, kind: k, kindLabel: SHEET_KIND_LABELS[k], detected: !!h };
  });
  const wanted = kind === 'estimate' ? 'du_toan_chi_tiet' : 'gia_vat_lieu';
  const sheetIndex = o.sheetIndex ?? sheetInfo.find((s) => s.kind === wanted && s.detected)?.index ?? sheetInfo.find((s) => s.detected)?.index ?? 0;
  const sheet = f.sheets[sheetIndex];
  if (!sheet) throw new HttpError(400, 'Sheet không tồn tại');

  const detected = detectHeader(sheet.rows, sheet.merges, fields);
  let header: HeaderDetection | null = detected;
  if (o.headerRow !== undefined) {
    const headerRows = o.headerRows ?? 1;
    const { raw, labels } = labelsAt(sheet.rows, sheet.merges, o.headerRow, headerRows);
    header = { headerRow: o.headerRow, headerRows, labels, rawLabels: raw, mapping: detected?.mapping ?? {}, confidence: detected?.confidence ?? 0 };
  }
  const fingerprint = header ? headerFingerprint(header.labels, header.headerRows) : null;
  let template: ReturnType<typeof listTemplates>[number] | null = null;
  if (header && fingerprint) {
    template = listTemplates(db, kind).find((t) => t.fingerprint === fingerprint) ?? null;
    if (template && !o.mapping) header = { ...header, mapping: template.mapping };
  }
  if (header && o.mapping) {
    const clean: Partial<Record<ImportField, number>> = {};
    for (const [k, v] of Object.entries(o.mapping)) if (typeof v === 'number' && v >= 0 && (fields as string[]).includes(k)) clean[k as ImportField] = v;
    header = { ...header, mapping: clean };
  }

  const preview = sheet.rows.slice(0, 30);
  if (!header) {
    return {
      fileId: f.id,
      fileName: f.fileName,
      kind,
      sheets: sheetInfo,
      sheetIndex,
      preview,
      header: null,
      fingerprint: null,
      template: null,
      rows: [] as AnalyzedRow[],
      counts: {} as Record<RowType, number>,
      fields: fields.map((k) => ({ key: k, label: IMPORT_FIELD_LABELS[k] })),
      rowTypeLabels: ROW_TYPE_LABELS,
      warnings: ['Không nhận diện được dòng tiêu đề – hãy chọn dòng tiêu đề và gán cột thủ công.'],
    };
  }

  const classified = classifyRows(sheet.rows, header);
  const dataset = o.projectId ? repo.datasetOf(o.projectId) : null;
  const index = dataset ? repo.normIndex(dataset) : null;
  const issuesByRow = new Map<number, NonNullable<typeof sheet.issues>>();
  for (const is of sheet.issues ?? []) issuesByRow.set(is.row, [...(issuesByRow.get(is.row) ?? []), is]);
  const colLetter = (c: number) => (c < 26 ? String.fromCharCode(65 + c) : `C${c + 1}`);
  const rows: AnalyzedRow[] = classified.map((r) => {
    const out: AnalyzedRow = { ...r, excelRow: r.index + 1 };
    const nameCol = header!.mapping.name;
    out.rawName = nameCol !== undefined ? sheet.raw?.[`${r.index}:${nameCol}`] ?? null : null;
    const issues = issuesByRow.get(r.index) ?? [];
    if (issues.length) {
      out.flags = [...new Set(issues.map((i) => i.flag))];
      out.warnings = [
        ...out.warnings,
        ...issues.map((i) => (i.kind === 'external_link' ? `Ô ${colLetter(i.col)}${i.row + 1} liên kết workbook khác (${i.value})` : `Ô ${colLetter(i.col)}${i.row + 1} lỗi ${i.value}`)),
      ];
    }
    const cc = canonicalNormCode(r.code);
    out.normalizedCode = cc.normalized;
    out.pricingMethod = cc.kind === 'custom' ? 'CUSTOM_GTT' : cc.kind === 'norm' ? 'NORM_BASED' : null;
    if (kind === 'estimate' && r.type === 'item' && cc.kind === 'custom') {
      out.codeKnown = false;
      out.warnings = [...out.warnings, 'Mã GTT: tính theo giá tạm tính/tự lập (CUSTOM_GTT) – cần nguồn giá'];
    } else if (kind === 'estimate' && r.type === 'item' && dataset && index) {
      out.codeKnown = !!(cc.normalized && repo.getNorm(cc.normalized, dataset));
      if (r.code && !out.codeKnown) out.warnings = [...out.warnings, `Mã "${r.code}" không có trong bộ định mức ${dataset}`];
      else if (out.codeKnown && cc.normalized !== r.code.trim().toUpperCase()) out.warnings = [...out.warnings, `Mã chuẩn hóa ${r.code} → ${cc.normalized}`];
      if (!out.codeKnown) {
        const s = index.suggest(r.name, r.unit || null, 1)[0];
        out.suggestion = s ? { code: s.norm.code, name: s.norm.name, confidence: s.confidence, why: s.why } : null;
      }
    }
    return out;
  });
  const counts = {} as Record<RowType, number>;
  for (const r of rows) counts[r.type] = (counts[r.type] ?? 0) + 1;
  const warnings: string[] = [];
  const m = header.mapping;
  if (kind === 'estimate' && (m.name === undefined || m.quantity === undefined)) warnings.push('Chưa xác định cột Tên công việc hoặc Khối lượng.');
  if (kind === 'pricebook' && (m.name === undefined || m.price === undefined)) warnings.push('Chưa xác định cột Tên vật tư hoặc Giá.');
  return {
    fileId: f.id,
    fileName: f.fileName,
    kind,
    sheets: sheetInfo,
    sheetIndex,
    preview,
    header: { headerRow: header.headerRow, headerRows: header.headerRows, labels: header.rawLabels, mapping: header.mapping, confidence: header.confidence },
    fingerprint,
    template: template ? { id: template.id, name: template.name } : null,
    rows,
    counts,
    fields: fields.map((k) => ({ key: k, label: IMPORT_FIELD_LABELS[k] })),
    rowTypeLabels: ROW_TYPE_LABELS,
    warnings: [
      ...(f.fileIssues ?? []),
      ...(sheet.encoding === 'vni' || sheet.encoding === 'tcvn3'
        ? [`Sheet dùng bảng mã cũ ${sheet.encoding.toUpperCase()} – đã chuyển sang Unicode (${Object.keys(sheet.raw ?? {}).length} ô), bản gốc được lưu kèm.`]
        : []),
      ...((sheet.issues?.length ?? 0) > 0
        ? [`${sheet.issues!.length} ô có lỗi công thức (#NAME?, #REF!…) hoặc liên kết workbook khác – không được dùng im lặng (FLAG_EXTERNAL_LINK_OR_BROKEN_FORMULA).`]
        : []),
      ...warnings,
    ],
    encoding: sheet.encoding ?? 'plain',
    sha256: f.sha256 ?? null,
  };
}

export interface ImportEstimateOptions extends AnalyzeOptions {
  /** Per-row overrides of the detected type (0-based row index → type). */
  rowTypes?: Record<string, RowType | 'skip'>;
  saveTemplate?: string | null;
}

/**
 * Create hạng mục and items from an analysed sheet. Every item keeps the original description,
 * quantity, unit, code and file/sheet/row; known norm codes are marked 'imported'.
 */
export function importEstimate(db: DB, repo: Repo, f: ParsedFile, projectId: number, o: ImportEstimateOptions, user: string) {
  const a = analyze(db, repo, f, { ...o, kind: 'estimate', projectId });
  if (!a.header) throw new HttpError(400, 'Chưa xác định được dòng tiêu đề');
  if (a.header.mapping.name === undefined || a.header.mapping.quantity === undefined) {
    throw new HttpError(400, 'Cần gán cột Tên công việc và Khối lượng trước khi nhập');
  }
  const dataset = repo.datasetOf(projectId);
  const sheetName = f.sheets[a.sheetIndex].name;
  const undo: UndoOp[] = [];
  const created: number[] = [];
  let categories = 0;
  let skipped = 0;
  db.transaction(() => {
    const existing = new Map(repo.listCategories(projectId).map((c) => [normalizeText(c.name), c.id]));
    let currentCat: number | null = null;
    const ensureDefault = () => {
      if (currentCat) return currentCat;
      const name = `Nhập từ ${f.fileName}`;
      const key = normalizeText(name);
      let id = existing.get(key);
      if (!id) {
        id = repo.createCategory(projectId, name).id;
        existing.set(key, id);
        undo.push({ op: 'deleteCategory', categoryId: id });
        categories++;
      }
      currentCat = id;
      return id;
    };
    for (const r of a.rows) {
      const type = o.rowTypes?.[String(r.index)] ?? r.type;
      if (type === 'category') {
        const name = (r.category ?? r.name ?? r.code).trim() || `Hạng mục dòng ${r.excelRow}`;
        const key = normalizeText(name);
        let id = existing.get(key);
        if (!id) {
          id = repo.createCategory(projectId, name).id;
          existing.set(key, id);
          undo.push({ op: 'deleteCategory', categoryId: id });
          categories++;
        }
        currentCat = id;
        continue;
      }
      if (type !== 'item') {
        if (type === 'skip') skipped++;
        continue;
      }
      const cc = canonicalNormCode(r.code);
      const code = cc.normalized;
      const isGtt = cc.kind === 'custom';
      const known = !isGtt && !!(code && repo.getNorm(code, dataset));
      let formula: string | null = null;
      if (r.formula && isFormula(r.formula)) {
        try {
          evaluateFormula(r.formula);
          formula = r.formula;
        } catch {
          formula = null;
        }
      }
      const item = repo.createItem(projectId, {
        categoryId: ensureDefault(),
        normCode: known ? code : '',
        name: r.name || code,
        unit: r.unit || undefined,
        quantity: r.quantity ?? 0,
        quantityFormula: formula,
        note: r.formula && !formula ? `Diễn giải gốc: ${r.formula}` : r.note || null,
        codeStatus: known ? 'imported' : '',
        source: {
          file: f.fileName,
          sheet: sheetName,
          row: r.excelRow,
          description: r.name || null,
          quantity: r.quantity,
          unit: r.unit || null,
          code: r.code || null,
        },
        sourceRawText: r.rawName ?? null,
        sourceFlags: r.flags ?? [],
        quantitySource: 'IMPORTED',
        pricing: isGtt
          ? {
              pricingMethod: 'CUSTOM_GTT',
              custom: { vl: r.prices.vl ?? r.prices.unit ?? 0, nc: r.prices.nc ?? 0, m: r.prices.m ?? 0 },
              priceSource:
                r.prices.vl !== null || r.prices.nc !== null || r.prices.m !== null || r.prices.unit !== null
                  ? `Đơn giá trong file ${f.fileName} / ${sheetName} / dòng ${r.excelRow} (chưa xác minh)`
                  : null,
            }
          : undefined,
      });
      created.push(item.id);
      undo.unshift({ op: 'deleteItem', itemId: item.id });
    }
    if (o.saveTemplate && a.fingerprint) saveTemplate(db, 'estimate', o.saveTemplate, a.fingerprint, a.header!.headerRows, a.header!.mapping, user);
    if (a.template) db.prepare('UPDATE import_templates SET used_count = used_count + 1 WHERE id = ?').run(a.template.id);
  })();
  const withCode = created.filter((id) => repo.getItem(projectId, id).codeStatus === 'imported').length;
  return {
    created: created.length,
    categories,
    skipped,
    withCode,
    withoutCode: created.length - withCode,
    itemIds: created,
    undo,
    message: `Đã nhập ${created.length} công việc (${withCode} có mã định mức hợp lệ, ${created.length - withCode} cần gắn mã) vào ${categories} hạng mục mới từ ${f.fileName} / ${sheetName}.`,
  };
}

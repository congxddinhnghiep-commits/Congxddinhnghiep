import {
  canonicalNormCode,
  classifyRows,
  classifySheet,
  detectHeader,
  ESTIMATE_FIELDS,
  evaluateFormula,
  isSumFormula,
  headerFingerprint,
  headerTexts,
  IMPORT_FIELD_LABELS,
  isFormula,
  normalizeText,
  PRICE_FIELDS,
  profileColumns,
  refineMapping,
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
import { parseFlexibleNumber } from '@dutoan/core';
import { removeForReplace, saveImportSource, type ReimportSnapshot } from './import-sources.js';
import { resolveImportCode, type CodeResolution } from './import-codes.js';
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
  /** Data range as Excel row numbers (1-based, inclusive); default = everything below the header. */
  firstRow?: number;
  lastRow?: number;
  /** Per-row overrides of the detected type (0-based row index → type). */
  rowTypes?: Record<string, RowType | 'skip'>;
  /**
   * 'file' – keep the unit prices found in the file as item-level manual prices (source: file, cell);
   * 'norm' – recompute from the norms and price books of the project (file prices are ignored).
   */
  pricingOption?: 'file' | 'norm';
  /** The user confirmed a mostly-numeric column as the work name ("Vẫn dùng"). */
  allowNumericName?: boolean;
}

export const colLetter = (c: number): string => {
  let n = c + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

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
  /** Section B: check of the file code against the active norm set + top-3 proposals. */
  resolution?: CodeResolution;
  /** Excel cell of each mapped field, e.g. { vl: 'F6', nc: 'G6' }. */
  cells?: Record<string, string>;
  /** Unit price used by the file (VL + NC + M, or the combined unit price). */
  fileUnitPrice?: number | null;
  /** Thành tiền recomputed as quantity × unit price (file option) or from the norm (norm option). */
  computedAmount?: number | null;
  /** Norm-based unit cost of the resolved code ("giá theo định mức"). */
  normUnit?: number | null;
}

export interface Reconciliation {
  items: { excelRow: number; name: string; quantity: number | null; unitPrice: number | null; fileAmount: number | null; computed: number | null; diff: number | null; ok: boolean | null }[];
  subtotals: { excelRow: number; name: string; fileAmount: number; computed: number; diff: number; ok: boolean }[];
  grand: { fileAmount: number | null; computed: number; diff: number | null; ok: boolean | null };
  allOk: boolean;
}

const TOL = 1;
const GRAND_RE = /^(tong cong|tong|tong gia tri|tong so|tong chi phi|total|grand total)\b|总计|合计/;

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
    const { raw, labels } = headerTexts(sheet.rows, sheet.merges ?? [], o.headerRow, headerRows);
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

  // Content-based correction of the column mapping (never let a numeric column be the work name).
  const dataStart0 = header.headerRow + header.headerRows;
  const hidden = new Set(sheet.hiddenCols ?? []);
  const dupCols = new Set<number>();
  const widthAll = Math.max(0, ...sheet.rows.map((r) => r?.length ?? 0));
  for (let c = 0; c < widthAll; c++) {
    let filled = 0;
    let total = 0;
    for (let r = dataStart0; r < sheet.rows.length; r++) {
      const v = sheet.rows[r]?.[c];
      if (v === null || v === undefined || v === '') continue;
      total++;
      if (sheet.mergeFilled?.[`${r}:${c}`]) filled++;
    }
    if (total > 0 && filled / total >= 0.8) dupCols.add(c);
  }
  const detectionNotes: string[] = [];
  if (kind === 'estimate' && !o.mapping) {
    const refined = refineMapping(sheet.rows, header.mapping, { exclude: new Set([...hidden, ...dupCols]), first: dataStart0, last: sheet.rows.length - 1, headerLabels: header.rawLabels });
    header = { ...header, mapping: refined.mapping as HeaderDetection['mapping'] };
    detectionNotes.push(...refined.notes);
  }
  const m = header.mapping;
  const columnWarnings: { field: string; column: number; letter: string; message: string; blocking: boolean }[] = [];
  if (kind === 'estimate' && m.name !== undefined) {
    const prof = profileColumns(sheet.rows, dataStart0, sheet.rows.length - 1, header.rawLabels)[m.name];
    if (prof && prof.nonEmpty > 0 && prof.numericShare >= 0.6) {
      columnWarnings.push({ field: 'name', column: m.name, letter: colLetter(m.name), message: 'Cột này chủ yếu là số – không phải tên công việc', blocking: true });
    }
  }
  const sumRows = new Set<number>();
  if (m.amount !== undefined) {
    for (const [key, formula] of Object.entries(sheet.formulas ?? {})) {
      const [r, c] = key.split(':').map(Number);
      if (c === m.amount && isSumFormula(formula)) sumRows.add(r);
    }
  }
  let classified = classifyRows(sheet.rows, header, sumRows);
  const first0 = o.firstRow !== undefined ? o.firstRow - 1 : -Infinity;
  const last0 = o.lastRow !== undefined ? o.lastRow - 1 : Infinity;
  classified = classified.filter((r) => r.index >= first0 && r.index <= last0);
  const dataset = o.projectId ? repo.datasetOf(o.projectId) : null;
  const issuesByRow = new Map<number, NonNullable<typeof sheet.issues>>();
  for (const is of sheet.issues ?? []) issuesByRow.set(is.row, [...(issuesByRow.get(is.row) ?? []), is]);
  const resolutions = new Map<string, CodeResolution>();
  const cellRef = (field: ImportField, index: number) => (m[field] === undefined ? undefined : `${colLetter(m[field]!)}${index + 1}`);
  const rows: AnalyzedRow[] = classified.map((r) => {
    const out: AnalyzedRow = { ...r, excelRow: r.index + 1 };
    if (o.rowTypes?.[String(r.index)] && o.rowTypes[String(r.index)] !== 'skip') out.type = o.rowTypes[String(r.index)] as RowType;
    const nameCol = m.name;
    out.rawName = nameCol !== undefined ? sheet.raw?.[`${r.index}:${nameCol}`] ?? null : null;
    const issues = issuesByRow.get(r.index) ?? [];
    if (issues.length) {
      out.flags = [...new Set(issues.map((i) => i.flag))];
      out.warnings = [
        ...out.warnings,
        ...issues.map((i) =>
          i.kind === 'external_link'
            ? `Ô ${colLetter(i.col)}${i.row + 1} liên kết workbook khác (${i.value})`
            : i.kind === 'formula_not_evaluated'
              ? `Ô ${colLetter(i.col)}${i.row + 1} có công thức ${i.value} không có giá trị lưu sẵn và không tính được – KHÔNG nhập bằng 0`
              : `Ô ${colLetter(i.col)}${i.row + 1} lỗi ${i.value}`,
        ),
      ];
    }
    if (sheet.evaluated && m.amount !== undefined && sheet.evaluated[`${r.index}:${m.amount}`] !== undefined && out.type === 'item') {
      out.warnings = [...out.warnings, `Thành tiền ô ${colLetter(m.amount)}${r.index + 1} là công thức chưa có giá trị lưu sẵn – đã tính lại (=${sheet.evaluated[`${r.index}:${m.amount}`]})`];
    }
    const cc = canonicalNormCode(r.code);
    out.normalizedCode = cc.normalized;
    out.pricingMethod = cc.kind === 'custom' ? 'CUSTOM_GTT' : cc.kind === 'norm' ? 'NORM_BASED' : null;
    const cells: Record<string, string> = {};
    for (const [key, field] of [['code', 'code'], ['name', 'name'], ['unit', 'unit'], ['quantity', 'quantity'], ['vl', 'priceVL'], ['nc', 'priceNC'], ['m', 'priceM'], ['unitPrice', 'unitPrice'], ['amount', 'amount'], ['note', 'note']] as [string, ImportField][]) {
      const ref = cellRef(field, r.index);
      if (ref) cells[key] = ref;
    }
    out.cells = cells;
    const p = r.prices;
    out.fileUnitPrice = p.vl !== null || p.nc !== null || p.m !== null ? (p.vl ?? 0) + (p.nc ?? 0) + (p.m ?? 0) : p.unit;
    if (kind === 'estimate' && out.type === 'item' && dataset) {
      const rk = `${r.code}|${r.name}|${r.unit}`;
      const res = resolutions.get(rk) ?? resolveImportCode(repo, dataset, { code: r.code, name: r.name, unit: r.unit });
      resolutions.set(rk, res);
      out.resolution = res;
      out.codeKnown = res.status === 'match' || res.status === 'mismatch';
      if (res.status === 'gtt') out.warnings = [...out.warnings, 'Mã GTT: tính theo giá tạm tính/tự lập (CUSTOM_GTT) – cần nguồn giá'];
      else if (r.code && !out.codeKnown) out.warnings = [...out.warnings, `Mã "${r.code}" không có trong bộ định mức ${dataset}`];
      else if (out.codeKnown && cc.normalized !== r.code.trim().toUpperCase()) out.warnings = [...out.warnings, `Mã chuẩn hóa ${r.code} → ${cc.normalized}`];
      if (res.status === 'mismatch') out.warnings = [...out.warnings, res.message];
      const s0 = res.candidates[0];
      if (!out.codeKnown && s0) out.suggestion = { code: s0.code, name: s0.name, confidence: s0.confidence, why: s0.reason };
      if (res.code) out.normUnit = repo.normUnitCost(dataset, res.code, o.projectId!)?.total ?? null;
      else if (s0) out.normUnit = repo.normUnitCost(dataset, s0.code, o.projectId!)?.total ?? null;
    }
    const q = r.quantity;
    const usedUnit = (o.pricingOption ?? 'file') === 'norm' ? out.normUnit ?? null : out.fileUnitPrice;
    out.computedAmount = q !== null && usedUnit !== null && usedUnit !== undefined ? q * usedUnit : null;
    return out;
  });
  const counts = {} as Record<RowType, number>;
  const typeOf = (r: AnalyzedRow) => (o.rowTypes?.[String(r.index)] as RowType | 'skip' | undefined) ?? r.type;
  for (const r of rows) counts[r.type] = (counts[r.type] ?? 0) + 1;
  const warnings: string[] = [];
  if (kind === 'estimate' && (m.name === undefined || m.quantity === undefined)) warnings.push('Chưa xác định cột Tên công việc hoặc Khối lượng.');
  if (kind === 'pricebook' && (m.name === undefined || m.price === undefined)) warnings.push('Chưa xác định cột Tên vật tư hoặc Giá.');

  // Fidelity check: per row and per category/total, the file's figures vs the recomputed ones.
  let reconciliation: Reconciliation | null = null;
  if (kind === 'estimate') {
    const recon: Reconciliation = { items: [], subtotals: [], grand: { fileAmount: null, computed: 0, diff: null, ok: null }, allOk: true };
    let catComputed = 0;
    let grandFile: number | null = null;
    let subtotalFileSum = 0;
    let hasSubtotal = false;
    for (const r of rows) {
      const t = typeOf(r);
      if (t === 'item') {
        const diff = r.amount !== null && r.computedAmount !== null && r.computedAmount !== undefined ? r.computedAmount - r.amount : null;
        const ok = diff === null ? null : Math.abs(diff) <= TOL;
        recon.items.push({ excelRow: r.excelRow, name: r.name, quantity: r.quantity, unitPrice: (o.pricingOption ?? 'file') === 'norm' ? r.normUnit ?? null : r.fileUnitPrice ?? null, fileAmount: r.amount, computed: r.computedAmount ?? null, diff, ok });
        if (ok === false) recon.allOk = false;
        catComputed += r.computedAmount ?? 0;
        recon.grand.computed += r.computedAmount ?? 0;
      } else if (t === 'category') catComputed = 0;
      else if (t === 'subtotal' && r.amount !== null) {
        if (GRAND_RE.test(normalizeText(r.name || r.code || ''))) grandFile = r.amount;
        else {
          const diff = catComputed - r.amount;
          const ok = Math.abs(diff) <= TOL;
          recon.subtotals.push({ excelRow: r.excelRow, name: r.name, fileAmount: r.amount, computed: catComputed, diff, ok });
          if (!ok) recon.allOk = false;
          subtotalFileSum += r.amount;
          hasSubtotal = true;
          catComputed = 0;
        }
      }
    }
    recon.grand.fileAmount = grandFile ?? (hasSubtotal ? subtotalFileSum : null);
    if (recon.grand.fileAmount !== null) {
      recon.grand.diff = recon.grand.computed - recon.grand.fileAmount;
      recon.grand.ok = Math.abs(recon.grand.diff) <= TOL;
      if (!recon.grand.ok) recon.allOk = false;
    }
    reconciliation = recon;
  }

  // Every non-empty column with its header text and 3 sample values, for the mapping dropdowns.
  const width = Math.max(0, ...sheet.rows.map((r) => r?.length ?? 0));
  const ht = headerTexts(sheet.rows, sheet.merges ?? [], header.headerRow, header.headerRows, width);
  const dataStart = header.headerRow + header.headerRows;
  const fmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 });
  const columns = [] as { index: number; letter: string; header: string; samples: string[]; label: string; hidden: boolean }[];
  for (let c = 0; c < width; c++) {
    const nonEmpty = sheet.rows.some((r) => r?.[c] !== null && r?.[c] !== undefined && r[c] !== '');
    if (!nonEmpty || dupCols.has(c)) continue;
    const samples: string[] = [];
    for (let i = dataStart; i < sheet.rows.length && samples.length < 3; i++) {
      const v = sheet.rows[i]?.[c];
      if (v === null || v === undefined || v === '') continue;
      samples.push(typeof v === 'number' ? fmt.format(v) : String(v).slice(0, 24));
    }
    const head = ht.parts[c].join(' / ');
    columns.push({ index: c, letter: colLetter(c), header: head, samples, hidden: hidden.has(c), label: `${colLetter(c)} – ${head || '(không có tiêu đề)'}${hidden.has(c) ? ' [cột ẩn]' : ''}${samples.length ? ` (vd: ${samples.join('; ')}…)` : ''}` });
  }
  // The first 15 mapped rows exactly as they will appear in the grid.
  const gridPreview = rows
    .filter((r) => (typeOf(r) === 'item' || typeOf(r) === 'category') && r.type !== 'subtotal')
    .slice(0, 15)
    .map((r) => {
      const t = typeOf(r);
      const unitPrice = (o.pricingOption ?? 'file') === 'norm' ? r.normUnit ?? null : r.fileUnitPrice ?? null;
      return {
        excelRow: r.excelRow,
        type: t,
        stt: r.stt,
        code: r.code,
        name: t === 'category' ? r.category ?? r.name : r.name,
        unit: r.unit,
        quantity: r.quantity,
        unitPrice,
        amount: r.computedAmount ?? null,
        nameIsNumeric: parseFlexibleNumber(r.name) !== null,
      };
    });
  const zeroItems = rows.filter((r) => typeOf(r) === 'item' && (r.quantity ?? 0) > 0 && !(r.computedAmount && r.computedAmount > 0));
  if (kind === 'estimate' && zeroItems.length) {
    warnings.push(`${zeroItems.length} công việc sẽ có thành tiền = 0 (chưa có đơn giá trong file${(o.pricingOption ?? 'file') === 'norm' ? '/định mức' : ''} hoặc chưa map cột đơn giá) – kiểm tra ánh xạ cột trước khi nhập.`);
  }
  const bodyRows = rows.map((r) => r.excelRow);
  return {
    fileId: f.id,
    fileName: f.fileName,
    kind,
    sheets: sheetInfo,
    sheetIndex,
    preview,
    header: { headerRow: header.headerRow, headerRows: header.headerRows, labels: header.rawLabels, mapping: header.mapping, confidence: header.confidence },
    range: { first: bodyRows.length ? Math.min(...bodyRows) : dataStart + 1, last: bodyRows.length ? Math.max(...bodyRows) : sheet.rows.length },
    columns,
    fingerprint,
    template: template ? { id: template.id, name: template.name } : null,
    rows,
    counts,
    reconciliation,
    gridPreview,
    columnWarnings,
    detectionNotes,
    zeroAmountRows: zeroItems.map((r) => r.excelRow),
    pricingOption: o.pricingOption ?? 'file',
    fields: fields.map((k) => ({ key: k, label: IMPORT_FIELD_LABELS[k] })),
    rowTypeLabels: ROW_TYPE_LABELS,
    warnings: [
      ...(f.fileIssues ?? []),
      ...(sheet.encoding === 'vni' || sheet.encoding === 'tcvn3'
        ? [`Sheet dùng bảng mã cũ ${sheet.encoding.toUpperCase()} – đã chuyển sang Unicode (${Object.keys(sheet.raw ?? {}).length} ô), bản gốc được lưu kèm.`]
        : []),
      ...(Object.keys(sheet.evaluated ?? {}).length
        ? [`${Object.keys(sheet.evaluated!).length} ô công thức không có giá trị lưu sẵn (file do thư viện ghi) – đã tính lại từ số liệu trong sheet.`]
        : []),
      ...((sheet.issues?.length ?? 0) > 0
        ? [`${sheet.issues!.length} ô có lỗi công thức (#NAME?, #REF!…), liên kết workbook khác hoặc công thức không tính được – không được dùng im lặng (FLAG_EXTERNAL_LINK_OR_BROKEN_FORMULA).`]
        : []),
      ...warnings,
    ],
    encoding: sheet.encoding ?? 'plain',
    sha256: f.sha256 ?? null,
  };
}

export interface ImportEstimateOptions extends AnalyzeOptions {
  saveTemplate?: string | null;
  /**
   * Norm code chosen per row (0-based row index → code, null = leave without code). Rows not listed keep
   * the file code when it exists in the active norm set (match / mismatch) and stay without code otherwise.
   */
  codeChoices?: Record<string, string | null>;
  /** Re-import: replace the items of this stored import / of these categories (as an undoable revision). */
  replaceImportId?: number;
  replaceCategoryIds?: number[];
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
  const blocking = a.columnWarnings?.find((w) => w.blocking);
  if (blocking && !o.allowNumericName) throw new HttpError(400, `Cột ${blocking.letter}: ${blocking.message}. Hãy chọn lại cột tên công việc hoặc xác nhận “Vẫn dùng”.`);
  const dataset = repo.datasetOf(projectId);
  const sheetName = f.sheets[a.sheetIndex].name;
  const undo: UndoOp[] = [];
  const created: number[] = [];
  let categories = 0;
  let skipped = 0;
  const createdCategoryIds: number[] = [];
  let replaced: ReturnType<typeof removeForReplace> | null = null;
  let importId = 0;
  let revisionId: number | null = null;
  db.transaction(() => {
    if (o.replaceImportId || o.replaceCategoryIds?.length) replaced = removeForReplace(db, projectId, { importId: o.replaceImportId, categoryIds: o.replaceCategoryIds });
    // A brand-new project has one empty default category; the file's own categories replace it.
    const cats0 = repo.listCategories(projectId);
    if (cats0.length === 1 && normalizeText(cats0[0].name) === 'hang muc chung' && repo.listItems(projectId).length === 0) {
      repo.deleteCategory(projectId, cats0[0].id);
      undo.push({ op: 'createCategory', name: cats0[0].name });
    }
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
        createdCategoryIds.push(id);
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
          createdCategoryIds.push(id);
          categories++;
        }
        currentCat = id;
        continue;
      }
      if (type !== 'item') {
        if (type === 'skip') skipped++;
        continue;
      }
      const res = r.resolution ?? resolveImportCode(repo, dataset, { code: r.code, name: r.name, unit: r.unit });
      const isGtt = res.status === 'gtt';
      const chosen = Object.prototype.hasOwnProperty.call(o.codeChoices ?? {}, String(r.index)) ? o.codeChoices![String(r.index)] : undefined;
      let code = '';
      let codeStatus: 'imported' | 'confirmed' | '' = '';
      if (!isGtt) {
        if (chosen) {
          const n = repo.getNorm(chosen, dataset);
          if (!n) throw new HttpError(400, `Mã ${chosen} không có trong bộ ${dataset} (dòng ${r.excelRow})`);
          code = n.code;
          codeStatus = res.code === n.code && (res.status === 'match' || res.status === 'mismatch') ? 'imported' : 'confirmed';
        } else if (chosen === undefined && res.code) {
          code = res.code;
          codeStatus = 'imported';
        }
      }
      let formula: string | null = null;
      if (r.formula && isFormula(r.formula)) {
        try {
          evaluateFormula(r.formula);
          formula = r.formula;
        } catch {
          formula = null;
        }
      }
      const p = r.prices;
      const hasFilePrice = p.vl !== null || p.nc !== null || p.m !== null || p.unit !== null;
      const fileMode = (o.pricingOption ?? 'norm') === 'file';
      const useFile = isGtt || (fileMode && hasFilePrice);
      const cells = r.cells ?? {};
      const priceCells = [cells.vl, cells.nc, cells.m].filter(Boolean) as string[];
      if (!priceCells.length && cells.unitPrice) priceCells.push(cells.unitPrice);
      const item = repo.createItem(projectId, {
        categoryId: ensureDefault(),
        normCode: code,
        name: r.name || code || r.code,
        unit: r.unit || undefined,
        quantity: r.quantity ?? 0,
        quantityFormula: formula,
        note: r.formula && !formula ? `Diễn giải gốc: ${r.formula}` : r.note || null,
        codeStatus,
        normCodeRaw: r.code || null,
        codeCheck: res.status === 'none' || res.status === 'gtt' ? null : res.status,
        codeCheckNote: res.status === 'none' || res.status === 'gtt' ? null : res.message + (code && code !== res.rawCode.toUpperCase() ? ` → đã chọn ${code}` : ''),
        source: {
          file: f.fileName,
          sheet: sheetName,
          row: r.excelRow,
          description: r.name || null,
          quantity: r.quantity,
          unit: r.unit || null,
          code: r.code || null,
          cells,
        },
        sourceRawText: r.rawName ?? null,
        sourceFlags: r.flags ?? [],
        quantitySource: 'IMPORTED',
        pricing: useFile
          ? {
              pricingMethod: 'CUSTOM_GTT',
              custom: { vl: p.vl ?? p.unit ?? 0, nc: p.nc ?? 0, m: p.m ?? 0 },
              priceSource: !hasFilePrice
                ? null
                : fileMode
                  ? `File Excel ${f.fileName}, ô ${priceCells.length ? priceCells.join('/') : `dòng ${r.excelRow}`}`
                  : `Đơn giá trong file ${f.fileName} / ${sheetName} / dòng ${r.excelRow} (chưa xác minh)`,
            }
          : undefined,
      });
      created.push(item.id);
      undo.unshift({ op: 'deleteItem', itemId: item.id });
    }
    // keep the parsed sheet so the mapping can be corrected later without uploading again
    importId = saveImportSource(db, {
      projectId,
      f,
      sheetIndex: a.sheetIndex,
      header: { headerRow: a.header!.headerRow, headerRows: a.header!.headerRows },
      mapping: a.header!.mapping as Record<string, number>,
      options: { firstRow: o.firstRow, lastRow: o.lastRow, rowTypes: o.rowTypes as Record<string, string> | undefined, pricingOption: o.pricingOption, allowNumericName: o.allowNumericName },
      user,
    });
    for (const id of created) db.prepare('UPDATE estimate_items SET import_id = ? WHERE id = ?').run(importId, id);
    if (replaced) {
      const snap: ReimportSnapshot = { ...(replaced as ReturnType<typeof removeForReplace>).snapshot, newItemIds: created, newCategoryIds: createdCategoryIds, newImportId: importId };
      const r = db
        .prepare('INSERT INTO estimate_revisions (project_id, kind, description, created_by, snapshot_json) VALUES (?, ?, ?, ?, ?)')
        .run(projectId, 'reimport', `Nhập lại ${f.fileName} / ${sheetName}: thay ${(replaced as ReturnType<typeof removeForReplace>).removed} công việc bằng ${created.length} công việc theo ánh xạ mới`, user, JSON.stringify(snap));
      revisionId = Number(r.lastInsertRowid);
    }
    if (o.saveTemplate && a.fingerprint) saveTemplate(db, 'estimate', o.saveTemplate, a.fingerprint, a.header!.headerRows, a.header!.mapping, user);
    if (a.template) db.prepare('UPDATE import_templates SET used_count = used_count + 1 WHERE id = ?').run(a.template.id);
  })();
  const withCode = created.filter((id) => ['imported', 'confirmed'].includes(repo.getItem(projectId, id).codeStatus ?? '')).length;
  return {
    created: created.length,
    categories,
    skipped,
    withCode,
    withoutCode: created.length - withCode,
    itemIds: created,
    importId,
    revisionId,
    zeroAmount: created.filter((id) => {
      const it = repo.getItem(projectId, id);
      return (it.quantity ?? 0) > 0 && (it.pricingMethod ?? 'NORM_BASED') === 'NORM_BASED' && !it.normCode;
    }).length,
    undo,
    message: `Đã nhập ${created.length} công việc (${withCode} có mã định mức hợp lệ, ${created.length - withCode} cần gắn mã) vào ${categories} hạng mục mới từ ${f.fileName} / ${sheetName}.`,
  };
}

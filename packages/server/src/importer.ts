import crypto from 'node:crypto';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { detectDominantEncoding, detectEncoding, fixVniCell, hasVniMarkers, toUnicode, type Merge, type TextEncoding } from '@dutoan/core';
import { evaluateFormula, evaluateSheetFormula, isFormula, normalizeText, parseFlexibleNumber, parseVnNumber, type ResourceType } from '@dutoan/core';
import { HttpError, type Repo } from './repo.js';

export type CellValue = string | number | null;
export const FLAG_BROKEN = 'FLAG_EXTERNAL_LINK_OR_BROKEN_FORMULA';

export const FLAG_FORMULA_NOT_EVALUATED = 'FLAG_FORMULA_NOT_EVALUATED';

export interface CellIssue {
  row: number;
  col: number;
  kind: 'broken_formula' | 'external_link' | 'formula_not_evaluated';
  value: string;
  flag: typeof FLAG_BROKEN | typeof FLAG_FORMULA_NOT_EVALUATED;
}

export interface ParsedSheet {
  name: string;
  /** Hidden sheet (workbook flag Hidden / VeryHidden). */
  hidden?: boolean;
  /** Cell values, legacy-encoded text converted to Unicode. */
  rows: CellValue[][];
  /** Merged ranges (0-based), used to read multi-row headers. */
  merges?: Merge[];
  /** Detected text encoding of the sheet (VNI / TCVN3 are converted). */
  encoding?: TextEncoding;
  /** Original text of converted cells, keyed "row:col". */
  raw?: Record<string, string>;
  /** Dominant text encoding per column (0-based). */
  columnEncodings?: Record<number, TextEncoding>;
  /** Hidden columns (0-based) – never auto-selected. */
  hiddenCols?: number[];
  /** Cells that got their value from the master cell of a merged range ("row:col"). */
  mergeFilled?: Record<string, true>;
  /** #NAME? / #REF! / … values and formulas pointing to other workbooks. */
  issues?: CellIssue[];
  /** Spreadsheet formulas by "row:col" (without "="), also those with a cached value. */
  formulas?: Record<string, string>;
  /** Cells whose formula had NO cached value and was evaluated on import ("row:col" → formula). */
  evaluated?: Record<string, string>;
}
export interface ParsedFile {
  id: string;
  fileName: string;
  userId: number;
  sheets: ParsedSheet[];
  createdAt: number;
  /** SHA-256 of the uploaded bytes (provenance). */
  sha256?: string;
  /** Workbook-level issues (e.g. external link parts). */
  fileIssues?: string[];
}

export type ImportTarget = 'norms' | 'prices' | 'items';

/** Fields that can be mapped to columns, per import target (labels in Vietnamese). */
export const IMPORT_FIELDS: Record<ImportTarget, { key: string; label: string; required?: boolean; hints: string[] }[]> = {
  norms: [
    { key: 'normCode', label: 'Mã hiệu định mức', required: true, hints: ['ma hieu dinh muc', 'ma dinh muc', 'ma hieu dm', 'ma dm', 'ma hieu', 'ma cong tac'] },
    { key: 'normName', label: 'Tên công tác', hints: ['ten cong tac', 'ten dinh muc', 'noi dung cong viec', 'ten cong viec'] },
    { key: 'normUnit', label: 'Đơn vị định mức', hints: ['don vi dinh muc', 'dvt dm', 'don vi dm', 'don vi cong tac'] },
    { key: 'group', label: 'Nhóm/chương', hints: ['nhom', 'chuong'] },
    { key: 'resourceCode', label: 'Mã tài nguyên (VT/NC/M)', required: true, hints: ['ma vat tu', 'ma tai nguyen', 'ma vt', 'ma tn', 'ma hao phi'] },
    { key: 'resourceName', label: 'Tên tài nguyên', hints: ['ten vat tu', 'ten tai nguyen', 'ten vt', 'thanh phan hao phi', 'hao phi'] },
    { key: 'resourceUnit', label: 'Đơn vị tài nguyên', hints: ['don vi vat tu', 'dvt vt', 'don vi vt', 'don vi tai nguyen'] },
    { key: 'resourceType', label: 'Loại (VL/NC/M)', hints: ['loai', 'phan loai', 'nhom tai nguyen'] },
    { key: 'consumption', label: 'Hao phí (định mức)', required: true, hints: ['hao phi', 'dinh muc', 'luong hao phi', 'so luong'] },
    { key: 'price', label: 'Đơn giá tài nguyên', hints: ['don gia', 'gia'] },
  ],
  prices: [
    { key: 'resourceCode', label: 'Mã tài nguyên', required: true, hints: ['ma vat tu', 'ma tai nguyen', 'ma vt', 'ma hieu', 'ma'] },
    { key: 'resourceName', label: 'Tên tài nguyên', hints: ['ten vat tu', 'ten tai nguyen', 'ten', 'vat tu'] },
    { key: 'resourceUnit', label: 'Đơn vị', hints: ['don vi', 'dvt'] },
    { key: 'resourceType', label: 'Loại (VL/NC/M)', hints: ['loai', 'phan loai'] },
    { key: 'price', label: 'Giá', required: true, hints: ['gia thong bao', 'gia hien hanh', 'don gia', 'gia'] },
  ],
  items: [
    { key: 'categoryName', label: 'Hạng mục', hints: ['hang muc'] },
    { key: 'normCode', label: 'Mã hiệu', hints: ['ma hieu', 'ma dinh muc', 'ma'] },
    { key: 'name', label: 'Tên công tác', hints: ['ten cong tac', 'noi dung', 'ten'] },
    { key: 'unit', label: 'Đơn vị', hints: ['don vi', 'dvt'] },
    { key: 'quantityFormula', label: 'Diễn giải khối lượng', hints: ['dien giai', 'cong thuc'] },
    { key: 'quantity', label: 'Khối lượng', required: true, hints: ['khoi luong', 'kl', 'so luong'] },
  ],
};

const store = new Map<string, ParsedFile>();
const TTL = 60 * 60 * 1000;

function cellToValue(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = String(v).trim();
  return t === '' ? null : t;
}

/** Characters that only exist in real Unicode Vietnamese text (not in cp1252 legacy strings). */
const REAL_UNICODE = /[ăĂđĐơƠưƯẠ-ỹ]/;
const ERROR_RE = /^#(NAME\?|REF!|VALUE!|DIV\/0!|N\/A|NULL!|NUM!|SPILL!|CALC!)$/;

/**
 * Convert legacy-encoded (VNI / TCVN3) text cells to Unicode, keeping the raw text. The encoding is
 * decided PER COLUMN (a file may have names in VNI but units in TCVN3 or a Unicode header) and a cell
 * that clearly carries a legacy signature is converted even inside a Unicode column.
 */
function normaliseEncoding(sheet: ParsedSheet): ParsedSheet {
  const width = Math.max(0, ...sheet.rows.map((r) => r.length));
  const nonAscii = (c: unknown): c is string => typeof c === 'string' && /[^\x00-\x7F]/.test(c);
  sheet.raw = {};
  sheet.columnEncodings = {};
  const all: string[] = [];
  for (const r of sheet.rows) for (const c of r) if (nonAscii(c)) all.push(c);
  const sheetEnc = detectDominantEncoding(all).encoding;
  let legacyCells = 0;
  for (let c = 0; c < width; c++) {
    const texts = sheet.rows.map((r) => r[c]).filter(nonAscii);
    if (!texts.length) continue;
    const colEnc = detectDominantEncoding(texts).encoding;
    sheet.columnEncodings[c] = colEnc;
    sheet.rows.forEach((r, ri) => {
      const v = r[c];
      if (!nonAscii(v)) return;
      const cellEnc = detectEncoding(v);
      // Per cell (docs/update4/vni.py): text with a VNI tell is converted – a whole cell, or only the VNI tokens of a mixed
      // "Eùp coïc thử tĩnh Φ400" cell. Without a tell a VNI-column cell stays as is ("CÔNG TÁC BÊ TÔNG" is real Unicode).
      const tcvn = cellEnc === 'tcvn3' || (colEnc === 'tcvn3' && cellEnc !== 'unicode');
      let enc: TextEncoding | null = null;
      if (tcvn) enc = 'tcvn3';
      else if (hasVniMarkers(v)) enc = 'vni';
      else if (colEnc === 'tcvn3' && !REAL_UNICODE.test(v)) enc = 'tcvn3';
      if (!enc) return;
      const u = enc === 'vni' ? fixVniCell(v) : toUnicode(v, enc);
      if (u !== v) {
        sheet.raw![`${ri}:${c}`] = v;
        r[c] = u;
        legacyCells++;
      }
    });
  }
  sheet.encoding = legacyCells ? (Object.values(sheet.columnEncodings).includes('vni') ? 'vni' : 'tcvn3') : sheetEnc === 'vni' || sheetEnc === 'tcvn3' ? 'unicode' : sheetEnc;
  return sheet;
}

/**
 * Every cell of a merged range reads as the master cell's value (a description merged over two
 * columns, a header group over VL/NC/M). Wide banners (more than 3 columns: titles, category rows
 * merged across the sheet) are left alone so they don't fill the unit / quantity columns.
 */
function fillMerged(sheet: ParsedSheet): void {
  sheet.mergeFilled = {};
  for (const m of sheet.merges ?? []) {
    if (m.e.c - m.s.c > 2) continue;
    const v = sheet.rows[m.s.r]?.[m.s.c];
    if (v === null || v === undefined || v === '') continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue;
        const row = (sheet.rows[r] ??= []);
        if (row[c] === null || row[c] === undefined || row[c] === '') {
          row[c] = v;
          sheet.mergeFilled[`${r}:${c}`] = true;
        }
      }
    }
  }
}

const decodeXml = (t: string) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');

/**
 * Formulas straight from the worksheet XML. SheetJS drops a formula cell whose cached value is empty
 * (`<f>..</f><v></v>`, as written by libraries), so the formula would be lost without this scan.
 */
function sheetXml(wb: XLSX.WorkBook, sheetIndex: number): string {
  const files = (wb as unknown as { files?: Record<string, { content?: Buffer | string }> }).files ?? {};
  const text = (name: string) => {
    const c = files[name]?.content;
    return c === undefined ? '' : typeof c === 'string' ? c : Buffer.from(c).toString('utf8');
  };
  const rid = (wb.Workbook?.Sheets?.[sheetIndex] as unknown as { id?: string } | undefined)?.id;
  let target = `xl/worksheets/sheet${sheetIndex + 1}.xml`;
  if (rid) {
    const m = new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*>`).exec(text('xl/_rels/workbook.xml.rels'));
    const t = m && /Target="([^"]+)"/.exec(m[0]);
    if (t) target = t[1].startsWith('/') ? t[1].slice(1) : `xl/${t[1]}`;
  }
  return text(target);
}

/** Hidden columns (0-based) from the worksheet `<cols>` (SheetJS only exposes them with cellStyles). */
function xmlHiddenCols(wb: XLSX.WorkBook, sheetIndex: number): number[] {
  const out: number[] = [];
  for (const m of sheetXml(wb, sheetIndex).matchAll(/<col\s[^>]*>/g)) {
    if (!/\bhidden="(1|true)"/.test(m[0])) continue;
    const min = Number(/\bmin="(\d+)"/.exec(m[0])?.[1]);
    const max = Number(/\bmax="(\d+)"/.exec(m[0])?.[1] ?? min);
    for (let c = min; c <= Math.min(max, min + 200); c++) out.push(c - 1);
  }
  return out;
}

function xmlFormulas(wb: XLSX.WorkBook, sheetIndex: number): Record<string, string> {
  const out: Record<string, string> = {};
  const xml = sheetXml(wb, sheetIndex);
  const re = /<c\s+r="([A-Z]+)(\d+)"[^>]*?>(?:(?!<\/c>)[\s\S])*?<f(?:\s[^>]*)?>([^<]+)<\/f>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const { r, c } = XLSX.utils.decode_cell(`${m[1]}${m[2]}`);
    out[`${r}:${c}`] = decodeXml(m[3]);
  }
  return out;
}

/**
 * Formulas saved by a library carry no cached value (<v></v>): evaluate them from the sheet's own
 * numbers (+ − × ÷, parentheses, SUM over ranges, references in the same sheet). A formula that
 * cannot be evaluated is flagged and stays empty – it is never imported as 0.
 */
function resolveFormulas(sheet: ParsedSheet): void {
  const formulas = sheet.formulas ?? {};
  const cache = new Map<string, number | null>();
  const busy = new Set<string>();
  const valueAt = (r: number, c: number): number | null => {
    const key = `${r}:${c}`;
    if (cache.has(key)) return cache.get(key)!;
    const raw = sheet.rows[r]?.[c];
    let v: number | null;
    const empty = raw === null || raw === undefined || raw === '';
    if (typeof raw === 'number') v = raw;
    else if (!empty && typeof raw === 'string') v = parseFlexibleNumber(raw) ?? 0;
    else if (formulas[key] !== undefined) {
      if (busy.has(key)) return null; // circular reference
      busy.add(key);
      try {
        v = evaluateSheetFormula(formulas[key], valueAt);
      } catch {
        v = null;
      }
      busy.delete(key);
    } else v = 0; // empty cell counts as 0, like Excel
    cache.set(key, v);
    return v;
  };
  sheet.evaluated = {};
  for (const key of Object.keys(formulas)) {
    const [r, c] = key.split(':').map(Number);
    const raw = sheet.rows[r]?.[c];
    if (raw !== null && raw !== undefined && raw !== '') continue;
    const v = valueAt(r, c);
    if (v !== null && Number.isFinite(v)) {
      (sheet.rows[r] ??= [])[c] = v;
      sheet.evaluated[key] = formulas[key];
    } else {
      (sheet.rows[r] ??= [])[c] = null;
      (sheet.issues ??= []).push({ row: r, col: c, kind: 'formula_not_evaluated', value: `=${formulas[key]}`, flag: FLAG_FORMULA_NOT_EVALUATED });
    }
  }
}

/** Flag error values and formulas that reference other workbooks – never used silently. */
function scanIssues(sheet: ParsedSheet, ws?: XLSX.WorkSheet): void {
  const issues: CellIssue[] = [];
  sheet.rows.forEach((r, ri) =>
    r.forEach((c, ci) => {
      if (typeof c === 'string' && ERROR_RE.test(c.trim())) issues.push({ row: ri, col: ci, kind: 'broken_formula', value: c.trim(), flag: FLAG_BROKEN });
    }),
  );
  if (ws) {
    for (const addr of Object.keys(ws)) {
      if (addr.startsWith('!')) continue;
      const cell = ws[addr] as XLSX.CellObject;
      if (cell.f && /\[[^\]]+\]|\.xls[xmb]?\]?!|^'?[a-z]:\\/i.test(cell.f)) {
        const { r, c } = XLSX.utils.decode_cell(addr);
        issues.push({ row: r, col: c, kind: 'external_link', value: `=${cell.f}`, flag: FLAG_BROKEN });
      } else if (cell.f && /#REF!/.test(cell.f)) {
        const { r, c } = XLSX.utils.decode_cell(addr);
        if (!issues.some((x) => x.row === r && x.col === c)) issues.push({ row: r, col: c, kind: 'broken_formula', value: `=${cell.f}`, flag: FLAG_BROKEN });
      }
    }
  }
  sheet.issues = issues;
}

/**
 * Read .xlsx / .xlsm / .xls (SheetJS: cached formula values, merged ranges, error cells, external links)
 * and .csv / .txt (Papa Parse, values kept as text so Vietnamese number formats can be interpreted later).
 * Legacy VNI / TCVN3 text is converted to Unicode per sheet; the raw text is kept.
 */
export async function parseBuffer(buf: Buffer, fileName: string, fileIssues: string[] = []): Promise<ParsedSheet[]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const text = buf.toString('utf8').replace(/^\uFEFF/, '');
    const res = Papa.parse<string[]>(text, { skipEmptyLines: false });
    const rows = res.data.map((r) => r.map((c) => (c.trim() === '' ? null : c.trim())));
    while (rows.length && rows[rows.length - 1].every((c) => c === null)) rows.pop();
    const sheet: ParsedSheet = { name: 'CSV', rows, merges: [] };
    scanIssues(sheet);
    return [normaliseEncoding(sheet)];
  }
  if (!/\.(xlsx|xlsm|xls)$/.test(lower)) throw new HttpError(400, 'Chỉ hỗ trợ file .xlsx, .xlsm, .xls và .csv.');
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'buffer', cellDates: true, cellFormula: true, cellStyles: false, dense: false, bookFiles: true });
  } catch {
    throw new HttpError(400, 'Không đọc được file Excel (file hỏng hoặc có mật khẩu).');
  }
  const files = (wb as unknown as { keys?: string[] }).keys ?? [];
  if (files.some((k) => /externalLinks?\//i.test(k))) fileIssues.push('File có liên kết tới workbook khác (external links) – giá trị liên kết có thể đã cũ.');
  return wb.SheetNames.map((name, sheetIndex) => {
    const ws = wb.Sheets[name];
    const ref = ws['!ref'];
    const rows: CellValue[][] = [];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      for (let r = 0; r <= range.e.r; r++) {
        const row: CellValue[] = [];
        for (let c = 0; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
          if (!cell) row.push(null);
          else if (cell.t === 'e') row.push(cell.w ?? XLSX.SSF.format('General', cell.v as number) ?? '#ERR');
          else row.push(cellToValue(cell.v));
        }
        rows.push(row);
      }
    }
    const merges = (ws['!merges'] ?? []).map((m) => ({ s: { r: m.s.r, c: m.s.c }, e: { r: m.e.r, c: m.e.c } }));
    const sheet: ParsedSheet = { name, rows, merges, formulas: xmlFormulas(wb, sheetIndex) };
    if ((wb.Workbook?.Sheets?.[sheetIndex]?.Hidden ?? 0) > 0) sheet.hidden = true;
    sheet.hiddenCols = xmlHiddenCols(wb, sheetIndex);
    fillMerged(sheet);
    for (const addr of Object.keys(ws)) {
      if (addr.startsWith('!')) continue;
      const cell = ws[addr] as XLSX.CellObject;
      if (cell.f) {
        const { r, c } = XLSX.utils.decode_cell(addr);
        sheet.formulas![`${r}:${c}`] = cell.f;
      }
    }
    scanIssues(sheet, ws);
    resolveFormulas(sheet);
    return normaliseEncoding(sheet);
  });
}

export function storeParsed(userId: number, fileName: string, sheets: ParsedSheet[], extra: { sha256?: string; fileIssues?: string[] } = {}): ParsedFile {
  const now = Date.now();
  for (const [k, v] of store) if (now - v.createdAt > TTL) store.delete(k);
  const f: ParsedFile = { id: crypto.randomUUID(), fileName, userId, sheets, createdAt: now, ...extra };
  store.set(f.id, f);
  return f;
}

export function getParsed(id: string, userId: number): ParsedFile {
  const f = store.get(id);
  if (!f || f.userId !== userId) throw new HttpError(404, 'Phiên nhập dữ liệu đã hết hạn, vui lòng chọn lại file.');
  return f;
}

/** Guess the header row: the first row within the top 30 having the most text cells. */
export function guessHeaderRow(rows: CellValue[][]): number {
  let best = 0;
  let bestScore = -1;
  rows.slice(0, 30).forEach((r, i) => {
    const score = r.filter((c) => typeof c === 'string' && c.length > 1 && isNaN(Number(c))).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

export function guessMapping(headers: CellValue[], target: ImportTarget): Record<string, number> {
  const norm = headers.map((h) => (h === null ? '' : normalizeText(String(h))));
  const used = new Set<number>();
  const mapping: Record<string, number> = {};
  for (const f of IMPORT_FIELDS[target]) {
    for (const hint of f.hints) {
      const idx = norm.findIndex((h, i) => !used.has(i) && h && (h === hint || h.startsWith(hint)));
      if (idx >= 0) {
        mapping[f.key] = idx;
        used.add(idx);
        break;
      }
    }
  }
  return mapping;
}

export function previewOf(f: ParsedFile, sheetIndex = 0, target: ImportTarget = 'norms') {
  const sheet = f.sheets[sheetIndex] ?? f.sheets[0];
  const headerRow = guessHeaderRow(sheet?.rows ?? []);
  const headers = sheet?.rows[headerRow] ?? [];
  return {
    fileId: f.id,
    fileName: f.fileName,
    sheets: f.sheets.map((s) => ({ name: s.name, rowCount: s.rows.length })),
    sheetIndex,
    headerRow,
    headers,
    rows: sheet?.rows.slice(headerRow + 1, headerRow + 21) ?? [],
    mapping: guessMapping(headers, target),
    fields: IMPORT_FIELDS,
  };
}

function str(v: CellValue | undefined): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

function num(v: CellValue | undefined): number | null {
  if (typeof v === 'number') return v;
  const s = str(v);
  if (!s) return null;
  return parseVnNumber(s) ?? (Number.isFinite(Number(s)) ? Number(s) : null);
}

export function parseResourceType(raw: string, code: string, name: string): ResourceType {
  const t = normalizeText(raw);
  if (/^(nc|nhan cong)/.test(t)) return 'NC';
  if (/^(m|may|mtc|may thi cong)$|^may/.test(t)) return 'M';
  if (/^(vl|vat lieu|vat tu)/.test(t)) return 'VL';
  const n = normalizeText(name);
  if (/^nhan cong/.test(n)) return 'NC';
  if (/^(may|o to|can cau|xe |van thang|tau|sa lan)/.test(n)) return 'M';
  const c = code.toUpperCase();
  if (/^N[.\d]/.test(c)) return 'NC';
  if (/^M[.\d]/.test(c)) return 'M';
  return 'VL';
}

export interface ApplyOptions {
  fileId: string;
  sheetIndex: number;
  headerRow: number;
  target: ImportTarget;
  mapping: Record<string, number>;
  projectId?: number;
  categoryId?: number;
  /** For prices: update library base prices or project prices. */
  priceScope?: 'base' | 'project';
  /** For norms: dataset (norm book version) to import into. */
  dataset?: string;
}

export function applyImport(repo: Repo, f: ParsedFile, o: ApplyOptions): { message: string; count: number; skipped: number } {
  const sheet = f.sheets[o.sheetIndex];
  if (!sheet) throw new HttpError(400, 'Sheet không tồn tại');
  const missing = IMPORT_FIELDS[o.target].filter((x) => x.required && o.mapping[x.key] === undefined);
  if (missing.length) throw new HttpError(400, `Chưa chọn cột cho: ${missing.map((m) => m.label).join(', ')}`);
  const rows = sheet.rows.slice(o.headerRow + 1);
  const get = (r: CellValue[], key: string) => (o.mapping[key] === undefined || o.mapping[key] < 0 ? undefined : r[o.mapping[key]]);
  const db = repo.db;
  let count = 0;
  let skipped = 0;

  if (o.target === 'norms') {
    const dataset = o.dataset ?? 'TT38_2026';
    const upsertNorm = db.prepare(
      `INSERT INTO norms (dataset, code, name, unit, grp, name_search, is_sample) VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(dataset, code) DO UPDATE SET name = excluded.name, unit = excluded.unit, grp = excluded.grp,
       name_search = excluded.name_search, is_sample = 0`,
    );
    const clearNR = db.prepare('DELETE FROM norm_resources WHERE dataset = ? AND norm_code = ?');
    const insNR = db.prepare(
      `INSERT INTO norm_resources (dataset, norm_code, resource_code, consumption, is_sample) VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(dataset, norm_code, resource_code) DO UPDATE SET consumption = excluded.consumption, is_sample = 0`,
    );
    const norms = new Set<string>();
    db.transaction(() => {
      let current: string | null = null;
      for (const r of rows) {
        const code = str(get(r, 'normCode')).toUpperCase();
        if (code) {
          current = code;
          if (!norms.has(code)) {
            const existing = repo.getNorm(code, dataset);
            const name = str(get(r, 'normName')) || existing?.name || code;
            const unit = str(get(r, 'normUnit')) || existing?.unit || '';
            upsertNorm.run(dataset, code, name, unit, str(get(r, 'group')), normalizeText(`${code} ${name}`));
            clearNR.run(dataset, code);
            norms.add(code);
          }
        }
        const rc = str(get(r, 'resourceCode')).toUpperCase();
        const cons = num(get(r, 'consumption'));
        if (!current || !rc || cons === null) {
          if (rc || cons !== null) skipped++;
          continue;
        }
        const existing = repo.getResource(rc);
        const rname = str(get(r, 'resourceName')) || existing?.name || rc;
        const price = num(get(r, 'price'));
        repo.upsertResource({
          code: rc,
          name: rname,
          unit: str(get(r, 'resourceUnit')) || existing?.unit || '',
          type: o.mapping.resourceType !== undefined ? parseResourceType(str(get(r, 'resourceType')), rc, rname) : existing?.type ?? parseResourceType('', rc, rname),
          basePrice: price ?? existing?.basePrice ?? 0,
        });
        insNR.run(dataset, current, rc, cons);
        count++;
      }
    })();
    repo.invalidateNormIndex();
    return { message: `Đã nhập vào bộ ${dataset}: ${norms.size} định mức với ${count} dòng hao phí${skipped ? `, bỏ qua ${skipped} dòng thiếu dữ liệu` : ''}.`, count, skipped };
  }

  if (o.target === 'prices') {
    const scope = o.priceScope ?? (o.projectId ? 'project' : 'base');
    db.transaction(() => {
      for (const r of rows) {
        const code = str(get(r, 'resourceCode')).toUpperCase();
        const price = num(get(r, 'price'));
        if (!code || price === null) {
          if (code || price !== null) skipped++;
          continue;
        }
        const existing = repo.getResource(code);
        if (scope === 'project') {
          if (!existing) {
            const name = str(get(r, 'resourceName'));
            if (!name) {
              skipped++;
              continue;
            }
            repo.upsertResource({ code, name, unit: str(get(r, 'resourceUnit')), type: parseResourceType(str(get(r, 'resourceType')), code, name), basePrice: price });
          }
          repo.setProjectPrice(o.projectId!, code, price);
        } else {
          const name = str(get(r, 'resourceName')) || existing?.name || code;
          repo.upsertResource({
            code,
            name,
            unit: str(get(r, 'resourceUnit')) || existing?.unit || '',
            type: existing?.type ?? parseResourceType(str(get(r, 'resourceType')), code, name),
            basePrice: price,
          });
        }
        count++;
      }
    })();
    return {
      message: `Đã cập nhật ${count} giá ${scope === 'project' ? 'cho công trình' : 'gốc trong thư viện'}${skipped ? `, bỏ qua ${skipped} dòng` : ''}.`,
      count,
      skipped,
    };
  }

  // items
  if (!o.projectId) throw new HttpError(400, 'Chưa chọn công trình');
  const cats = new Map(repo.listCategories(o.projectId).map((c) => [normalizeText(c.name), c.id]));
  db.transaction(() => {
    for (const r of rows) {
      const code = str(get(r, 'normCode')).toUpperCase();
      const name = str(get(r, 'name'));
      const formula = str(get(r, 'quantityFormula'));
      let quantity = num(get(r, 'quantity'));
      if (quantity === null && formula && isFormula(formula)) {
        try {
          quantity = evaluateFormula(formula);
        } catch {
          /* keep null */
        }
      }
      if (!code && !name) continue;
      let categoryId = o.categoryId;
      const catName = str(get(r, 'categoryName'));
      if (catName) {
        const key = normalizeText(catName);
        categoryId = cats.get(key) ?? repo.createCategory(o.projectId!, catName).id;
        cats.set(key, categoryId);
      }
      if (!categoryId) {
        const first = cats.values().next().value ?? repo.createCategory(o.projectId!, 'Hạng mục chung').id;
        categoryId = first;
        cats.set(normalizeText('Hạng mục chung'), first);
      }
      repo.createItem(o.projectId!, {
        categoryId,
        normCode: code,
        name: name || undefined,
        unit: str(get(r, 'unit')) || undefined,
        quantity: quantity ?? 0,
        quantityFormula: formula && isFormula(formula) ? formula : null,
      });
      count++;
    }
  })();
  return { message: `Đã nhập ${count} công tác vào dự toán.`, count, skipped };
}

/** Parse an uploaded buffer and keep it in the short-lived store with its SHA-256. */
export async function parseAndStore(userId: number, fileName: string, buf: Buffer): Promise<ParsedFile> {
  const fileIssues: string[] = [];
  const sheets = await parseBuffer(buf, fileName, fileIssues);
  return storeParsed(userId, fileName, sheets, { sha256: crypto.createHash('sha256').update(buf).digest('hex'), fileIssues });
}

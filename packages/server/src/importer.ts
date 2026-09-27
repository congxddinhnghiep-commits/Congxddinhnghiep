import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { evaluateFormula, isFormula, normalizeText, parseVnNumber, type ResourceType } from '@dutoan/core';
import { HttpError, type Repo } from './repo.js';

export type CellValue = string | number | null;
export interface ParsedSheet {
  name: string;
  rows: CellValue[][];
}
export interface ParsedFile {
  id: string;
  fileName: string;
  userId: number;
  sheets: ParsedSheet[];
  createdAt: number;
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

function cellToValue(v: ExcelJS.CellValue): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellToValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('').trim() || null;
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text).trim() || null;
  }
  return String(v);
}

export async function parseBuffer(buf: Buffer, fileName: string): Promise<ParsedSheet[]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const text = buf.toString('utf8').replace(/^﻿/, '');
    const res = Papa.parse<string[]>(text, { skipEmptyLines: true });
    const rows = res.data.map((r) => r.map((c) => (c.trim() === '' ? null : c.trim())));
    return [{ name: 'CSV', rows }];
  }
  if (lower.endsWith('.xls')) {
    throw new HttpError(400, 'Định dạng .xls cũ chưa được hỗ trợ. Vui lòng mở bằng Excel và lưu lại thành .xlsx.');
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  } catch {
    throw new HttpError(400, 'Không đọc được file. Chỉ hỗ trợ .xlsx và .csv.');
  }
  const sheets: ParsedSheet[] = [];
  wb.eachSheet((ws) => {
    const rows: CellValue[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const values = (row.values as ExcelJS.CellValue[]).slice(1).map(cellToValue);
      rows[n - 1] = values;
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    sheets.push({ name: ws.name, rows });
  });
  return sheets;
}

export function storeParsed(userId: number, fileName: string, sheets: ParsedSheet[]): ParsedFile {
  const now = Date.now();
  for (const [k, v] of store) if (now - v.createdAt > TTL) store.delete(k);
  const f: ParsedFile = { id: crypto.randomUUID(), fileName, userId, sheets, createdAt: now };
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

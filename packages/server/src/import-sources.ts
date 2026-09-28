import crypto from 'node:crypto';
import type { DB } from './db.js';
import { storeParsed, type ParsedFile, type ParsedSheet } from './importer.js';
import { HttpError } from './repo.js';

interface SourceRow {
  id: number;
  project_id: number;
  file_name: string;
  sheet_name: string;
  sha256: string | null;
  sheet_json: string;
  header_json: string;
  mapping_json: string;
  options_json: string;
  created_by: string;
  created_at: string;
}

export interface StoredImportOptions {
  firstRow?: number;
  lastRow?: number;
  rowTypes?: Record<string, string>;
  pricingOption?: 'file' | 'norm';
  allowNumericName?: boolean;
}

/** Keep the parsed sheet (values after formula evaluation / encoding conversion, raw text, merges) of an import. */
export function saveImportSource(
  db: DB,
  a: { projectId: number; f: ParsedFile; sheetIndex: number; header: { headerRow: number; headerRows: number }; mapping: Record<string, number>; options: StoredImportOptions; user: string },
): number {
  const sheet = a.f.sheets[a.sheetIndex];
  const info = db
    .prepare(
      `INSERT INTO import_sources (project_id, file_name, sheet_name, sha256, sheet_json, header_json, mapping_json, options_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(a.projectId, a.f.fileName, sheet.name, a.f.sha256 ?? null, JSON.stringify(sheet), JSON.stringify(a.header), JSON.stringify(a.mapping), JSON.stringify(a.options), a.user);
  return Number(info.lastInsertRowid);
}

export function getImportSource(db: DB, projectId: number, id: number): SourceRow {
  const r = db.prepare('SELECT * FROM import_sources WHERE id = ? AND project_id = ?').get(id, projectId) as SourceRow | undefined;
  if (!r) throw new HttpError(404, 'Không tìm thấy dữ liệu nguồn của lần nhập này');
  return r;
}

/** What the "Sửa lại cột đã nhập" button of a category can do. */
export function importInfoForCategory(db: DB, projectId: number, categoryId: number) {
  const cat = db.prepare('SELECT id FROM categories WHERE id = ? AND project_id = ?').get(categoryId, projectId);
  if (!cat) throw new HttpError(404, 'Không tìm thấy hạng mục');
  const rows = db
    .prepare('SELECT import_id, source_file, source_sheet, COUNT(*) AS n FROM estimate_items WHERE category_id = ? AND source_file IS NOT NULL GROUP BY import_id, source_file, source_sheet')
    .all(categoryId) as { import_id: number | null; source_file: string; source_sheet: string | null; n: number }[];
  if (!rows.length) return { imported: false as const };
  const withRaw = rows.find((r) => r.import_id !== null);
  if (withRaw) {
    const src = getImportSource(db, projectId, withRaw.import_id!);
    const importItems = (db.prepare('SELECT COUNT(*) AS n FROM estimate_items WHERE import_id = ?').get(withRaw.import_id) as { n: number }).n;
    return { imported: true as const, hasRaw: true as const, importId: src.id, fileName: src.file_name, sheetName: src.sheet_name, createdAt: src.created_at, itemCount: importItems };
  }
  return { imported: true as const, hasRaw: false as const, importId: null, fileName: rows[0].source_file, sheetName: rows[0].source_sheet, itemCount: rows.reduce((a, r) => a + r.n, 0) };
}

/** Rebuild the stored sheet as a parsed file (in the short-lived store) so it can be analysed again. */
export function reopenImport(db: DB, projectId: number, importId: number, userId: number) {
  const src = getImportSource(db, projectId, importId);
  const sheet = JSON.parse(src.sheet_json) as ParsedSheet;
  const f = storeParsed(userId, src.file_name, [sheet], { sha256: src.sha256 ?? crypto.createHash('sha256').update(src.sheet_json).digest('hex') });
  return {
    file: f,
    header: JSON.parse(src.header_json) as { headerRow: number; headerRows: 1 | 2 },
    mapping: JSON.parse(src.mapping_json) as Record<string, number>,
    options: JSON.parse(src.options_json) as StoredImportOptions,
  };
}

type Row = Record<string, unknown>;

export interface ReimportSnapshot {
  kind: 'reimport';
  oldItems: Row[];
  oldCategories: Row[];
  oldQuantityLines: Row[];
  oldSource: Row | null;
  newItemIds: number[];
  newCategoryIds: number[];
  newImportId: number | null;
}

const insertRow = (db: DB, table: string, row: Row) => {
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c] as never));
};

/** Items (and the categories they leave empty) that a re-import replaces, captured for undo, then removed. */
export function removeForReplace(db: DB, projectId: number, o: { importId?: number; categoryIds?: number[] }): { snapshot: Omit<ReimportSnapshot, 'newItemIds' | 'newCategoryIds' | 'newImportId'>; removed: number } {
  const itemIds = new Set<number>();
  if (o.importId) {
    getImportSource(db, projectId, o.importId);
    for (const r of db.prepare('SELECT i.id FROM estimate_items i JOIN categories c ON c.id = i.category_id WHERE i.import_id = ? AND c.project_id = ?').all(o.importId, projectId) as { id: number }[]) itemIds.add(r.id);
  }
  for (const cid of o.categoryIds ?? []) {
    if (!db.prepare('SELECT 1 FROM categories WHERE id = ? AND project_id = ?').get(cid, projectId)) throw new HttpError(404, 'Không tìm thấy hạng mục cần thay thế');
    for (const r of db.prepare('SELECT id FROM estimate_items WHERE category_id = ?').all(cid) as { id: number }[]) itemIds.add(r.id);
  }
  const ids = [...itemIds];
  const marks = ids.map(() => '?').join(',');
  const oldItems = ids.length ? (db.prepare(`SELECT * FROM estimate_items WHERE id IN (${marks})`).all(...ids) as Row[]) : [];
  const oldQuantityLines = ids.length ? (db.prepare(`SELECT * FROM quantity_lines WHERE item_id IN (${marks})`).all(...ids) as Row[]) : [];
  const catIds = [...new Set(oldItems.map((i) => i.category_id as number))];
  const oldCategories: Row[] = [];
  for (const cid of catIds) {
    const left = (db.prepare(`SELECT COUNT(*) AS n FROM estimate_items WHERE category_id = ? AND id NOT IN (${marks || '0'})`).get(cid, ...ids) as { n: number }).n;
    if (left === 0) oldCategories.push(db.prepare('SELECT * FROM categories WHERE id = ?').get(cid) as Row);
  }
  const oldSource = o.importId ? (db.prepare('SELECT * FROM import_sources WHERE id = ?').get(o.importId) as Row) : null;
  if (ids.length) db.prepare(`DELETE FROM estimate_items WHERE id IN (${marks})`).run(...ids);
  for (const c of oldCategories) db.prepare('DELETE FROM categories WHERE id = ?').run(c.id as never);
  if (o.importId) db.prepare('DELETE FROM import_sources WHERE id = ?').run(o.importId);
  return { snapshot: { kind: 'reimport', oldItems, oldCategories, oldQuantityLines, oldSource }, removed: ids.length };
}

/** Undo a re-import: drop what it created and put back the replaced categories, items, quantity lines and source. */
export function restoreReplaced(db: DB, snap: ReimportSnapshot): void {
  for (const id of snap.newItemIds) db.prepare('DELETE FROM estimate_items WHERE id = ?').run(id);
  for (const id of snap.newCategoryIds) db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  if (snap.newImportId) db.prepare('DELETE FROM import_sources WHERE id = ?').run(snap.newImportId);
  if (snap.oldSource) insertRow(db, 'import_sources', snap.oldSource);
  for (const c of snap.oldCategories) insertRow(db, 'categories', c);
  for (const i of snap.oldItems) insertRow(db, 'estimate_items', i);
  for (const q of snap.oldQuantityLines) insertRow(db, 'quantity_lines', q);
}

import { detectBlocks, IMPORT_FIELD_LABELS, normalizeText, parseFlexibleNumber, splitChinese, type Cell, type ImportField } from '@dutoan/core';
import type { UndoOp } from './actions.js';
import type { DB } from './db.js';
import { analyze, colLetter, importEstimate, sheetLabel } from './estimate-import.js';
import type { ParsedFile, ParsedSheet } from './importer.js';
import { HttpError, type Repo } from './repo.js';

/**
 * Multi-sheet import (Update 4 A-bis): tick several sheets of a workbook, each block (table) of a sheet becomes a hạng mục,
 * and the "TONGHOP" summary sheet is only used to reconcile the totals.
 */

export interface SummaryLine {
  row: number;
  stt: string;
  label: string;
  amount: number | null;
  kind: 'line' | 'total' | 'tax';
}
export interface SummarySheet {
  sheetIndex: number;
  sheetName: string;
  lines: SummaryLine[];
  total: SummaryLine | null;
}

const SUMMARY_NAME = /(^|\s)(tonghop|tong hop|bangtonghop)|^th$|^th[\s\-_]|汇总|综合/;
const TOTAL_RE = /^(tong (truoc thue|cong|gia tri|tien|du toan|hop)|cong truoc thue|tong cong)/;
const TAX_RE = /(chi phi|thue|vat|du phong|quan ly|lai|bao hiem|thu nhap)/;

export function isSummarySheet(sheet: ParsedSheet): boolean {
  return SUMMARY_NAME.test(normalizeText(sheet.name));
}

const text = (v: Cell | undefined) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());

/** Read the lines of a summary sheet ("HẠNG MỤC | THÀNH TIỀN"): per-hạng-mục amounts and the "TỔNG TRƯỚC THUẾ" line. */
export function parseSummarySheet(sheet: ParsedSheet, sheetIndex: number): SummarySheet {
  const rows = sheet.rows;
  const width = Math.max(0, ...rows.map((r) => r.length));
  let header = -1;
  let nameCol = -1;
  let amountCol = -1;
  let sttCol = -1;
  for (let r = 0; r < Math.min(rows.length, 40) && header < 0; r++) {
    const labels = (rows[r] ?? []).map((c) => normalizeText(text(c as Cell)));
    const n = labels.findIndex((l) => /hang muc|noi dung|ten cong trinh|項目|项目/.test(l));
    const a = labels.findIndex((l) => /thanh tien|合计|金额/.test(l));
    const a2 = a >= 0 ? a : labels.findIndex((l) => /gia tri|tong cong/.test(l));
    if (n >= 0 && a2 >= 0) {
      header = r;
      nameCol = n;
      amountCol = a2;
      sttCol = labels.findIndex((l) => l === 'stt' || l.startsWith('stt '));
    }
  }
  if (header < 0) {
    // no recognisable header: name = the column with the most text, amount = the right-most numeric column
    header = -1;
    let bestText = 0;
    for (let c = 0; c < width; c++) {
      const t = rows.filter((r) => typeof r[c] === 'string' && text(r[c] as Cell).length > 2).length;
      if (t > bestText) (bestText = t), (nameCol = c);
      if (rows.some((r) => typeof r[c] === 'number')) amountCol = c;
    }
  }
  const lines: SummaryLine[] = [];
  let total: SummaryLine | null = null;
  for (let r = header + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const label = splitChinese(text(row[nameCol] as Cell)).vi;
    const amount = parseFlexibleNumber((row[amountCol] as Cell) ?? null);
    if (!label && amount === null) continue;
    const norm = normalizeText(label);
    const kind: SummaryLine['kind'] = TOTAL_RE.test(norm) ? 'total' : TAX_RE.test(norm) ? 'tax' : 'line';
    const line: SummaryLine = { row: r + 1, stt: sttCol >= 0 ? text(row[sttCol] as Cell) : '', label, amount, kind };
    if (kind === 'total' && !total && amount !== null) total = line;
    lines.push(line);
  }
  return { sheetIndex, sheetName: sheet.name, lines, total };
}

const tokens = (s: string) => normalizeText(s).split(/[^a-z0-9]+/).filter((t) => t.length > 1);
function overlap(a: string, b: string): number {
  const ta = tokens(a);
  const tb = new Set(tokens(b));
  if (!ta.length || !tb.size) return 0;
  return ta.filter((t) => tb.has(t)).length / Math.min(ta.length, tb.size);
}

export interface BlockPlan {
  key: string;
  sheetIndex: number;
  sheetName: string;
  blockIndex: number;
  blockCount: number;
  title: string;
  /** Name given to the hạng mục created for this block. */
  prefix: string;
  headerRow: number;
  first: number;
  last: number;
  mep: boolean;
  mapping: { field: ImportField; label: string; letter: string; header: string }[];
  items: number;
  details: number;
  categories: string[];
  unpriced: number;
  missingUnit: number;
  tbvt: number;
  fileTotal: number | null;
  computedTotal: number;
  /** Amount used to reconcile with the summary sheet: the block's own total row, else the computed sum. */
  total: number;
  diff: number | null;
  ok: boolean | null;
  warnings: string[];
  blocking: string | null;
  preview: unknown[];
}

export interface MultiOptions {
  projectId?: number;
  sheetIndexes?: number[];
  pricingOption?: 'file' | 'norm';
  equipmentAsQuote?: boolean;
  /** Update 4 fidelity: 'file' (default) keeps a row's own Thành tiền when it disagrees with KL×đơn giá; 'calc' recomputes. */
  amountFidelity?: 'file' | 'calc';
  amountModeOverrides?: Record<string, 'file' | 'calc'>;
}

export function sheetOverview(f: ParsedFile) {
  return f.sheets.map((s, index) => {
    const blocks = detectBlocks(s.rows, s.merges);
    const summary = isSummarySheet(s);
    const { zh } = splitChinese(s.name);
    const defaultPackageName = blocks[0]?.title || sheetLabel(s.name);
    return {
      index,
      name: s.name,
      label: sheetLabel(s.name),
      hidden: !!s.hidden,
      rowCount: s.rows.length,
      blocks: summary ? 0 : blocks.length,
      summary,
      importable: !summary && blocks.length > 0,
      defaultPackageName,
      defaultPackageNameZh: zh || null,
    };
  });
}

/** Analyse every block of the selected sheets with the automatic mapping, and reconcile with the summary sheet. */
export function analyzeSheets(db: DB, repo: Repo, f: ParsedFile, o: MultiOptions) {
  const overview = sheetOverview(f);
  const selected = o.sheetIndexes ?? overview.filter((s) => !s.hidden && s.importable).map((s) => s.index);
  for (const i of selected) if (!overview[i]) throw new HttpError(400, `Sheet ${i} không tồn tại`);
  const plans: BlockPlan[] = [];
  const skipped: { sheetIndex: number; sheetName: string; blockIndex: number; reason: string }[] = [];
  const used = new Set<string>();
  for (const idx of selected) {
    const sheet = overview[idx];
    if (!sheet.importable) continue;
    for (let b = 0; b < sheet.blocks; b++) {
      const a = analyze(db, repo, f, { sheetIndex: idx, blockIndex: b, projectId: o.projectId, pricingOption: o.pricingOption ?? 'file', equipmentAsQuote: o.equipmentAsQuote, amountFidelity: o.amountFidelity, amountModeOverrides: o.amountModeOverrides });
      if (!a.header) continue;
      const blk = a.blocks[b];
      let prefix = blk?.title || (sheet.blocks > 1 ? `${sheet.label} – khối ${b + 1}` : sheet.label);
      if (used.has(normalizeText(prefix))) prefix = `${prefix} (${sheet.label})`;
      for (let n = 2; used.has(normalizeText(prefix)); n++) prefix = `${prefix.replace(/ \(\d+\)$/, '')} (${n})`;
      used.add(normalizeText(prefix));
      const rows = a.rows;
      const items = rows.filter((r) => r.type === 'item');
      if (!items.length) {
        skipped.push({ sheetIndex: idx, sheetName: sheet.name, blockIndex: b, reason: 'Bảng không có công việc nào (tiêu đề trùng với dòng ghi chú/thông tin)' });
        continue;
      }
      const grand = a.reconciliation?.grand;
      const computed = grand?.computed ?? 0;
      const fileTotal = grand?.fileAmount ?? null;
      const m = a.header.mapping as Partial<Record<ImportField, number>>;
      plans.push({
        key: `${idx}:${b}`,
        sheetIndex: idx,
        sheetName: sheet.name,
        blockIndex: b,
        blockCount: sheet.blocks,
        title: blk?.title ?? '',
        prefix,
        headerRow: a.header.headerRow + 1,
        first: a.range.first,
        last: a.range.last,
        mep: a.mep,
        mapping: (Object.entries(m) as [ImportField, number][]).map(([field, col]) => ({ field, label: IMPORT_FIELD_LABELS[field], letter: colLetter(col), header: a.header!.labels[col] ?? '' })),
        items: items.length,
        details: rows.filter((r) => r.type === 'detail').length,
        categories: rows.filter((r) => r.type === 'category').map((r) => r.category ?? r.name),
        unpriced: items.filter((r) => !((r.appliedAmount ?? r.computedAmount) && (r.appliedAmount ?? r.computedAmount)! > 0)).length,
        missingUnit: items.filter((r) => !r.unit).length,
        tbvt: items.filter((r) => r.tbvt).length,
        fileTotal,
        computedTotal: computed,
        total: fileTotal ?? computed,
        diff: grand?.diff ?? null,
        ok: grand?.ok ?? null,
        warnings: [...new Set([...a.warnings, ...items.flatMap((r) => r.warnings)])].slice(0, 12),
        blocking: a.columnWarnings.find((w) => w.blocking)?.message ?? null,
        preview: a.gridPreview,
      });
    }
  }

  // summary sheet (TONGHOP): reconcile its per-hạng-mục lines and its "TỔNG TRƯỚC THUẾ" with the analysed blocks
  const summarySheet = overview.find((s) => s.summary);
  let summary: (SummarySheet & { matches: { line: SummaryLine; matched: { kind: 'block' | 'sheet'; label: string; amount: number } | null; ok: boolean | null }[]; totalCheck: { file: number; computed: number; diff: number; ok: boolean } | null }) | null = null;
  if (summarySheet) {
    const ps = parseSummarySheet(f.sheets[summarySheet.index], summarySheet.index);
    const candidates: { kind: 'block' | 'sheet'; label: string; amount: number }[] = plans.map((p) => ({ kind: 'block', label: `${p.sheetName} ${p.title}`, amount: p.total }));
    for (const s of overview) {
      const mine = plans.filter((p) => p.sheetIndex === s.index);
      if (mine.length > 1) candidates.push({ kind: 'sheet', label: s.name, amount: mine.reduce((a, p) => a + p.total, 0) });
    }
    const matches = ps.lines
      .filter((l) => l.kind === 'line' && l.amount !== null)
      .map((line) => {
        const byAmount = candidates.filter((c) => Math.abs(c.amount - line.amount!) <= 1);
        const pool = byAmount.length ? byAmount : candidates.filter((c) => overlap(line.label, c.label) >= 0.6);
        const best = [...pool].sort((a, b) => overlap(line.label, b.label) - overlap(line.label, a.label))[0] ?? null;
        return { line, matched: best, ok: best ? Math.abs(best.amount - line.amount!) <= 1 : null };
      });
    const sum = plans.reduce((a, p) => a + p.total, 0);
    const totalCheck = ps.total && ps.total.amount !== null ? { file: ps.total.amount, computed: sum, diff: sum - ps.total.amount, ok: Math.abs(sum - ps.total.amount) <= 1 } : null;
    summary = { ...ps, matches, totalCheck };
  }
  return {
    fileId: f.id,
    fileName: f.fileName,
    sheets: overview,
    selected,
    blocks: plans,
    skipped,
    summary,
    grand: { computed: plans.reduce((a, p) => a + p.computedTotal, 0), total: plans.reduce((a, p) => a + p.total, 0) },
    allOk: plans.every((p) => p.ok !== false) && (summary?.totalCheck?.ok ?? true) && (summary?.matches.every((m) => m.ok !== false) ?? true),
  };
}

/** Update 6 B: where a sheet's blocks go. 'new' creates one hạng mục công trình (editable name); 'replace'/'add' target
 * an existing one. `splitBlocks` makes every block of the sheet its own package instead of one package per sheet. */
export interface SheetTarget {
  sheetIndex: number;
  mode: 'new' | 'replace' | 'add';
  name?: string;
  nameZh?: string | null;
  workPackageId?: number;
  splitBlocks?: boolean;
}

export interface ImportSheetsOptions extends MultiOptions {
  /** Keep the summary sheet's lines with the project (reconciliation only, no items are created from it). */
  saveSummary?: boolean;
  /** Per-sheet destination (Update 6 B); sheets without an explicit entry default to {mode:'new'} with the sheet's own name. */
  targets?: SheetTarget[];
}

/**
 * Import every block of the selected sheets, atomically (one undo step). Update 6 B: a sheet → exactly one hạng mục
 * công trình (work package) by default – its blocks become Phần (categories) inside that package – unless the sheet's
 * target asks to split every block into its own package, or to replace/add to an existing package.
 */
export function importSheets(db: DB, repo: Repo, f: ParsedFile, projectId: number, o: ImportSheetsOptions, user: string) {
  const plan = analyzeSheets(db, repo, f, { ...o, projectId });
  if (!plan.blocks.length) throw new HttpError(400, 'Không có sheet nào có bảng dự toán để nhập (cần cột Tên công việc và Khối lượng).');
  const blocking = plan.blocks.find((b) => b.blocking);
  if (blocking) throw new HttpError(400, `Sheet «${blocking.sheetName}» (khối ${blocking.blockIndex + 1}): ${blocking.blocking}. Hãy chỉnh cột cho sheet này trước khi nhập.`);
  let undo: UndoOp[] = [];
  const results: { sheetName: string; title: string; prefix: string; created: number; categories: number; importId: number; workPackageId: number }[] = [];
  const itemIds: number[] = [];
  let created = 0;
  let categories = 0;
  let withCode = 0;
  const bySheet = new Map<number, BlockPlan[]>();
  for (const p of plan.blocks) bySheet.set(p.sheetIndex, [...(bySheet.get(p.sheetIndex) ?? []), p]);
  const overview = sheetOverview(f);
  const pricingOption = o.pricingOption ?? 'file';
  db.transaction(() => {
    for (const [sheetIndex, blocks] of bySheet) {
      const sheet = overview[sheetIndex];
      const target: SheetTarget = o.targets?.find((t) => t.sheetIndex === sheetIndex) ?? { sheetIndex, mode: 'new' };
      if ((target.mode === 'replace' || target.mode === 'add') && target.workPackageId) repo.getWorkPackage(projectId, target.workPackageId);
      const makeNewPackage = (name: string, nameZh: string | null) => {
        const wp = repo.createWorkPackage(projectId, {
          name,
          nameZh,
          mode: pricingOption === 'file' ? 'bao_gia' : 'du_toan_tt36',
          sourceFile: f.fileName,
          sourceSheet: sheet.name,
        });
        undo.push({ op: 'deleteWorkPackage', workPackageId: wp.id });
        return wp.id;
      };
      if (target.splitBlocks && target.mode !== 'replace') {
        // every block of this sheet becomes its own package
        for (const p of blocks) {
          const wpId = target.mode === 'add' && target.workPackageId ? target.workPackageId : makeNewPackage(p.prefix || sheet.defaultPackageName, sheet.defaultPackageNameZh);
          const r = importEstimate(db, repo, f, projectId, { sheetIndex: p.sheetIndex, blockIndex: p.blockIndex, pricingOption, equipmentAsQuote: o.equipmentAsQuote, categoryPrefix: '', amountFidelity: o.amountFidelity, amountModeOverrides: o.amountModeOverrides, workPackageId: wpId }, user);
          undo = [...r.undo, ...undo];
          results.push({ sheetName: p.sheetName, title: p.title, prefix: p.prefix, created: r.created, categories: r.categories, importId: r.importId, workPackageId: wpId });
          itemIds.push(...r.itemIds);
          created += r.created;
          categories += r.categories;
          withCode += r.withCode;
        }
        continue;
      }
      let workPackageId: number;
      if (target.mode === 'replace' && target.workPackageId) {
        workPackageId = target.workPackageId;
      } else if (target.mode === 'add' && target.workPackageId) {
        workPackageId = target.workPackageId;
      } else {
        workPackageId = makeNewPackage(target.name?.trim() || sheet.defaultPackageName, target.nameZh !== undefined ? target.nameZh : sheet.defaultPackageNameZh);
      }
      let first = target.mode === 'replace';
      for (const p of blocks) {
        const replaceCategoryIds = first ? repo.listCategories(projectId, workPackageId).map((c) => c.id) : undefined;
        first = false;
        const r = importEstimate(
          db,
          repo,
          f,
          projectId,
          { sheetIndex: p.sheetIndex, blockIndex: p.blockIndex, pricingOption, equipmentAsQuote: o.equipmentAsQuote, categoryPrefix: p.prefix, amountFidelity: o.amountFidelity, amountModeOverrides: o.amountModeOverrides, workPackageId, replaceCategoryIds },
          user,
        );
        undo = [...r.undo, ...undo];
        results.push({ sheetName: p.sheetName, title: p.title, prefix: p.prefix, created: r.created, categories: r.categories, importId: r.importId, workPackageId });
        itemIds.push(...r.itemIds);
        created += r.created;
        categories += r.categories;
        withCode += r.withCode;
      }
    }
    if (o.saveSummary !== false && plan.summary) {
      db.prepare('INSERT INTO import_summaries (project_id, file_name, sheet_name, lines_json, check_json, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(
        projectId,
        f.fileName,
        plan.summary.sheetName,
        JSON.stringify(plan.summary.lines),
        JSON.stringify({ matches: plan.summary.matches, totalCheck: plan.summary.totalCheck }),
        user,
      );
    }
  })();
  const tbvt = itemIds.filter((id) => repo.getItem(projectId, id).codeStatus === 'tbvt').length;
  return {
    created,
    categories,
    blocks: results,
    withCode,
    withoutCode: created - withCode - tbvt,
    tbvt,
    itemIds,
    workPackageIds: [...new Set(results.map((r) => r.workPackageId))],
    summarySaved: !!plan.summary && o.saveSummary !== false,
    allOk: plan.allOk,
    undo,
    message: `Đã nhập ${created} công việc vào ${categories} hạng mục của ${new Set(results.map((r) => r.workPackageId)).size} hạng mục công trình, từ ${plan.blocks.length} bảng của ${new Set(plan.blocks.map((b) => b.sheetIndex)).size} sheet (${withCode} có mã, ${tbvt} thiết bị/vật tư theo báo giá, ${created - withCode - tbvt} chưa có mã).${plan.allOk ? '' : ' ⚠ Có bảng chưa khớp tổng trong file – xem đối chiếu.'}`,
  };
}

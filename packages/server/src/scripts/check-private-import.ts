/**
 * Developer check for a REAL client workbook (never committed): prints, per sheet and per block, the detected header,
 * item counts and the reconciliation of Σ Thành tiền against the block's own "Cộng trước thuế" row, and the TONGHOP lines.
 * Ends with a compact table (sheet, block, items, file total, imported total, difference) and, for every block that does
 * not reconcile, the rows most responsible for the difference.
 *   npm run check:private-import            → every data/private/*.xls|xlsx
 *   npm run check:private-import -- file.xls
 */
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../db.js';
import { parseBuffer, storeParsed, type ParsedFile } from '../importer.js';
import { analyze } from '../estimate-import.js';
import { analyzeSheets, sheetOverview, type BlockPlan } from '../import-multi.js';
import { LegalService } from '../legal.js';
import { Repo } from '../repo.js';
import { seedAdmin } from '../seed.js';
import { runImportTt38 } from './import-tt38.js';

const money = (n: number | null) => (n === null ? '—' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(n));

/** Left-pad/right-pad a plain text table (Vietnamese diacritics: pad by character count, not bytes). */
function printTable(headers: string[], rows: string[][], aligns: ('l' | 'r')[]) {
  const widths = headers.map((h, c) => Math.max(h.length, ...rows.map((r) => (r[c] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => (aligns[i] === 'r' ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join('  ');
  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));
}

/** The rows of one block most responsible for Σ computed ≠ Σ file (by |diff|, descending). */
function topDiffRows(db: ReturnType<typeof openDb>, repo: Repo, f: ParsedFile, b: BlockPlan, n = 3) {
  const a = analyze(db, repo, f, { sheetIndex: b.sheetIndex, blockIndex: b.blockIndex, pricingOption: 'file', equipmentAsQuote: true });
  if (!a.reconciliation) return [];
  return a.reconciliation.items
    .filter((i) => i.ok === false)
    .sort((x, y) => Math.abs(y.diff ?? 0) - Math.abs(x.diff ?? 0))
    .slice(0, n)
    .map((i) => `dòng ${i.excelRow} "${(i.name ?? '').slice(0, 40)}": file ${money(i.fileAmount)} vs tính lại ${money(i.computed)} (lệch ${money(i.diff)})`);
}

async function main() {
  const arg = process.argv[2];
  const dir = path.resolve('data/private');
  const files = arg ? [path.resolve(arg)] : fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(xls|xlsx|xlsm)$/i.test(f)).map((f) => path.join(dir, f)) : [];
  if (!files.length) {
    console.log('Không có file trong data/private/ (thư mục này nằm trong .gitignore – đặt file thật của khách vào đây, KHÔNG commit).');
    return;
  }
  const db = openDb(':memory:');
  seedAdmin(db, 'admin', 'admin123');
  runImportTt38(db);
  const repo = new Repo(db, new LegalService(db));
  for (const file of files) {
    console.log(`\n=== ${path.basename(file)} ===`);
    const sheets = await parseBuffer(fs.readFileSync(file), path.basename(file));
    const f = storeParsed(1, path.basename(file), sheets);
    const ov = sheetOverview(f);
    console.log(`${ov.length} sheet: ${ov.filter((s) => !s.hidden).length} hiển thị, ${ov.filter((s) => s.hidden).length} ẩn (${ov.filter((s) => s.hidden).map((s) => s.name).join(', ')})`);
    const m = analyzeSheets(db, repo, f, {});
    for (const b of m.blocks) {
      const mark = b.ok === null ? '·' : b.ok ? '✔' : '⚠';
      console.log(`${mark} [${b.sheetName.trim()}] khối ${b.blockIndex + 1}/${b.blockCount} «${b.prefix}» dòng ${b.first}–${b.last}: ${b.items} công việc, ${b.details} dòng diễn giải, ${b.unpriced} chưa giá, ${b.missingUnit} thiếu ĐV${b.tbvt ? `, ${b.tbvt} TB/VT` : ''} | Σ ${money(b.computedTotal)} vs file ${money(b.fileTotal)}${b.diff ? ` (lệch ${money(b.diff)})` : ''}`);
      if (b.blocking) console.log(`    ⛔ ${b.blocking}`);
    }
    const noBlocks = m.sheets.filter((s) => !s.hidden && !s.importable && !s.summary).map((s) => s.name.trim());
    if (noBlocks.length) console.log(`Sheet hiển thị không có bảng dự toán nhận diện được: ${noBlocks.join(' | ')}`);
    if (m.summary) {
      console.log(`\nTổng hợp «${m.summary.sheetName}»:`);
      for (const x of m.summary.matches) console.log(`  ${x.ok === null ? '·' : x.ok ? '✔' : '⚠'} ${x.line.label}: ${money(x.line.amount)}${x.matched ? ` ↔ ${x.matched.label.trim()} ${money(x.matched.amount)}` : ' (không khớp bảng nào)'}`);
      if (m.summary.totalCheck) console.log(`  ${m.summary.totalCheck.ok ? '✔' : '⚠'} TỔNG TRƯỚC THUẾ file ${money(m.summary.totalCheck.file)} vs Σ các bảng ${money(m.summary.totalCheck.computed)}`);
    }

    console.log('\nBảng tóm tắt:');
    printTable(
      ['Sheet', 'Khối', 'Số CV', 'Tổng file', 'Tổng nhập', 'Lệch'],
      m.blocks.map((b) => [
        b.sheetName.trim(),
        b.blockCount > 1 ? `${b.blockIndex + 1}/${b.blockCount}` : '–',
        String(b.items),
        money(b.fileTotal),
        money(b.computedTotal),
        b.diff ? money(b.diff) : b.ok === false ? '?' : '0',
      ]),
      ['l', 'l', 'r', 'r', 'r', 'r'],
    );

    const mismatched = m.blocks.filter((b) => b.ok === false);
    if (mismatched.length) {
      console.log(`\n${mismatched.length} bảng chưa khớp tổng – dòng gây lệch nhiều nhất:`);
      for (const b of mismatched) {
        console.log(`  [${b.sheetName.trim()}]${b.blockCount > 1 ? ` khối ${b.blockIndex + 1}/${b.blockCount}` : ''} «${b.prefix}» (lệch ${money(b.diff)}):`);
        const reasons = topDiffRows(db, repo, f, m.blocks.find((x) => x.key === b.key)!);
        if (reasons.length) for (const r of reasons) console.log(`    - ${r}`);
        else console.log(`    - (không tách được từng dòng – có thể do dòng cộng/trọn gói trong bảng không khớp Σ công việc)`);
      }
    } else {
      console.log('\nTất cả các bảng đã khớp Σ Thành tiền với file.');
    }
  }
}
main();

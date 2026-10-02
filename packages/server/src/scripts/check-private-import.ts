/**
 * Developer check for a REAL client workbook (never committed): prints, per sheet and per block, the detected header,
 * item counts and the reconciliation of Σ Thành tiền against the block's own "Cộng trước thuế" row, and the TONGHOP lines.
 *   npm run check:private-import            → every data/private/*.xls|xlsx
 *   npm run check:private-import -- file.xls
 */
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../db.js';
import { parseBuffer, storeParsed } from '../importer.js';
import { analyzeSheets, sheetOverview } from '../import-multi.js';
import { LegalService } from '../legal.js';
import { Repo } from '../repo.js';
import { seedAdmin } from '../seed.js';
import { runImportTt38 } from './import-tt38.js';

const money = (n: number | null) => (n === null ? '—' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(n));

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
  }
}
main();

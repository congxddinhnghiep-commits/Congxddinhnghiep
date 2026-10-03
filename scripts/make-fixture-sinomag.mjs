// Update 6 C fixture: a synthetic stand-in for the user's real multi-sheet contractor quotation workbook
// (one sheet per building, Việt–Trung bilingual, VNI here and there, breakdown/sub-label rows, composite prices,
// dimension columns that must never be read as prices, a broken-formula cell).
// Run: node scripts/make-fixture-sinomag.mjs   (writes packages/server/test/fixtures/import_sinomag_like.xlsx + .expected.json)
import * as XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';
import { vniToUnicode } from '../packages/core/dist/index.js';

XLSX.set_fs(fs);
// ---- Unicode → VNI encoder, derived by inverting the decoder (same technique as make-import-fixtures.mjs) ----
const VNI_MODS = [...'ùøûõïÙØÛÕÏâáàåãäÂÁÀÅÃÄêéèúüëÊÉÈÚÜËôöÔÖ'];
const vniMap = new Map();
for (const base of 'aeiouyAEIOUYôöÔÖ') for (const mod of VNI_MODS) {
  const u = vniToUnicode(base + mod);
  if (u.length === 1 && u !== base && !vniMap.has(u)) vniMap.set(u, base + mod);
}
for (const [u, v] of [['ơ', 'ô'], ['ư', 'ö'], ['Ơ', 'Ô'], ['Ư', 'Ö'], ['đ', 'ñ'], ['Đ', 'Ñ'], ['ị', 'ò'], ['Ị', 'Ò']]) vniMap.set(u, v);
const vni = (s) => [...s.normalize('NFC')].map((ch) => vniMap.get(ch) ?? ch).join('');
if (vniToUnicode(vni('Ép cọc')) !== 'Ép cọc') throw new Error(`VNI round trip failed: ${vni('Ép cọc')}`);
const out = path.resolve('packages/server/test/fixtures');
fs.mkdirSync(out, { recursive: true });
const range = (s, e) => ({ s: XLSX.utils.decode_cell(s), e: XLSX.utils.decode_cell(e) });

// Columns of a building sheet:
// 0 STT | 1 Công việc 内容 | 2 内容 (name_zh) | 3 ĐVT | 4 Dài | 5 Rộng | 6 Cao | 7 Số cấu kiện | 8 Khối lượng |
// 9 Đơn giá/Vật liệu | 10 Đơn giá/Nhân công | 11 Đơn giá/Tổng cộng | 12 Thành tiền
const HEADER = [
  ['STT', 'Công việc 内容', '内容', 'ĐVT', 'Dài', 'Rộng', 'Cao', 'Số cấu kiện', 'Khối lượng', 'Đơn giá', null, null, 'Thành tiền'],
  [null, null, null, null, null, null, null, null, null, 'Vật liệu', 'Nhân công', 'Tổng cộng', null],
];
const HEADER_MERGES = (r0) => [
  range(`A${r0}`, `A${r0 + 1}`), range(`B${r0}`, `B${r0 + 1}`), range(`C${r0}`, `C${r0 + 1}`), range(`D${r0}`, `D${r0 + 1}`),
  range(`E${r0}`, `E${r0 + 1}`), range(`F${r0}`, `F${r0 + 1}`), range(`G${r0}`, `G${r0 + 1}`), range(`H${r0}`, `H${r0 + 1}`),
  range(`I${r0}`, `I${r0 + 1}`), range(`J${r0}`, `L${r0}`), range(`M${r0}`, `M${r0 + 1}`),
];

/** One building sheet built from a declarative row list; returns { aoa, merges, total, categories: [{name, items:[{name, total, details:[...]}]}] }. */
function buildSheet(rows) {
  const aoa = [...HEADER];
  const merges = HEADER_MERGES(1);
  let currentCat = null;
  let categories = [];
  let total = 0;
  for (const row of rows) {
    const r0 = aoa.length + 1;
    if (row.kind === 'category') {
      aoa.push([row.stt, row.name]);
      merges.push(range(`B${r0}`, `C${r0}`));
      currentCat = { name: row.name, items: [] };
      categories.push(currentCat);
      continue;
    }
    if (row.kind === 'sublabel') {
      aoa.push([null, row.name]);
      merges.push(range(`B${r0}`, `C${r0}`));
      continue;
    }
    if (row.kind === 'detail') {
      aoa.push([null, row.name, null, null, row.dims?.l ?? null, row.dims?.w ?? null, row.dims?.h ?? null, row.dims?.n ?? null, row.qty ?? null]);
      currentCat.items[currentCat.items.length - 1].details.push({ name: row.name, qty: row.qty, dims: row.dims });
      continue;
    }
    // item
    const amount = row.amount ?? Math.round(row.qty * ((row.vl ?? 0) + (row.nc ?? 0)));
    aoa.push([row.stt, row.name, row.nameZh ?? null, row.unit, null, null, null, null, row.qty, row.vl ?? null, row.nc ?? null, row.composite ?? null, row.amountCell ?? amount]);
    currentCat.items.push({ name: row.name, unit: row.unit, qty: row.qty, vl: row.vl ?? null, nc: row.nc ?? null, composite: row.composite ?? null, amount: row.amountCell ?? amount, details: [] });
    total += row.amountCell ?? amount;
  }
  return { aoa, merges, total, categories };
}

// ---- CT01_厂房 (test): the main coverage sheet ----
const ct1Rows = [
  { kind: 'category', stt: 'I', name: 'PHẦN MÓNG' },
  { kind: 'item', stt: 1, name: vni('Ép cọc BTCT 300x300'), unit: 'm', qty: 86, vl: 150000, nc: 50000 }, // VNI-encoded name
  { kind: 'detail', name: 'CT1(1 tim)', qty: 14 },
  { kind: 'detail', name: 'CT2(2 tim)', qty: 72 },
  { kind: 'item', stt: 2, name: 'Đào móng băng bằng máy', unit: 'm3', qty: 40, composite: 25000, amountCell: 40 * 25000 }, // composite only (problem #3)
  { kind: 'item', stt: 3, name: 'Đà kiềng', unit: 'm3', qty: Math.round((4 * 22 * 0.3 + 0.231) * 1000) / 1000, vl: 1380000, nc: 260000 },
  { kind: 'sublabel', name: 'DK1' },
  { kind: 'detail', name: 'Nhịp 1', dims: { l: 4, w: 22, h: 0.3 } }, // dims literally 4 / 22 (problem #3's "44; 4; 22") – must never be read as a price
  { kind: 'detail', name: 'Nhịp 2', dims: { l: 3.5, w: 0.22, h: 0.3 } },
  { kind: 'category', stt: 'II', name: 'PHẦN KẾT CẤU' },
  { kind: 'item', stt: 1, name: 'Cột C1', unit: 'm3', qty: 20, vl: 1200000, nc: 300000 },
  { kind: 'sublabel', name: 'TRỤC 1,9(8.4+11.6)' },
  { kind: 'detail', name: 'Dầm D1', qty: 8.4 },
  { kind: 'detail', name: 'Dầm D2', qty: 11.6 },
  { kind: 'item', stt: 2, name: 'Sơn chống thấm sàn mái', unit: 'm2', qty: 55, nc: 80000, amountCell: 55 * 80000 }, // VL cell is a broken formula, see below
];
const ct1 = buildSheet(ct1Rows);
// Row of "Sơn chống thấm sàn mái" – overwrite its VL cell (J) with a broken-formula error value (problem/C.5).
const sonRowIndex = ct1.aoa.findIndex((r) => r[1] === 'Sơn chống thấm sàn mái');
ct1.aoa[sonRowIndex][9] = '#REF!';
ct1.aoa.push([null, 'Cộng trước thuế', null, null, null, null, null, null, null, null, null, null, ct1.total]);

// ---- CT02_厂房 (test): a second, simpler building – proves packages never mix (problem #1) ----
const ct2Rows = [
  { kind: 'category', stt: 'I', name: 'PHẦN MÓNG' },
  { kind: 'item', stt: 1, name: 'Đào móng', unit: 'm3', qty: 30, vl: 12000, nc: 18000 },
  { kind: 'item', stt: 2, name: 'Bê tông lót móng', unit: 'm3', qty: 6, vl: 1100000, nc: 200000 },
];
const ct2 = buildSheet(ct2Rows);
ct2.aoa.push([null, 'Cộng trước thuế', null, null, null, null, null, null, null, null, null, null, ct2.total]);

// ---- A1. VP (test): office building, 1 Phần, 1 item ----
const a1Rows = [
  { kind: 'category', stt: 'I', name: 'PHẦN HOÀN THIỆN' },
  { kind: 'item', stt: 1, name: 'Ốp gạch ceramic 600x600', unit: 'm2', qty: 120, vl: 185000, nc: 65000 },
];
const a1 = buildSheet(a1Rows);
a1.aoa.push([null, 'Cộng trước thuế', null, null, null, null, null, null, null, null, null, null, a1.total]);

// ---- 01-Điện trung thế: MEP sheet, equipment rows need no norm code ----
const dienRows = [
  { kind: 'category', stt: 'I', name: 'PHẦN THIẾT BỊ ĐIỆN' },
  { kind: 'item', stt: 1, name: 'Máy biến áp 500kVA', unit: 'cái', qty: 1, vl: 185000000, nc: 5000000 },
  { kind: 'item', stt: 2, name: 'Tủ điện trung thế', unit: 'bộ', qty: 2, vl: 42000000, nc: 2000000 },
];
const dien = buildSheet(dienRows);
dien.aoa.push([null, 'Cộng trước thuế', null, null, null, null, null, null, null, null, null, null, dien.total]);

// ---- TONGHOP 总 (summary sheet – never imported as items) ----
const tonghopAoa = [
  ['BẢNG TỔNG HỢP 汇总表'],
  [],
  ['STT', 'HẠNG MỤC 项目', 'THÀNH TIỀN 金额'],
  [1, 'CT01_厂房', ct1.total],
  [2, 'CT02_厂房', ct2.total],
  [3, 'A1. VP', a1.total],
  [4, '01-Điện trung thế', dien.total],
  [null, 'TỔNG TRƯỚC THUẾ', ct1.total + ct2.total + a1.total + dien.total],
];

// ---- thong ke thep (auxiliary "Bảng phụ" – rebar schedule columns, no "tên công việc"/"khối lượng" → never importable) ----
const thongKeThepAoa = [
  ['BẢNG THỐNG KÊ CỐT THÉP'],
  ['Cấu kiện', 'Đường kính (mm)', 'L1 (mm)', 'L2 (mm)', 'Số cây', 'Số cấu kiện'],
  ['Móng M1', 16, 1800, 1200, 8, 10],
  ['Cột C1', 20, 3600, null, 4, 12],
];

// ---- hidden sheet (old price reference, never auto-selected) ----
const hiddenAoa = [['Bảng giá tham khảo nội bộ (ẩn)'], ['Xi măng PCB40', 1650000]];

const wb = XLSX.utils.book_new();
const sheetDefs = [
  ['TONGHOP 总', tonghopAoa, []],
  ['CT01_厂房 (test)', ct1.aoa, ct1.merges],
  ['CT02_厂房 (test)', ct2.aoa, ct2.merges],
  ['A1. VP (test)', a1.aoa, a1.merges],
  ['01-Điện trung thế', dien.aoa, dien.merges],
  ['thong ke thep', thongKeThepAoa, []],
  ['Bang gia noi bo', hiddenAoa, []],
];
for (const [name, aoa, merges] of sheetDefs) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (merges.length) ws['!merges'] = merges;
  XLSX.utils.book_append_sheet(wb, ws, name);
}
wb.Workbook = { Sheets: sheetDefs.map(([name]) => ({ name, Hidden: name === 'Bang gia noi bo' ? 1 : 0 })) };
XLSX.writeFile(wb, path.join(out, 'import_sinomag_like.xlsx'));

// ---- expected.json: item/detail counts, composite prices, per-package and project totals ----
// "fileCategories" = the hạng mục rows the FILE itself declares (checked at the analyze/preview level – row
// recognition, section C); each sheet still becomes exactly ONE work package with ONE Phần once imported, because
// inline roman-numeral sub-headings inside a single detected block are kept as a "Nhóm: …" note on each item instead
// of fragmenting the block (Update 4, decision #103) – importing never creates MORE hạng mục than packages here.
const expected = {
  sheet_building_1: 'CT01_厂房 (test)',
  sheet_building_2: 'CT02_厂房 (test)',
  sheet_office: 'A1. VP (test)',
  sheet_mep: '01-Điện trung thế',
  sheet_summary: 'TONGHOP 总',
  sheet_aux: 'thong ke thep',
  sheet_hidden: 'Bang gia noi bo',
  ct1: {
    fileCategories: ct1.categories.map((c) => ({ name: c.name, items: c.items.length })),
    // names here are the DECODED (Unicode) display names – "Ép cọc…" is written VNI-encoded in the file (see ct1Rows).
    items: ct1.categories.flatMap((c) => c.items).map((it) => ({ name: it.name === vni('Ép cọc BTCT 300x300') ? 'Ép cọc BTCT 300x300' : it.name, unit: it.unit, qty: it.qty, details: it.details.length, composite: it.composite })),
    itemCount: ct1.categories.flatMap((c) => c.items).length,
    total: ct1.total,
    breakdown_texts: ['CT1(1 tim)', 'CT2(2 tim)', 'DK1: Nhịp 1', 'DK1: Nhịp 2', 'TRỤC 1,9(8.4+11.6): Dầm D1', 'TRỤC 1,9(8.4+11.6): Dầm D2'],
    never_items: ['CT1(1 tim)', 'CT2(2 tim)', 'Nhịp 1', 'Nhịp 2', 'Dầm D1', 'Dầm D2', 'DK1', 'TRỤC 1,9(8.4+11.6)'],
    never_sections: ['DK1', 'TRỤC 1,9(8.4+11.6)'],
    composite_item: { name: 'Đào móng băng bằng máy', composite: 25000, amount: 25000 * 40 },
    broken_cell_item: { name: 'Sơn chống thấm sàn mái', appliedVl: 0, appliedNc: 80000, amount: 55 * 80000 },
    dims_never_priced: { item: 'Đà kiềng', forbiddenPrices: [4, 22, 0.3, 3.5, 0.22] },
  },
  ct2: { itemCount: ct2.categories.flatMap((c) => c.items).length, total: ct2.total },
  a1: { itemCount: a1.categories.flatMap((c) => c.items).length, total: a1.total },
  dien: { itemCount: dien.categories.flatMap((c) => c.items).length, total: dien.total },
  project_total: ct1.total + ct2.total + a1.total + dien.total,
};
fs.writeFileSync(path.join(out, 'import_sinomag_like.expected.json'), JSON.stringify(expected, null, 2));
console.log('import_sinomag_like.xlsx + .expected.json written to', out);
console.log('ct1 total =', ct1.total, 'project total =', expected.project_total);

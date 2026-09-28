// Update 4 fixtures for the Excel import fixes (name column, merged headers, text numbers, VNI/TCVN3).
// Run: npm run build -w @dutoan/core && node scripts/make-import-fixtures.mjs   (writes packages/server/test/fixtures/import_*.xlsx)
import * as XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';
import { tcvn3ToUnicode, vniToUnicode } from '../packages/core/dist/index.js';

XLSX.set_fs(fs);
const out = path.resolve('packages/server/test/fixtures');
fs.mkdirSync(out, { recursive: true });
const range = (s, e) => ({ s: XLSX.utils.decode_cell(s), e: XLSX.utils.decode_cell(e) });

// ---- Unicode → legacy encoders, derived by inverting the decoders ----
const VNI_MODS = [...'ùøûõïÙØÛÕÏâáàåãäÂÁÀÅÃÄêéèúüëÊÉÈÚÜËôöÔÖ'];
const vniMap = new Map();
for (const base of 'aeiouyAEIOUYôöÔÖ') for (const mod of VNI_MODS) {
  const u = vniToUnicode(base + mod);
  if (u.length === 1 && u !== base && !vniMap.has(u)) vniMap.set(u, base + mod);
}
for (const [u, v] of [['ơ', 'ô'], ['ư', 'ö'], ['Ơ', 'Ô'], ['Ư', 'Ö'], ['đ', 'ñ'], ['Đ', 'Ñ'], ['í', 'í'], ['ì', 'ì'], ['ỉ', 'æ'], ['ĩ', 'ó'], ['ị', 'ò'], ['Í', 'Í'], ['Ì', 'Ì'], ['Ỉ', 'Æ'], ['Ĩ', 'Ó'], ['Ị', 'Ò'], ['ỵ', 'î'], ['Ỵ', 'Î']]) vniMap.set(u, v);
const tcvnMap = new Map();
for (let c = 0x80; c <= 0xff; c++) {
  const ch = String.fromCharCode(c);
  const u = tcvn3ToUnicode(ch);
  if (u !== ch && !tcvnMap.has(u)) tcvnMap.set(u, ch);
}
const encode = (s, map) => [...s.normalize('NFC')].map((ch) => map.get(ch) ?? ch).join('');
const vni = (s) => encode(s, vniMap);
const tcvn = (s) => encode(s, tcvnMap);
for (const w of ['tấn', 'Đào đất móng']) {
  if (vniToUnicode(vni(w)) !== w) throw new Error(`VNI round trip failed for ${w}: ${vni(w)}`);
}
console.log('VNI  tấn =', vni('tấn'), '| Đào đất móng =', vni('Đào đất móng'));
console.log('TCVN tấn =', tcvn('tấn'), '| Đào đất móng =', tcvn('Đào đất móng'));

// ---- a) import_wide.xlsx – F1/G8 style, merged headers, hidden columns, text numbers ----
{
  const t = (n) => n.toLocaleString('vi-VN'); // 1.382.500 (text with Vietnamese separators)
  // [stt, code, name, unit, qty, vl, nc, m]
  const items = [
    ['A', null, 'PHẦN MÓNG'],
    [1, 'AB.11312', 'Đào móng băng bằng thủ công, chiều rộng móng ≤3m, sâu ≤1m, đất cấp II (đào, xúc, vun gọn và hoàn thiện hố móng)', 'm3', 12.5, 15000, 180000, 0],
    [2, 'AF.11110', 'Bê tông lót móng, chiều rộng ≤250cm, đá 4x6, vữa bê tông M100', 'm3', 3.2, 1150000, 220000, 35000],
    [3, 'AF.61120', 'Sản xuất, lắp dựng cốt thép móng, đường kính ≤18mm', 'tấn', 0.85, 16800000, 1500000, 480000],
    ['SUB', 'Cộng phần móng'],
    ['B', null, 'PHẦN THÂN'],
    [4, 'AF.12213', 'Bê tông cột, tiết diện ≤0,1m2, cao ≤6m, mác 250 (mã kiểu cũ)', 'm3', 8.4, 1380000, 260000, 45000],
    [5, null, 'Xây tường gạch ống dày 10cm, cao ≤6m, vữa XM mác 75', 'm3', 22, 980000, 410000, 30000],
    [6, 'VD', 'Cửa nhôm kính hệ 55 (giá tạm tính)', 'm2', 18, 1550000, 250000, 0],
    ['SUB', 'Cộng phần thân'],
    ['TOTAL', 'TỔNG CỘNG'],
  ];
  const aoa = [
    ['BẢNG DỰ TOÁN CHI TIẾT'],
    ['Công trình: Nhà xưởng thử nghiệm'],
    [],
    [],
    ['STT', 'Mã hiệu', 'Nội dung công việc', null, 'Đơn vị', 'Khối lượng', 'Đơn giá', null, null, 'Thành tiền', null, null, 'Ghi chú nội bộ', 'Hệ số ẩn'],
    [null, null, null, null, null, null, 'Vật liệu', 'Nhân công', 'Máy', 'Vật liệu', 'Nhân công', 'Máy', null, null],
  ];
  const merges = [range('A5', 'A6'), range('B5', 'B6'), range('C5', 'D6'), range('E5', 'E6'), range('F5', 'F6'), range('G5', 'I5'), range('J5', 'L5'), range('M5', 'M6'), range('N5', 'N6')];
  let sub = { vl: 0, nc: 0, m: 0 };
  let grand = { vl: 0, nc: 0, m: 0 };
  const total = (o) => t(Math.round(o.vl + o.nc + o.m));
  for (const it of items) {
    const excelRow = aoa.length + 1;
    if (it[0] === 'SUB') {
      aoa.push([null, null, it[1], null, null, null, null, null, null, t(sub.vl), t(sub.nc), t(sub.m), null, null]);
      merges.push(range(`C${excelRow}`, `D${excelRow}`));
      sub = { vl: 0, nc: 0, m: 0 };
    } else if (it[0] === 'TOTAL') {
      aoa.push([null, null, it[1], null, null, null, null, null, null, t(grand.vl), t(grand.nc), t(grand.m), null, null]);
      merges.push(range(`C${excelRow}`, `D${excelRow}`));
    } else if (it.length === 3) {
      aoa.push([it[0], null, it[2]]);
      merges.push(range(`C${excelRow}`, `D${excelRow}`));
    } else {
      const [stt, code, name, unit, q, vl, nc, m] = it;
      const tt = { vl: q * vl, nc: q * nc, m: q * m };
      for (const k of ['vl', 'nc', 'm']) { sub[k] += tt[k]; grand[k] += tt[k]; }
      aoa.push([stt, code, name, null, unit, String(q).replace('.', ','), t(vl), t(nc), t(m), t(Math.round(tt.vl)), t(Math.round(tt.nc)), t(Math.round(tt.m)), 7 + stt, 1]);
      merges.push(range(`C${excelRow}`, `D${excelRow}`));
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  ws['!cols'] = Array.from({ length: 14 }, (_, i) => ({ wch: i === 2 ? 50 : 12, hidden: i === 12 || i === 13 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'DUTOAN');
  XLSX.writeFile(wb, path.join(out, 'import_wide.xlsx'));
  console.log('import_wide grand total =', total(grand));
}

// ---- b) import_vni.xlsx – VNI-Times, TCVN3 (.VnTime) and a mixed sheet ----
{
  const rows = [
    ['A', null, 'PHẦN MÓNG'],
    [1, 'AB.11312', 'Đào móng băng bằng thủ công, đất cấp II', 'm3', 12.5, 15000, 180000],
    [2, 'AF.11110', 'Bê tông lót móng, chiều rộng ≤250cm', 'm3', 3.2, 1150000, 220000],
    [3, 'AF.61120', 'Cốt thép móng, đường kính ≤18mm', 'tấn', 0.85, 16800000, 1500000],
    [4, null, 'Trát tường trong dày 1,5cm vữa XM mác 75', 'm2', 250, 42000, 38000],
    [null, null, 'Cộng phần móng'],
  ];
  const head = ['STT', 'Mã hiệu', 'Nội dung công việc', 'Đơn vị', 'Khối lượng', 'Đơn giá vật liệu', 'Đơn giá nhân công'];
  const sheet = (title, nameEnc, unitEnc, headEnc, lowerCaps = false) => {
    const aoa = [[headEnc(title)], [], head.map((h) => headEnc(h))];
    for (const r of rows) aoa.push(r.map((v, i) => (typeof v === 'string' && i === 2 ? nameEnc(lowerCaps && v === 'PHẦN MÓNG' ? 'Phần móng' : v) : typeof v === 'string' && i === 3 ? unitEnc(v) : v)));
    return XLSX.utils.aoa_to_sheet(aoa);
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet('BẢNG DỰ TOÁN', vni, vni, vni), 'VNI');
  // TCVN3 (ABC) has no capital letters with tone marks → lower-case titles in that sheet
  XLSX.utils.book_append_sheet(wb, sheet('Bảng dự toán', tcvn, tcvn, tcvn, true), 'TCVN3');
  // mixed: names VNI, units TCVN3, header Unicode – a single sheet-wide encoding vote would get one of them wrong
  XLSX.utils.book_append_sheet(wb, sheet('BẢNG DỰ TOÁN', vni, tcvn, (x) => x), 'Hon hop');
  XLSX.writeFile(wb, path.join(out, 'import_vni.xlsx'));
}

// ---- c) import_nameoffset.xlsx – name column after an empty spacer, price header contains "công việc" ----
{
  const aoa = [
    ['BẢNG DỰ TOÁN'],
    [],
    ['STT', 'Mã hiệu', null, 'Nội dung', 'ĐVT', 'Khối lượng', 'Đơn giá công việc', 'Thành tiền'],
    ['A', null, null, 'PHẦN MÓNG'],
    [1, 'AB.11312', null, 'Đào móng băng bằng thủ công, đất cấp II', 'm3', 12.5, 195000, 2437500],
    [2, 'AF.11110', null, 'Bê tông lót móng, chiều rộng ≤250cm', 'm3', 3.2, 1405000, 4496000],
    [3, null, null, 'Cốt thép móng D<=10', 'tấn', 0.85, 18300000, 15555000],
    [null, null, null, 'Cộng phần móng', null, null, null, 22488500],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'DUTOAN');
  XLSX.writeFile(wb, path.join(out, 'import_nameoffset.xlsx'));
}
console.log('import fixtures written to', out);

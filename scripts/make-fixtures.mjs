// Generates synthetic estimate workbooks used by tests and manual checks.
// Run: node scripts/make-fixtures.mjs   (writes packages/server/test/fixtures/*)
import * as XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';

XLSX.set_fs(fs);
const out = path.resolve('packages/server/test/fixtures');
fs.mkdirSync(out, { recursive: true });
const range = (s, e) => ({ s: XLSX.utils.decode_cell(s), e: XLSX.utils.decode_cell(e) });

// 1) F1-like layout: title, 2-row merged header (Đơn giá / Thành tiền split VL-NC-M), column
//    numbering row, roman-numeral categories, subtotal rows, formulas with cached values.
{
  const rows = [
    ['BẢNG DỰ TOÁN CHI TIẾT'],
    ['Công trình: Nhà làm việc 2 tầng – Hạng mục: Xây dựng'],
    [],
    ['STT', 'Mã hiệu', 'Nội dung công việc', 'Đơn vị', 'Khối lượng', 'Đơn giá', null, null, 'Thành tiền', null, null],
    [null, null, null, null, null, 'Vật liệu', 'Nhân công', 'Máy', 'Vật liệu', 'Nhân công', 'Máy'],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    ['I', null, 'PHẦN MÓNG'],
    [1, 'AB.25112', 'Đào móng công trình bằng máy đào ≤0,8m3, đất cấp II', '100m3', 2.5, 0, 1347500, 1120000],
    [2, 'AF.11111', 'Bê tông lót móng, rộng ≤250cm, đá 4x6, mác 100', 'm3', 12.3, 835613, 372040, 51760],
    [3, 'AF.11213', 'Bê tông móng, rộng ≤250cm, đá 1x2, mác 250', 'm3', 45.6, 1150000, 429680, 75400],
    [4, 'AF.61120', 'Sản xuất, lắp dựng cốt thép móng, đường kính ≤18mm', 'tấn', 3.25, 17800000, 2268480, 474600],
    [null, null, 'Cộng hạng mục phần móng'],
    ['II', null, 'PHẦN THÂN'],
    [5, 'AF.12224', 'Bê tông cột, tiết diện >0,1m2, cao ≤6m, đá 1x2, mác 300', 'm3', 18.4, 1250000, 826880, 144000],
    [6, 'AF.81132', 'Ván khuôn gỗ cột vuông, chữ nhật', '100m2', 1.85, 5600000, 8932000, 0],
    [7, 'AE.22214', 'Xây tường thẳng gạch đặc, dày ≤11cm, cao ≤6m, vữa XM mác 75', 'm3', 36.2, 1050000, 660960, 48000],
    [8, 'ZZ.99999', 'Lắp đặt cửa nhôm kính hệ 55', 'm2', 24, 2100000, 150000, 0],
    [null, null, 'Cộng hạng mục phần thân'],
    [null, null, 'TỔNG CỘNG'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // Thành tiền = KL × đơn giá as formulas with cached values
  for (let r = 7; r <= 16; r++) {
    if (typeof rows[r][4] !== 'number') continue;
    for (let k = 0; k < 3; k++) {
      const col = XLSX.utils.encode_col(8 + k);
      const src = XLSX.utils.encode_col(5 + k);
      ws[`${col}${r + 1}`] = { t: 'n', f: `E${r + 1}*${src}${r + 1}`, v: rows[r][4] * rows[r][5 + k] };
    }
  }
  ws['!ref'] = 'A1:K19';
  ws['!merges'] = [
    range('A1', 'K1'),
    range('A2', 'K2'),
    range('A4', 'A5'),
    range('B4', 'B5'),
    range('C4', 'C5'),
    range('D4', 'D5'),
    range('E4', 'E5'),
    range('F4', 'H4'),
    range('I4', 'K4'),
  ];
  const th = XLSX.utils.aoa_to_sheet([
    ['BẢNG TỔNG HỢP CHI PHÍ XÂY DỰNG'],
    ['STT', 'Khoản mục chi phí', 'Cách tính', 'Giá trị', 'Ký hiệu'],
    ['I', 'Chi phí trực tiếp', 'VL+NC+M', 1000000, 'T'],
  ]);
  const vt = XLSX.utils.aoa_to_sheet([
    ['BẢNG TỔNG HỢP VẬT TƯ'],
    ['STT', 'Mã vật tư', 'Tên vật tư', 'Đơn vị', 'Khối lượng', 'Giá', 'Thành tiền'],
    [1, 'V.XM40', 'Xi măng PCB40', 'kg', 12000, 1500, 18000000],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, th, 'TH');
  XLSX.utils.book_append_sheet(wb, ws, 'DTCT');
  XLSX.utils.book_append_sheet(wb, vt, 'THVT');
  XLSX.writeFile(wb, path.join(out, 'du-toan-kieu-f1.xlsx'));
  XLSX.writeFile(wb, path.join(out, 'du-toan-kieu-f1.xls'), { bookType: 'biff8' });
}

// 2) Free-form BOQ: merged 2-row header with a "Giá trị dự thầu" group, letter categories,
//    numbers typed as text in Vietnamese format, zero / duplicate / unknown-unit rows, notes, totals.
{
  const rows = [
    ['BẢNG TIÊN LƯỢNG MỜI THẦU'],
    ['Gói thầu số 03: Xây dựng nhà kho vật tư'],
    ['TT', 'Hạng mục công việc', 'Đơn vị tính', 'Khối lượng', 'Giá trị dự thầu', null, 'Ghi chú'],
    [null, null, null, null, 'Đơn giá', 'Thành tiền', null],
    ['A', 'PHẦN NỀN MÓNG'],
    [1, 'Đào đất hố móng bằng máy đào, đất cấp II', 'm3', '1.234,5'],
    [2, 'Bê tông lót móng M100 đá 4x6', 'm3', '18,5'],
    [3, 'Bê tông móng M250', 'm3', 96.4],
    [4, 'Cốt thép móng Ø16', 'kg', '4.250'],
    [null, 'Tổng cộng phần A'],
    ['B', 'PHẦN THÂN'],
    [5, 'Xây tường gạch đặc dày 220 vữa XM M75', 'm3', 55],
    [6, 'Trát tường ngoài dày 1,5cm', 'm2', 0],
    [7, 'Trát tường ngoài dày 1,5cm', 'm2', 320],
    [8, 'Sơn tường ngoài nhà 1 nước lót 2 nước phủ', 'm²', '320'],
    [9, 'Lắp dựng khung thép tiền chế nhà kho', 'khung', 4],
    [null, 'Ghi chú: khối lượng tạm tính theo hồ sơ thiết kế cơ sở'],
    [null, 'TỔNG CỘNG'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!merges'] = [range('A1', 'G1'), range('A2', 'G2'), range('A3', 'A4'), range('B3', 'B4'), range('C3', 'C4'), range('D3', 'D4'), range('E3', 'F3'), range('G3', 'G4')];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Khoi luong');
  XLSX.writeFile(wb, path.join(out, 'boq-tu-do.xlsx'));
}

// 3) Bilingual Vietnamese–Chinese BOQ: header cells "序号 / STT", EN-style numbers, 小计 / 合计 totals.
{
  const rows = [
    ['工程量清单 / BẢNG KHỐI LƯỢNG'],
    ['序号\nSTT', '编码\nMã hiệu', '项目名称\nTên công việc', '单位\nĐơn vị', '工程量\nKhối lượng', '单价\nĐơn giá', '合价\nThành tiền'],
    ['一', null, '基础工程 / PHẦN MÓNG'],
    [1, null, '混凝土垫层 / Bê tông lót móng M100', 'm3', '12.50'],
    [2, null, '基础钢筋 / Cốt thép móng đk ≤10mm', 'kg', '1,234.50'],
    [3, null, '基础混凝土 / Bê tông móng mác 300', 'm³', 60],
    [null, null, '小计 / Cộng'],
    ['二', null, '主体工程 / PHẦN THÂN'],
    [4, null, '砖墙 / Xây tường gạch rỗng 2 lỗ dày 110', 'm3', 40],
    [5, null, '内墙抹灰 / Trát tường trong', 'm2', 520],
    [null, null, '合计 / Tổng cộng'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!merges'] = [range('A1', 'G1')];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '工程量清单 BOQ');
  XLSX.writeFile(wb, path.join(out, 'song-ngu-viet-trung.xlsx'));
}
// 4) Price list (SYNTHETIC test data – not an official publication): group rows, codes for some
//    rows only, spec column, sub-area column, prices per tấn / m3.
{
  const rows = [
    ['BẢNG GIÁ THỬ NGHIỆM – SỐ LIỆU GIẢ ĐỊNH, KHÔNG PHẢI CÔNG BỐ GIÁ'],
    ['STT', 'Mã VL', 'Tên vật liệu', 'Quy cách', 'ĐVT', 'Giá chưa VAT (đồng)', 'Khu vực'],
    ['I', null, 'XI MĂNG'],
    [1, 'V.XM40', 'Xi măng', 'PCB40', 'tấn', '1.650.000', null],
    [2, null, 'Xi măng PCB40', 'bao 50kg', 'tấn', '1.720.000', 'Cần Giờ'],
    ['II', null, 'CÁT, ĐÁ'],
    [3, null, 'Cát vàng', 'hạt to', 'm3', 420000, null],
    [4, null, 'Đá dăm 1x2', null, 'm3', 455000, null],
    [5, null, 'Thép hình I200', 'SS400', 'kg', 21500, null],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!merges'] = [range('A1', 'G1')];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Gia VL');
  XLSX.writeFile(wb, path.join(out, 'bang-gia-thu-nghiem.xlsx'));
}
console.log('fixtures written to', out);

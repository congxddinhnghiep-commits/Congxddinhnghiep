import ExcelJS from 'exceljs';
import { amountInWords, BUILDING_TYPE_LABELS, evaluateFormula, RESOURCE_TYPE_LABELS } from '@dutoan/core';
import type { LegalDocument } from '@dutoan/core';
import type { Calculation } from './repo.js';

const FONT = 'Times New Roman';
const MONEY = '#,##0';
const QTY = '#,##0.000';
const THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

type Cell = string | number | null | { formula: string; result?: number };

function setupSheet(ws: ExcelJS.Worksheet, widths: number[], landscape: boolean) {
  ws.columns = widths.map((w) => ({ width: w }));
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: landscape ? 'landscape' : 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.6, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
  };
  ws.headerFooter.oddFooter = '&R Trang &P/&N';
  ws.properties.defaultRowHeight = 18;
}

function title(ws: ExcelJS.Worksheet, row: number, text: string, cols: number, size = 14) {
  ws.mergeCells(row, 1, row, cols);
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { name: FONT, size, bold: true };
  c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
}

function info(ws: ExcelJS.Worksheet, row: number, text: string, cols: number) {
  ws.mergeCells(row, 1, row, cols);
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { name: FONT, size: 11, italic: true };
  c.alignment = { horizontal: 'left' };
}

function header(ws: ExcelJS.Worksheet, row: number, labels: string[]) {
  const r = ws.getRow(row);
  labels.forEach((l, i) => {
    const c = r.getCell(i + 1);
    c.value = l;
    c.font = { name: FONT, size: 11, bold: true };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = THIN;
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF6' } };
  });
  r.height = 32;
}

/** Write a table row; numFmts maps column index (1-based) → number format. */
function row(ws: ExcelJS.Worksheet, rowNo: number, values: Cell[], opts: { bold?: boolean; numFmts?: Record<number, string>; italic?: boolean } = {}) {
  const r = ws.getRow(rowNo);
  values.forEach((v, i) => {
    const c = r.getCell(i + 1);
    c.value = v as ExcelJS.CellValue;
    c.font = { name: FONT, size: 11, bold: opts.bold, italic: opts.italic };
    c.border = THIN;
    const fmt = opts.numFmts?.[i + 1];
    if (fmt) c.numFmt = fmt;
    c.alignment = { vertical: 'middle', wrapText: typeof v === 'string' && v.length > 20, horizontal: typeof v === 'string' && v.length <= 3 ? 'center' : undefined };
  });
  return r;
}

const roman = (n: number) =>
  ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'][n - 1] ?? String(n);

/** Convert a "diễn giải" formula into an Excel formula when it is valid arithmetic. */
function excelQuantity(formula: string | null | undefined, value: number): Cell {
  if (!formula) return value;
  try {
    evaluateFormula(formula);
  } catch {
    return value;
  }
  const f = formula
    .replace(/\[[^\]]*\]/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/[×xX]/g, '*')
    .replace(/÷/g, '/')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\s+/g, '');
  return { formula: f, result: value };
}

export async function buildWorkbook(calc: Calculation, author: string, legalDocs: LegalDocument[]): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = author;
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  const p = calc.project;
  const projectInfo = [
    `Công trình: ${p.name}`,
    p.ownerName ? `Chủ đầu tư: ${p.ownerName}` : '',
    p.location ? `Địa điểm: ${p.location}` : '',
    `Loại công trình: ${BUILDING_TYPE_LABELS[p.buildingType] ?? p.buildingType}`,
    p.priceBaseDate || p.priceDate ? `Thời điểm lập giá: ${[p.priceBaseDate, p.priceDate].filter(Boolean).join(' – ')}` : '',
  ].filter(Boolean);

  // Sheet creation order = tab order.
  const wsTH = wb.addWorksheet('TH');
  const wsDT = wb.addWorksheet('DTCT');
  const wsPT = wb.addWorksheet('PTVT');
  const wsTV = wb.addWorksheet('THVT');
  const wsCL = wb.addWorksheet('CLVT');
  const wsTDT = wb.addWorksheet('TDT');

  // ------------------------------------------------------------------ THVT
  setupSheet(wsTV, [6, 14, 42, 9, 12, 14, 14, 18], false);
  title(wsTV, 1, 'BẢNG TỔNG HỢP VẬT TƯ', 8);
  info(wsTV, 2, projectInfo[0], 8);
  header(wsTV, 4, ['STT', 'Mã hiệu', 'Tên vật tư, nhân công, máy', 'Đơn vị', 'Loại', 'Khối lượng', 'Giá (đ)', 'Thành tiền (đ)']);
  const resRow = new Map<string, number>();
  let r = 5;
  calc.resourceSummary.forEach((s, i) => {
    resRow.set(s.code, r);
    row(
      wsTV,
      r,
      [
        i + 1,
        s.code,
        s.name,
        s.unit,
        s.type,
        { formula: `SUMIF(PTVT!$B:$B,B${r},PTVT!$G:$G)`, result: s.quantity },
        s.price,
        { formula: `F${r}*G${r}`, result: s.amount },
      ],
      { numFmts: { 6: QTY, 7: MONEY, 8: MONEY } },
    );
    r++;
  });
  const tvLast = r - 1;
  row(wsTV, r, ['', '', 'TỔNG CỘNG', '', '', '', '', { formula: `SUM(H5:H${Math.max(5, tvLast)})`, result: calc.total.total }], {
    bold: true,
    numFmts: { 8: MONEY },
  });

  // ------------------------------------------------------------------ PTVT
  setupSheet(wsPT, [6, 14, 44, 9, 7, 12, 14, 14, 14, 14, 14, 14], true);
  title(wsPT, 1, 'BẢNG PHÂN TÍCH VẬT TƯ', 12);
  info(wsPT, 2, projectInfo[0], 12);
  header(wsPT, 4, ['STT', 'Mã hiệu', 'Tên công tác / tài nguyên', 'Đơn vị', 'Loại', 'Định mức', 'Khối lượng', 'Đơn giá (đ)', 'Thành tiền / 1 ĐV (đ)', 'ĐG VL', 'ĐG NC', 'ĐG M']);
  const itemHeaderRow = new Map<number, number>();
  const dtItemRow = new Map<number, number>();

  // Pre-compute DTCT row numbers so PTVT can reference quantities.
  let dr = 6; // first data row of DTCT
  for (const cat of calc.categories) {
    dr++; // category subtotal row
    for (const it of cat.items) dtItemRow.set(it.id, dr++);
  }

  r = 5;
  let stt = 0;
  for (const cat of calc.categories) {
    for (const it of cat.items) {
      stt++;
      const hdr = r;
      itemHeaderRow.set(it.id, hdr);
      const first = hdr + 1;
      const last = hdr + it.analysis.length;
      const sumIf = (t: string, result: number): Cell =>
        it.analysis.length ? { formula: `SUMIF(E${first}:E${last},"${t}",I${first}:I${last})`, result } : 0;
      row(
        wsPT,
        hdr,
        [
          stt,
          it.normCode,
          it.name,
          it.unit,
          '',
          '',
          { formula: `DTCT!F${dtItemRow.get(it.id)}`, result: it.quantity },
          '',
          '',
          sumIf('VL', it.unitCost.vl),
          sumIf('NC', it.unitCost.nc),
          sumIf('M', it.unitCost.m),
        ],
        { bold: true, numFmts: { 7: QTY, 10: MONEY, 11: MONEY, 12: MONEY } },
      );
      r++;
      for (const a of it.analysis) {
        const tv = resRow.get(a.resourceCode);
        row(
          wsPT,
          r,
          [
            '',
            a.resourceCode,
            a.name,
            a.unit,
            a.type,
            a.consumption,
            { formula: `F${r}*$G$${hdr}`, result: a.quantity },
            tv ? { formula: `THVT!G${tv}`, result: a.price } : a.price,
            { formula: `F${r}*H${r}`, result: a.unitAmount },
            '',
            '',
            '',
          ],
          { italic: true, numFmts: { 6: '#,##0.0000', 7: QTY, 8: MONEY, 9: MONEY } },
        );
        r++;
      }
    }
  }

  // ------------------------------------------------------------------ DTCT
  setupSheet(wsDT, [6, 13, 42, 8, 20, 12, 13, 13, 13, 15, 15, 15, 16], true);
  title(wsDT, 1, 'BẢNG DỰ TOÁN CHI TIẾT', 13);
  info(wsDT, 2, projectInfo.join('   –   '), 13);
  header(wsDT, 4, ['STT', 'Mã hiệu', 'Tên công tác', 'Đơn vị', 'Diễn giải khối lượng', 'Khối lượng', 'Đơn giá (đ)', '', '', 'Thành tiền (đ)', '', '', 'Tổng cộng (đ)']);
  header(wsDT, 5, ['', '', '', '', '', '', 'Vật liệu', 'Nhân công', 'Máy', 'Vật liệu', 'Nhân công', 'Máy', '']);
  wsDT.mergeCells('G4:I4');
  wsDT.mergeCells('J4:L4');
  for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'M']) wsDT.mergeCells(`${col}4:${col}5`);
  r = 6; // must match the pre-computed dtItemRow layout above
  const catTotalRows: number[] = [];
  stt = 0;
  calc.categories.forEach((cat, ci) => {
    const catRow = r++;
    catTotalRows.push(catRow);
    const firstItem = r;
    for (const it of cat.items) {
      stt++;
      const hdr = itemHeaderRow.get(it.id)!;
      const ref = (col: string, result: number): Cell => (it.analysis.length ? { formula: `PTVT!${col}${hdr}`, result } : 0);
      row(
        wsDT,
        r,
        [
          stt,
          it.normCode,
          it.name,
          it.unit,
          it.quantityFormula ?? '',
          excelQuantity(it.quantityFormula, it.quantity),
          ref('J', it.unitCost.vl),
          ref('K', it.unitCost.nc),
          ref('L', it.unitCost.m),
          { formula: `F${r}*G${r}`, result: it.amount.vl },
          { formula: `F${r}*H${r}`, result: it.amount.nc },
          { formula: `F${r}*I${r}`, result: it.amount.m },
          { formula: `SUM(J${r}:L${r})`, result: it.amount.total },
        ],
        { numFmts: { 6: QTY, 7: MONEY, 8: MONEY, 9: MONEY, 10: MONEY, 11: MONEY, 12: MONEY, 13: MONEY } },
      );
      r++;
    }
    const lastItem = r - 1;
    const sum = (col: string, result: number): Cell =>
      lastItem >= firstItem ? { formula: `SUM(${col}${firstItem}:${col}${lastItem})`, result } : 0;
    row(
      wsDT,
      catRow,
      [roman(ci + 1), '', cat.name.toUpperCase(), '', '', '', '', '', '', sum('J', cat.total.vl), sum('K', cat.total.nc), sum('L', cat.total.m), sum('M', cat.total.total)],
      { bold: true, numFmts: { 10: MONEY, 11: MONEY, 12: MONEY, 13: MONEY } },
    );
  });
  const dtTotal = r;
  const totalOf = (col: string, result: number): Cell =>
    catTotalRows.length ? { formula: catTotalRows.map((x) => `${col}${x}`).join('+'), result } : 0;
  row(
    wsDT,
    dtTotal,
    ['', '', 'TỔNG CỘNG', '', '', '', '', '', '', totalOf('J', calc.total.vl), totalOf('K', calc.total.nc), totalOf('L', calc.total.m), totalOf('M', calc.total.total)],
    { bold: true, numFmts: { 10: MONEY, 11: MONEY, 12: MONEY, 13: MONEY } },
  );
  wsDT.views = [{ state: 'frozen', ySplit: 5 }];

  // ------------------------------------------------------------------ TH
  // Columns: STT | Khoản mục | Cách tính | Tỷ lệ (%) / hệ số | Giá trị | Ký hiệu | Nguồn / căn cứ
  setupSheet(wsTH, [6, 46, 30, 12, 20, 9, 56], true);
  title(wsTH, 1, 'BẢNG TỔNG HỢP DỰ TOÁN CHI PHÍ XÂY DỰNG', 7);
  info(wsTH, 2, projectInfo.join('   –   '), 7);
  const docs = legalDocs.filter((d) => calc.legalSet.documents.includes(d.id));
  info(wsTH, 3, `Bộ căn cứ pháp lý: ${calc.legalSet.label}${calc.legalSet.status === 'historical' ? ' (lịch sử)' : ''}`, 7);
  wsTH.getCell(3, 1).font = { name: FONT, size: 11, bold: true };
  let r0 = 4;
  for (const d of docs) {
    const dates = [d.issued ? `ban hành ${d.issued}` : '', d.effective ? `hiệu lực ${d.effective}` : ''].filter(Boolean).join(', ');
    info(wsTH, r0++, `– ${d.type} ${d.number}: ${d.title}${dates ? ` (${dates})` : ''}${d.url ? ` – ${d.url}` : ''}${d.verified ? '' : ' [chưa xác minh]'}`, 7);
  }
  if (calc.provisionalRates) {
    info(wsTH, r0, 'CẢNH BÁO: bảng tỷ lệ đang ở trạng thái TẠM (provisional) – chưa đối chiếu bản PDF đã ký / phụ lục thay thế (CV 9947/BXD-VP).', 7);
    wsTH.getCell(r0++, 1).font = { name: FONT, size: 11, bold: true, color: { argb: 'FFB42318' } };
  }
  const headRow = r0 + 1;
  header(wsTH, headRow, ['STT', 'Khoản mục chi phí', 'Cách tính', 'Tỷ lệ (%) / hệ số', 'Giá trị (đ)', 'Ký hiệu', 'Nguồn / căn cứ']);
  const lineRow: Record<string, number> = {};
  const cs = calc.costSummary;
  r = headRow + 1;
  cs.lines.forEach((l) => (lineRow[l.code] = r++));
  const dtRef: Record<string, string> = { 'DT.VL': `DTCT!J${dtTotal}`, 'DT.NC': `DTCT!K${dtTotal}`, 'DT.M': `DTCT!L${dtTotal}` };
  const toExcel = (expr: string, rr: number) =>
    expr.replace(/\{([^}]+)\}/g, (_, tok: string) => {
      if (tok === 'rate' || tok === 'coef') return `D${rr}`;
      if (tok.startsWith('rate:')) return `D${lineRow[tok.slice(5)]}`;
      if (dtRef[tok]) return dtRef[tok];
      if (lineRow[tok] === undefined) throw new Error(`Unknown token ${tok}`);
      return `E${lineRow[tok]}`;
    });
  for (const l of cs.lines) {
    const rr = lineRow[l.code];
    const d: Cell = l.coef !== undefined ? l.coef : l.rate ?? '';
    const val: Cell = l.expr ? { formula: toExcel(l.expr, rr), result: l.value } : l.value;
    const rowObj = row(wsTH, rr, [l.stt ?? '', l.name, l.formula, d, val, l.code, l.source ?? ''], {
      bold: l.level === 0,
      numFmts: { 4: l.coef !== undefined ? '0.0000' : '0.00', 5: MONEY },
    });
    rowObj.getCell(7).font = { name: FONT, size: 9, italic: true };
    rowObj.getCell(7).alignment = { wrapText: true, vertical: 'middle' };
  }
  r = lineRow[cs.lines[cs.lines.length - 1].code] + 1;
  const gxdRow = lineRow.GXD ?? lineRow.Gxd;
  const thTotalRow = r;
  row(
    wsTH,
    r,
    [
      '',
      cs.nhaTam ? 'Tổng chi phí xây dựng (GXD + GXDNT)' : 'Tổng chi phí xây dựng',
      '',
      '',
      { formula: cs.nhaTam ? `E${gxdRow}+E${lineRow.GXDNT}` : `E${gxdRow}`, result: cs.total ?? cs.Gxd },
      '',
      '',
    ],
    { bold: true, numFmts: { 5: MONEY } },
  );
  r += 2;
  info(wsTH, r, `Bằng chữ: ${amountInWords(cs.total ?? cs.Gxd)}.`, 7);
  info(wsTH, r + 1, `Nguồn tỷ lệ: ${calc.ratesSource}`, 7);
  calc.warnings.forEach((w, i) => info(wsTH, r + 2 + i, `Lưu ý: ${w}`, 7));

  // ------------------------------------------------------------------ CLVT
  setupSheet(wsCL, [6, 14, 40, 9, 14, 14, 14, 14, 18], false);
  title(wsCL, 1, 'BẢNG CHÊNH LỆCH GIÁ VẬT TƯ', 9);
  info(wsCL, 2, projectInfo[0], 9);
  header(wsCL, 4, ['STT', 'Mã hiệu', 'Tên vật tư', 'Đơn vị', 'Khối lượng', 'Giá gốc (đ)', 'Giá hiện hành (đ)', 'Chênh lệch (đ)', 'Thành tiền (đ)']);
  r = 5;
  calc.resourceSummary.forEach((s, i) => {
    const tv = resRow.get(s.code)!;
    row(
      wsCL,
      r,
      [
        i + 1,
        s.code,
        `${s.name} (${RESOURCE_TYPE_LABELS[s.type]})`,
        s.unit,
        { formula: `THVT!F${tv}`, result: s.quantity },
        s.basePrice,
        { formula: `THVT!G${tv}`, result: s.price },
        { formula: `G${r}-F${r}`, result: s.price - s.basePrice },
        { formula: `E${r}*H${r}`, result: s.difference },
      ],
      { numFmts: { 5: QTY, 6: MONEY, 7: MONEY, 8: MONEY, 9: MONEY } },
    );
    r++;
  });
  row(
    wsCL,
    r,
    ['', '', 'TỔNG CỘNG', '', '', '', '', '', { formula: `SUM(I5:I${Math.max(5, r - 1)})`, result: calc.resourceSummary.reduce((a, s) => a + s.difference, 0) }],
    { bold: true, numFmts: { 9: MONEY } },
  );

  // ------------------------------------------------------------------ TDT
  setupSheet(wsTDT, [6, 46, 44, 11, 20], false);
  title(wsTDT, 1, 'BẢNG TỔNG HỢP DỰ TOÁN', 5);
  info(wsTDT, 2, projectInfo[0], 5);
  info(wsTDT, 3, `Căn cứ: ${calc.legalSet.label}`, 5);
  header(wsTDT, 4, ['STT', 'Khoản mục chi phí', 'Cách tính', 'Tỷ lệ (%)', 'Giá trị (đ)']);
  const s = calc.settings;
  const byCode = Object.fromEntries(calc.totalEstimate.lines.map((l) => [l.code, l]));
  const V = 'SUM(E5:E9)';
  const indexMode = s.contingencyPriceMode === 'index';
  const years = Math.max(1, Math.round(s.durationYears ?? 1));
  const dp2Formula = indexMode
    ? Array.from({ length: years }, (_, i) => `(${V}/${years})*((1+${s.priceIndexRate ?? 0}/100)^${i + 1}-1)`).join('+')
    : `${V}*D11/100`;
  const tdtRows: [string, string, string | number, Cell][] = [
    [byCode.Gxd.name, byCode.Gxd.formula, '', { formula: `TH!E${thTotalRow}`, result: byCode.Gxd.value }],
    [byCode.Gtb.name, 'Nhập', '', byCode.Gtb.value],
    [byCode.Gqlda.name, 'Nhập', '', byCode.Gqlda.value],
    [byCode.Gtv.name, 'Nhập', '', byCode.Gtv.value],
    [byCode.Gk.name, 'Nhập', '', byCode.Gk.value],
    [byCode.Gdp1.name, byCode.Gdp1.formula, s.contingencyQtyRate ?? 0, { formula: `${V}*D10/100`, result: byCode.Gdp1.value }],
    [byCode.Gdp2.name, byCode.Gdp2.formula, indexMode ? '' : s.contingencyPriceRate ?? 0, { formula: dp2Formula, result: byCode.Gdp2.value }],
  ];
  tdtRows.forEach((v, i) => row(wsTDT, 5 + i, [i + 1, v[0], v[1], v[2], v[3]], { numFmts: { 4: '0.00', 5: MONEY } }));
  row(wsTDT, 12, ['', 'TỔNG DỰ TOÁN', '', '', { formula: 'SUM(E5:E11)', result: calc.totalEstimate.total }], { bold: true, numFmts: { 5: MONEY } });
  info(wsTDT, 14, `Bằng chữ: ${amountInWords(calc.totalEstimate.total)}.`, 5);

  return wb;
}

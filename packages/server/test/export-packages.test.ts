import fs from 'node:fs';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { seedAdmin } from '../src/seed.js';

/**
 * Update 6 D — Excel export: one worksheet per hạng mục công trình (+ a "TỔNG HỢP" first sheet), exactly what the
 * grid applies: no zero unit price where the grid has one (problem #4), breakdown/diễn giải lines present and
 * un-numbered, a composite price shown once in its own column, and every package's exported total equal to the
 * grid's own total.
 */
const db = openDb(':memory:');
seedAdmin(db, 'admin', 'admin123');
const app = createApp(db, { serveWeb: false });
let token = '';
const A = () => ({ Authorization: `Bearer ${token}` });
const fx = (f: string) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
const expected = JSON.parse(fs.readFileSync(new URL('./fixtures/import_sinomag_like.expected.json', import.meta.url), 'utf8'));

beforeAll(async () => {
  const t = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' })).body.token;
  token = (await request(app).post('/api/auth/change-password').set({ Authorization: `Bearer ${t}` }).send({ oldPassword: 'admin123', newPassword: 'MatKhau2026!' })).body.token;
});

async function downloadExport(pid: number): Promise<ExcelJS.Workbook> {
  const r = await request(app)
    .get(`/api/projects/${pid}/export.xlsx`)
    .set(A())
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  expect(r.status).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(r.body);
  return wb;
}

const cellResult = (v: ExcelJS.CellValue): unknown => (v && typeof v === 'object' && 'result' in v ? (v as { result: unknown }).result : v);
const cellFormula = (v: ExcelJS.CellValue): string | null => (v && typeof v === 'object' && 'formula' in v ? (v as { formula: string }).formula : null);

describe('Update 6 D — Excel export (one sheet per hạng mục công trình)', () => {
  it('imports the Sinomag fixture then exports a workbook with TỔNG HỢP + one sheet per package', async () => {
    const fileId = (await request(app).post('/api/import/upload').set(A()).attach('file', fx('import_sinomag_like.xlsx'), 'import_sinomag_like.xlsx')).body.fileId;
    const pid = (await request(app).post('/api/projects').set(A()).send({ name: 'Sinomag export' })).body.id as number;
    await request(app).post(`/api/projects/${pid}/import-sheets`).set(A()).send({ fileId });
    const packages = (await request(app).get(`/api/projects/${pid}/work-packages`).set(A())).body as { id: number; name: string; sourceSheet: string | null }[];

    const wb = await downloadExport(pid);
    const names = wb.worksheets.map((w) => w.name);
    expect(names[0]).toBe('TỔNG HỢP');
    for (const p of packages) expect(names).toContain(p.name);

    const ct1Pkg = packages.find((p) => p.sourceSheet === expected.sheet_building_1)!;
    const ws = wb.getWorksheet(ct1Pkg.name)!;

    // header row
    expect(ws.getRow(4).getCell(1).value).toBe('STT');
    expect(ws.getRow(4).getCell(10).value).toBe('Đơn giá tổng hợp');
    expect(ws.getRow(4).getCell(14).value).toBe('Thành tiền');

    // problem #4: no zero price where the grid has one – "Ép cọc…" (row 6) has real VL/NC unit prices
    const epCoc = ws.getRow(6);
    expect(epCoc.getCell(3).value).toBe('Ép cọc BTCT 300x300'); // VNI decoded back to Unicode
    expect(epCoc.getCell(7).value).toBe(150000); // Đơn giá Vật liệu – a plain value, never hard-coded 0
    expect(epCoc.getCell(8).value).toBe(50000); // Đơn giá Nhân công
    expect(cellResult(epCoc.getCell(14).value)).toBe(17200000); // Thành tiền

    // breakdown ("diễn giải") lines: un-numbered, indented, their own partial quantity
    const l1 = ws.getRow(7);
    expect(l1.getCell(1).value).toBeFalsy(); // no STT
    expect(l1.getCell(3).value).toBe('    CT1(1 tim)');
    expect(l1.getCell(6).value).toBe(14);
    const l2 = ws.getRow(8);
    expect(l2.getCell(3).value).toBe('    CT2(2 tim)');
    expect(l2.getCell(6).value).toBe(72);

    // composite price (section C.4): shown ONCE in "Đơn giá tổng hợp", VL/NC/M stay blank, Thành tiền still correct
    const daoMong = ws.getRow(9);
    expect(daoMong.getCell(3).value).toBe('Đào móng băng bằng máy');
    expect(daoMong.getCell(7).value).toBeNull();
    expect(daoMong.getCell(8).value).toBeNull();
    expect(daoMong.getCell(10).value).toBe(25000);
    expect(cellResult(daoMong.getCell(14).value)).toBe(expected.ct1.composite_item.amount);
    expect(cellFormula(daoMong.getCell(14).value)).toMatch(/^F9\*J9$/);

    // "Cột C1" is the 4th item of CT01 (not the 1st of a 2nd Phần): PHẦN MÓNG/PHẦN KẾT CẤU are inline roman headings
    // inside the sheet's single detected block, which stay a "Nhóm: …" note (decision #103) rather than fragmenting
    // it into two Phần – so this package has exactly one Phần and STT runs 1..5 across all of it, continuously.
    const cotC1 = ws.getRow(13);
    expect(cotC1.getCell(3).value).toBe('Cột C1');
    expect(cotC1.getCell(1).value).toBe(4);
    expect(cotC1.getCell(16).value).toBe('Nhóm: PHẦN KẾT CẤU');

    // exported package total == the grid's own direct total for that package (Section 1 A's scoped calculate())
    const totalRow = ws.getRow(17);
    expect(totalRow.getCell(3).value).toBe('CỘNG TRƯỚC THUẾ');
    expect(cellResult(totalRow.getCell(14).value)).toBe(expected.ct1.total);

    // TỔNG HỢP links to the package sheet and caches the same total
    const th = wb.getWorksheet('TỔNG HỢP')!;
    const thRow = [...Array(10).keys()].map((i) => th.getRow(i + 5)).find((r) => r.getCell(2).value === ct1Pkg.name)!;
    expect(cellFormula(thRow.getCell(4).value)).toBe(`'${ct1Pkg.name}'!N17`);
    expect(cellResult(thRow.getCell(4).value)).toBe(expected.ct1.total);
  });

  it('every package total in the export matches its own scoped grid total; project total matches TỔNG HỢP', async () => {
    const fileId = (await request(app).post('/api/import/upload').set(A()).attach('file', fx('import_sinomag_like.xlsx'), 'import_sinomag_like.xlsx')).body.fileId;
    const pid = (await request(app).post('/api/projects').set(A()).send({ name: 'Sinomag export totals' })).body.id as number;
    await request(app).post(`/api/projects/${pid}/import-sheets`).set(A()).send({ fileId });
    const packages = (await request(app).get(`/api/projects/${pid}/work-packages`).set(A())).body as { id: number; name: string; sourceSheet: string | null }[];

    const wb = await downloadExport(pid);
    const totals: Record<string, number> = {
      [expected.sheet_building_1]: expected.ct1.total,
      [expected.sheet_building_2]: expected.ct2.total,
      [expected.sheet_office]: expected.a1.total,
      [expected.sheet_mep]: expected.dien.total,
    };
    let sum = 0;
    for (const [sheet, total] of Object.entries(totals)) {
      const pkg = packages.find((p) => p.sourceSheet === sheet)!;
      const scoped = (await request(app).get(`/api/projects/${pid}/work-packages/${pkg.id}/estimate`).set(A())).body;
      expect(scoped.total.total).toBe(total); // the grid's own total
      const ws = wb.getWorksheet(pkg.name)!;
      const lastRow = ws.lastRow!.number;
      expect(cellResult(ws.getRow(lastRow).getCell(14).value)).toBe(total); // the exported total
      sum += total;
    }
    const th = wb.getWorksheet('TỔNG HỢP')!;
    const cong = [...Array(12).keys()].map((i) => th.getRow(i + 4)).find((r) => r.getCell(2).value === 'CỘNG HẠNG MỤC CÔNG TRÌNH')!;
    expect(cellResult(cong.getCell(4).value)).toBe(sum);
  });

  it('round trip: re-importing an exported package sheet reproduces the same item count and total', async () => {
    const fileId = (await request(app).post('/api/import/upload').set(A()).attach('file', fx('import_sinomag_like.xlsx'), 'import_sinomag_like.xlsx')).body.fileId;
    const pid = (await request(app).post('/api/projects').set(A()).send({ name: 'Sinomag round trip' })).body.id as number;
    await request(app).post(`/api/projects/${pid}/import-sheets`).set(A()).send({ fileId });
    const packages = (await request(app).get(`/api/projects/${pid}/work-packages`).set(A())).body as { id: number; name: string; sourceSheet: string | null }[];
    const ct2Pkg = packages.find((p) => p.sourceSheet === expected.sheet_building_2)!;

    const wb = await downloadExport(pid);
    const ws = wb.getWorksheet(ct2Pkg.name)!;
    const single = new ExcelJS.Workbook();
    const copy = single.addWorksheet('DUTOAN');
    ws.eachRow((row, rowNumber) => {
      const vals: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => vals.push(cellResult(cell.value)));
      copy.getRow(rowNumber).values = vals;
    });
    const buf = await single.xlsx.writeBuffer();

    const pid2 = (await request(app).post('/api/projects').set(A()).send({ name: 'Sinomag round trip – reimport' })).body.id as number;
    const up = await request(app).post('/api/import/upload').set(A()).attach('file', Buffer.from(buf), 'roundtrip.xlsx');
    const r = await request(app).post(`/api/projects/${pid2}/import-estimate`).set(A()).send({ fileId: up.body.fileId });
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(expected.ct2.itemCount);
    const est = (await request(app).get(`/api/projects/${pid2}/estimate`).set(A())).body;
    expect(est.total.total).toBeCloseTo(expected.ct2.total, 0);
  });
});

import fs from 'node:fs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { parseBuffer } from '../src/importer.js';
import { runImportTt38 } from '../src/scripts/import-tt38.js';
import { seedAdmin } from '../src/seed.js';

// Update 4 A: import fixes – name column by content, merged cells, text numbers, VNI/TCVN3 per column.
const db = openDb(':memory:');
seedAdmin(db, 'admin', 'admin123');
runImportTt38(db);
const app = createApp(db, { serveWeb: false });
let token = '';
const A = () => ({ Authorization: `Bearer ${token}` });
const fx = (f: string) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url));

async function upload(file: string) {
  const r = await request(app).post('/api/import/upload').set(A()).attach('file', fx(file), file);
  expect(r.status).toBe(200);
  return r.body.fileId as string;
}
async function newProject(name: string) {
  return (await request(app).post('/api/projects').set(A()).send({ name, priceDate: '2026-09-01' })).body.id as number;
}
async function analyze(file: string, body: Record<string, unknown> = {}) {
  const pid = await newProject(file);
  const fileId = await upload(file);
  const a = (await request(app).post('/api/import/analyze').set(A()).send({ fileId, projectId: pid, ...body })).body;
  return { a, pid, fileId };
}
const items = (a: { rows: { type: string }[] }) => a.rows.filter((r) => r.type === 'item') as unknown as { code: string; name: string; unit: string; quantity: number; prices: Record<string, number | null>; amount: number | null; computedAmount: number; resolution?: { status: string; candidates: { code: string }[] } }[];

beforeAll(async () => {
  const t = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' })).body.token;
  token = (await request(app).post('/api/auth/change-password').set({ Authorization: `Bearer ${t}` }).send({ oldPassword: 'admin123', newPassword: 'MatKhau2026!' })).body.token;
});

describe('A1 import_wide.xlsx – merged headers, hidden columns, text numbers, long merged descriptions', () => {
  it('reads merged cells from the master cell and hides hidden columns', async () => {
    const [sheet] = await parseBuffer(fx('import_wide.xlsx'), 'import_wide.xlsx');
    expect(sheet.hiddenCols).toEqual([12, 13]);
    // description merged over C:D → both columns read the master value
    expect(sheet.rows[7][2]).toMatch(/^Đào móng băng/);
    expect(sheet.rows[7][3]).toBe(sheet.rows[7][2]);
    // header group "Đơn giá" merged over G:I
    expect(sheet.rows[4].slice(6, 9)).toEqual(['Đơn giá', 'Đơn giá', 'Đơn giá']);
  });

  it('maps by content: names are text, codes kept, numbers-as-text read, amounts reconcile', async () => {
    const { a } = await analyze('import_wide.xlsx');
    expect(a.header).toMatchObject({ headerRow: 4, headerRows: 2 });
    expect(a.header.mapping).toMatchObject({ stt: 0, code: 1, name: 2, unit: 4, quantity: 5, priceVL: 6, priceNC: 7, priceM: 8, amountVL: 9, amountNC: 10, amountM: 11 });
    expect(a.header.mapping.note).toBeUndefined(); // hidden column
    expect(a.columns.find((c: { letter: string }) => c.letter === 'M').hidden).toBe(true);
    expect(a.columns.some((c: { letter: string }) => c.letter === 'D')).toBe(false); // continuation of the merged description
    const list = items(a);
    expect(list).toHaveLength(6);
    for (const r of list) expect(Number.isNaN(Number(r.name.replace(/\s/g, '')))).toBe(true);
    expect(list.map((r) => r.code)).toEqual(['AB.11312', 'AF.11110', 'AF.61120', 'AF.12213', '', 'VD']);
    expect(list.map((r) => r.unit)).toEqual(['m3', 'm3', 'tấn', 'm3', 'm3', 'm2']);
    expect(list.map((r) => r.quantity)).toEqual([12.5, 3.2, 0.85, 8.4, 22, 18]);
    expect(list[0].prices).toMatchObject({ vl: 15000, nc: 180000, m: 0 });
    expect(list[2].prices).toMatchObject({ vl: 16800000, nc: 1500000, m: 480000 });
    // Thành tiền = KL × (VL+NC+M) matches the file's TT VL + TT NC + TT M
    expect(list[0].amount).toBe(2437500);
    expect(list.every((r) => Math.abs((r.amount ?? -1) - r.computedAmount) <= 1)).toBe(true);
    expect(a.reconciliation.allOk).toBe(true);
    expect(a.reconciliation.subtotals).toHaveLength(2);
    expect(a.reconciliation.grand).toMatchObject({ fileAmount: 100690500, computed: 100690500, ok: true });
    expect(a.zeroAmountRows).toEqual([]);
    // codes: old-style AF.12213 → proposal in family AF.122xx; no code → chapter AE only; VD = placeholder (GTT)
    expect(list[3].resolution).toMatchObject({ status: 'propose' });
    expect(list[3].resolution!.candidates[0].code).toMatch(/^AF\.122/);
    expect(list[4].resolution!.candidates.every((c) => c.code.startsWith('AE.'))).toBe(true);
    expect(list[5].resolution!.status).toBe('gtt');
  });

  it('shows the first 15 mapped rows as they will appear in the grid', async () => {
    const { a } = await analyze('import_wide.xlsx');
    expect(a.gridPreview.length).toBeLessThanOrEqual(15);
    expect(a.gridPreview[0]).toMatchObject({ type: 'category', name: 'PHẦN MÓNG', nameIsNumeric: false });
    expect(a.gridPreview[1]).toMatchObject({ type: 'item', stt: '1', code: 'AB.11312', unit: 'm3', quantity: 12.5, unitPrice: 195000, amount: 2437500 });
    expect(a.gridPreview.every((r: { nameIsNumeric: boolean }) => !r.nameIsNumeric)).toBe(true);
  });

  it('imports and keeps the file totals (no silent zero)', async () => {
    const { a, pid, fileId } = await analyze('import_wide.xlsx');
    const noCode = items(a).findIndex((r) => r.code === '');
    void noCode;
    const r = await request(app).post(`/api/projects/${pid}/import-estimate`).set(A()).send({ fileId, pricingOption: 'file' });
    expect(r.status).toBe(200);
    const est = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    expect(est.categories.map((c: { name: string }) => c.name)).toEqual(['PHẦN MÓNG', 'PHẦN THÂN']);
    expect(est.total.total).toBe(100690500);
    expect(est.categories.flatMap((c: { items: { amount: { total: number } }[] }) => c.items).every((i: { amount: { total: number } }) => i.amount.total > 0)).toBe(true);
  });
});

describe('A1 import_vni.xlsx – VNI / TCVN3 per column', () => {
  it.each([['VNI', 0], ['TCVN3', 1], ['Hon hop', 2]])('sheet %s: names and units become Unicode, raw kept', async (name, idx) => {
    const { a } = await analyze('import_vni.xlsx', { sheetIndex: idx });
    const list = items(a);
    expect(list.map((r) => r.unit)).toEqual(['m3', 'm3', 'tấn', 'm2']);
    expect(list[0].name).toBe('Đào móng băng bằng thủ công, đất cấp II');
    expect(list[2].name).toBe('Cốt thép móng, đường kính ≤18mm');
    expect(list.map((r) => r.code)).toEqual(['AB.11312', 'AF.11110', 'AF.61120', '']);
    expect(a.rows.find((r: { rawName: string | null }) => r.rawName)?.rawName).toMatch(/[^\x00-\x7F]/);
    expect(a.rows.find((r: { type: string }) => r.type === 'category').name.toUpperCase()).toBe(name === 'TCVN3' ? 'PHẦN MÓNG' : 'PHẦN MÓNG');
    expect(a.warnings.join(' ')).toMatch(/bảng mã cũ/);
  });

  it('the mixed sheet is decided per column (names VNI, units TCVN3, Unicode header)', async () => {
    const [, , mixed] = await parseBuffer(fx('import_vni.xlsx'), 'import_vni.xlsx');
    expect(mixed.columnEncodings?.[2]).toBe('vni');
    expect(mixed.rows[6][3]).toBe('tấn');
    expect(mixed.raw?.['6:3']).toBe('tÊn');
  });

  it('imports "taán" as "tấn" and the item unit is Unicode', async () => {
    const pid = await newProject('vni');
    const fileId = await upload('import_vni.xlsx');
    const r = await request(app).post(`/api/projects/${pid}/import-estimate`).set(A()).send({ fileId, sheetIndex: 0, pricingOption: 'file' });
    expect(r.status).toBe(200);
    const est = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    const list = est.categories.flatMap((c: { items: { unit: string; name: string; sourceRawText: string | null }[] }) => c.items);
    expect(list.map((i: { unit: string }) => i.unit)).toEqual(['m3', 'm3', 'tấn', 'm2']);
    expect(list[0].name).toBe('Đào móng băng bằng thủ công, đất cấp II');
    expect(list[0].sourceRawText).toBe('Ñaøo moùng baêng baèng thuû coâng, ñaát caáp II');
  });
});

describe('A1 import_nameoffset.xlsx – description after a spacer, price header with "công việc"', () => {
  it('finds the description column and does not confuse it with the price column', async () => {
    const { a } = await analyze('import_nameoffset.xlsx');
    expect(a.header.mapping).toMatchObject({ name: 3, code: 1, unit: 4, quantity: 5, unitPrice: 6, amount: 7 });
    expect(items(a).map((r) => r.name)).toEqual(['Đào móng băng bằng thủ công, đất cấp II', 'Bê tông lót móng, chiều rộng ≤250cm', 'Cốt thép móng D<=10']);
    expect(a.reconciliation.allOk).toBe(true);
  });

  it('content beats a misleading header: a numeric column labelled "Tên công tác" is never auto-selected', async () => {
    const XLSX = await import('xlsx');
    const aoa = [
      ['STT', 'Mã hiệu', 'Tên công tác', 'ĐVT', 'Khối lượng', 'Diễn giải công việc'],
      [1, 'AB.11312', 15000000, 'm3', 12.5, 'Đào móng băng bằng thủ công'],
      [2, 'AF.11110', 480000, 'm3', 3.2, 'Bê tông lót móng'],
      [3, null, 1382500, 'tấn', 0.85, 'Cốt thép móng D<=10'],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'S');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const pid = await newProject('misleading');
    const up = await request(app).post('/api/import/upload').set(A()).attach('file', buf, 'mislead.xlsx');
    const a = (await request(app).post('/api/import/analyze').set(A()).send({ fileId: up.body.fileId, projectId: pid })).body;
    expect(a.header.mapping.name).toBe(5);
    expect(a.detectionNotes.join(' ')).toMatch(/không dùng làm tên công việc/);
    expect(items(a).map((r) => r.name)).toEqual(['Đào móng băng bằng thủ công', 'Bê tông lót móng', 'Cốt thép móng D<=10']);
    // the user forces the numeric column: blocking warning, import refused unless confirmed
    const forced = (await request(app).post('/api/import/analyze').set(A()).send({ fileId: up.body.fileId, projectId: pid, headerRow: 0, headerRows: 1, mapping: { ...a.header.mapping, name: 2 } })).body;
    expect(forced.columnWarnings).toEqual([expect.objectContaining({ field: 'name', blocking: true, message: 'Cột này chủ yếu là số – không phải tên công việc' })]);
    expect(forced.gridPreview[0].nameIsNumeric).toBe(true);
    const bad = await request(app).post(`/api/projects/${pid}/import-estimate`).set(A()).send({ fileId: up.body.fileId, headerRow: 0, headerRows: 1, mapping: { ...a.header.mapping, name: 2 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/chủ yếu là số/);
    const ok = await request(app).post(`/api/projects/${pid}/import-estimate`).set(A()).send({ fileId: up.body.fileId, headerRow: 0, headerRows: 1, mapping: { ...a.header.mapping, name: 2 }, allowNumericName: true });
    expect(ok.body.error ?? '').toBe('');
    expect(ok.status).toBe(200);
  });
});

describe('A4/A9 codes and category headers', () => {
  it('a bare capitalised phrase without quantity is a category header, not a work item', async () => {
    const XLSX = await import('xlsx');
    const aoa = [
      ['STT', 'Mã hiệu', 'Nội dung công việc', 'ĐVT', 'Khối lượng', 'Đơn giá'],
      [null, null, 'ĐÀO ĐẤT'],
      [1, null, 'Đào đất móng bằng thủ công', 'm3', 10, 150000],
      [null, null, 'Ghi chú: khối lượng theo bản vẽ'],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'S');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const pid = await newProject('bare');
    const up = await request(app).post('/api/import/upload').set(A()).attach('file', buf, 'bare.xlsx');
    const a = (await request(app).post('/api/import/analyze').set(A()).send({ fileId: up.body.fileId, projectId: pid })).body;
    expect(a.counts).toMatchObject({ category: 1, item: 1, note: 1 });
    const r = items(a)[0].resolution!;
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates.every((c) => c.code.startsWith('AB.'))).toBe(true);
  });
});

describe('A8 "Sửa lại cột đã nhập": re-apply the mapping from the stored raw rows, undoable', () => {
  it('re-maps without re-uploading, replaces the imported items as a revision and undoes it', async () => {
    const pid = await newProject('remap');
    const fileId = await upload('import_wide.xlsx');
    // first import with the NC price column dropped by mistake
    const a = (await request(app).post('/api/import/analyze').set(A()).send({ fileId, projectId: pid })).body;
    const bad = { ...a.header.mapping };
    delete bad.priceNC;
    delete bad.amountNC;
    const r1 = await request(app).post(`/api/projects/${pid}/import-estimate`).set(A()).send({ fileId, headerRow: 4, headerRows: 2, mapping: bad, pricingOption: 'file' });
    expect(r1.status).toBe(200);
    expect(r1.body.importId).toBeGreaterThan(0);
    const est1 = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    expect(est1.total.total).toBeLessThan(100690500);
    const cat = est1.categories[0];
    const idsBefore = est1.categories.flatMap((c: { items: { id: number }[] }) => c.items.map((i) => i.id));

    const info = (await request(app).get(`/api/projects/${pid}/categories/${cat.id}/import-info`).set(A())).body;
    expect(info).toMatchObject({ imported: true, hasRaw: true, importId: r1.body.importId, fileName: 'import_wide.xlsx', sheetName: 'DUTOAN' });

    // reopen from the stored rows (no upload) → the analysis carries the stored mapping
    const re = await request(app).post(`/api/projects/${pid}/imports/${info.importId}/reopen`).set(A());
    expect(re.status).toBe(200);
    expect(re.body.header.mapping.priceNC).toBeUndefined();
    const fixed = { ...re.body.header.mapping, priceNC: 7, amountNC: 10 };
    const r2 = await request(app).post(`/api/projects/${pid}/import-estimate`).set(A()).send({ fileId: re.body.fileId, headerRow: 4, headerRows: 2, mapping: fixed, pricingOption: 'file', replaceImportId: info.importId });
    expect(r2.status).toBe(200);
    expect(r2.body.revisionId).toBeGreaterThan(0);
    const est2 = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    expect(est2.total.total).toBe(100690500);
    expect(est2.categories.map((c: { name: string }) => c.name)).toEqual(['PHẦN MÓNG', 'PHẦN THÂN']); // replaced, not duplicated
    expect(est2.categories.flatMap((c: { items: unknown[] }) => c.items)).toHaveLength(6);

    const revs = (await request(app).get(`/api/projects/${pid}/revisions`).set(A())).body;
    expect(revs[0]).toMatchObject({ kind: 'reimport', undone: false });
    expect((await request(app).post(`/api/projects/${pid}/revisions/${revs[0].id}/undo`).set(A())).status).toBe(200);
    const est3 = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    expect(est3.total.total).toBe(est1.total.total);
    expect(est3.categories.flatMap((c: { items: { id: number }[] }) => c.items.map((i) => i.id))).toEqual(idsBefore);
  });

  it('older imports without raw rows: ask for the file again and replace that category (undoable)', async () => {
    const pid = await newProject('legacy');
    const fileId = await upload('import_nameoffset.xlsx');
    await request(app).post(`/api/projects/${pid}/import-estimate`).set(A()).send({ fileId, pricingOption: 'file' });
    db.prepare('UPDATE estimate_items SET import_id = NULL WHERE category_id IN (SELECT id FROM categories WHERE project_id = ?)').run(pid);
    const est1 = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    const cat = est1.categories[0];
    const info = (await request(app).get(`/api/projects/${pid}/categories/${cat.id}/import-info`).set(A())).body;
    expect(info).toMatchObject({ imported: true, hasRaw: false, importId: null, fileName: 'import_nameoffset.xlsx' });
    const fileId2 = await upload('import_nameoffset.xlsx');
    const r = await request(app).post(`/api/projects/${pid}/import-estimate`).set(A()).send({ fileId: fileId2, pricingOption: 'file', replaceCategoryIds: [cat.id] });
    expect(r.status).toBe(200);
    const est2 = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    expect(est2.categories).toHaveLength(1);
    expect(est2.categories[0].items).toHaveLength(3);
    const revs = (await request(app).get(`/api/projects/${pid}/revisions`).set(A())).body;
    expect((await request(app).post(`/api/projects/${pid}/revisions/${revs[0].id}/undo`).set(A())).status).toBe(200);
    const est3 = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    expect(est3.categories[0].items.map((i: { id: number }) => i.id)).toEqual(cat.items.map((i: { id: number }) => i.id));
  });
});

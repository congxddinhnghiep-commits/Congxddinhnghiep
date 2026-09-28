import fs from 'node:fs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { parseBuffer } from '../src/importer.js';
import { runImportTt38 } from '../src/scripts/import-tt38.js';
import { seedAdmin } from '../src/seed.js';

// Update 3 acceptance test: the user's real file (test_import.xlsx, sheet DUTOAN) against the real TT38_2026 norms.
const db = openDb(':memory:');
seedAdmin(db, 'admin', 'admin123');
runImportTt38(db);
const app = createApp(db, { serveWeb: false });
let token = '';
const A = () => ({ Authorization: `Bearer ${token}` });
const fixture = fs.readFileSync(new URL('./fixtures/test_import.xlsx', import.meta.url));

async function upload() {
  const r = await request(app).post('/api/import/upload').set(A()).attach('file', fixture, 'test_import.xlsx');
  expect(r.status).toBe(200);
  return r.body.fileId as string;
}
async function newProject(name: string) {
  return (await request(app).post('/api/projects').set(A()).send({ name, priceDate: '2026-09-01' })).body.id as number;
}

beforeAll(async () => {
  const t = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' })).body.token;
  token = (await request(app).post('/api/auth/change-password').set({ Authorization: `Bearer ${t}` }).send({ oldPassword: 'admin123', newPassword: 'MatKhau2026!' })).body.token;
});

describe('A. formulas without cached values are evaluated', () => {
  it('reads the four Thành tiền cells', async () => {
    const [sheet] = await parseBuffer(fixture, 'test_import.xlsx');
    expect(sheet.rows.map((r) => r[7]).slice(5)).toEqual([1187500, 4384000, 15555000, 21126500]);
    expect(Object.keys(sheet.evaluated ?? {})).toHaveLength(4);
    expect(sheet.issues).toEqual([]);
  });

  it('flags a formula that cannot be evaluated instead of importing 0', async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([['Tên', 'KL', 'Tiền'], ['A', 2, null]]);
    ws['C2'] = { t: 'n', f: "'Sheet 2'!A1*2" } as never;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const [s] = await parseBuffer(buf, 'x.xlsx');
    expect(s.rows[1][2]).toBeNull();
    expect(s.issues?.some((i) => i.kind === 'formula_not_evaluated' || i.kind === 'external_link')).toBe(true);
  });
});

describe('A. analysis of test_import.xlsx', () => {
  it('detects the 2-row header without merged cells, the category, the items and the subtotal', async () => {
    const pid = await newProject('Update 3');
    const fileId = await upload();
    const a = (await request(app).post('/api/import/analyze').set(A()).send({ fileId, projectId: pid })).body;
    expect(a.header).toMatchObject({ headerRow: 2, headerRows: 2 });
    expect(a.header.mapping).toMatchObject({ stt: 0, code: 1, name: 2, unit: 3, quantity: 4, priceVL: 5, priceNC: 6, amount: 7, note: 8 });
    expect(a.counts).toMatchObject({ category: 1, item: 3, subtotal: 1 });
    const items = a.rows.filter((r: { type: string }) => r.type === 'item');
    expect(items.map((r: { amount: number }) => r.amount)).toEqual([1187500, 4384000, 15555000]);
    // every non-empty column is offered with its header text and 3 sample values
    const f = a.columns.find((c: { letter: string }) => c.letter === 'F');
    expect(f.header).toBe('Đơn giá 单价 / Vật liệu');
    expect(f.samples).toEqual(['15.000', '1.150.000', '16.800.000']);
    expect(f.label).toContain('F – Đơn giá 单价 / Vật liệu (vd: 15.000; 1.150.000; 16.800.000');
    expect(a.columns.find((c: { letter: string }) => c.letter === 'G').header).toBe('Đơn giá 单价 / Nhân công');
    expect(a.range).toEqual({ first: 5, last: 9 });
  });

  it('fidelity check with "keep the file prices": every figure matches the file', async () => {
    const pid = await newProject('Update 3 recon');
    const fileId = await upload();
    const a = (await request(app).post('/api/import/analyze').set(A()).send({ fileId, projectId: pid, pricingOption: 'file' })).body;
    const r = a.reconciliation;
    expect(r.items.map((i: { computed: number }) => i.computed)).toEqual([1187500, 4384000, 15555000]);
    expect(r.items.every((i: { ok: boolean }) => i.ok)).toBe(true);
    expect(r.subtotals).toHaveLength(1);
    expect(r.subtotals[0]).toMatchObject({ fileAmount: 21126500, computed: 21126500, ok: true });
    expect(r.grand).toMatchObject({ fileAmount: 21126500, computed: 21126500, ok: true });
    expect(r.allOk).toBe(true);
  });

  it('lets the user pick every column: G as "Đơn giá nhân công", none for the amount', async () => {
    const pid = await newProject('Update 3 mapping');
    const fileId = await upload();
    // drop the price columns, then map only F → VL and G → NC explicitly; no Thành tiền column
    const mapping = { stt: 0, code: 1, name: 2, unit: 3, quantity: 4, priceVL: 5, priceNC: 6, note: 8 };
    const a = (await request(app).post('/api/import/analyze').set(A()).send({ fileId, projectId: pid, headerRow: 2, headerRows: 2, mapping })).body;
    expect(a.header.mapping.priceNC).toBe(6);
    expect(a.header.mapping.amount).toBeUndefined();
    const item = a.rows.find((r: { type: string }) => r.type === 'item');
    expect(item.prices).toMatchObject({ vl: 15000, nc: 80000 });
    expect(item.amount).toBeNull();
    // the same, but G is (wrongly) mapped as the machine price → the total per unit is unchanged, the split differs
    const b = (await request(app).post('/api/import/analyze').set(A()).send({ fileId, projectId: pid, headerRow: 2, headerRows: 2, mapping: { ...mapping, priceNC: undefined, priceM: 6 } })).body;
    expect(b.rows.find((r: { type: string }) => r.type === 'item').prices).toMatchObject({ vl: 15000, nc: null, m: 80000 });
    // data range: only rows 7–8
    const c = (await request(app).post('/api/import/analyze').set(A()).send({ fileId, projectId: pid, firstRow: 7, lastRow: 8 })).body;
    expect(c.rows.filter((r: { type: string }) => r.type === 'item')).toHaveLength(2);
  });

  it('lets the user override the row type (a subtotal row can become a work item and back)', async () => {
    const pid = await newProject('Update 3 rowtype');
    const fileId = await upload();
    const base = (await request(app).post('/api/import/analyze').set(A()).send({ fileId, projectId: pid })).body;
    const sub = base.rows.find((r: { type: string }) => r.type === 'subtotal');
    const a = (await request(app).post('/api/import/analyze').set(A()).send({ fileId, projectId: pid, rowTypes: { [sub.index]: 'note' } })).body;
    expect(a.counts.subtotal ?? 0).toBe(0);
    expect(a.counts.note).toBe(1);
  });
});

describe('B. norm code mapping against TT38_2026', () => {
  it('AB.11213 keeps its code, is flagged as mismatching its name and offers đào móng codes', async () => {
    const pid = await newProject('Update 3 B1');
    const fileId = await upload();
    const a = (await request(app).post('/api/import/analyze').set(A()).send({ fileId, projectId: pid })).body;
    const row = a.rows.find((r: { code: string }) => r.code === 'AB.11213');
    expect(row.resolution.status).toBe('mismatch');
    expect(row.resolution.label).toBe('mã và tên công việc không khớp – cần kiểm tra');
    expect(row.resolution.code).toBe('AB.11213');
    expect(row.resolution.normName).toMatch(/Đào xúc đất.*Cấp đất – III/);
    expect(row.resolution.candidates).toHaveLength(3);
    expect(row.resolution.candidates.some((c: { code: string }) => /^AB\.11[34]/.test(c.code))).toBe(true);
    expect(row.resolution.askParams.join()).toMatch(/cấp đất/);
    expect(row.warnings.join()).toMatch(/AB\.11213/);
  });

  it('AF.11111 (old style, absent from TT38) → proposes AF.11110 with a reason', async () => {
    const pid = await newProject('Update 3 B2');
    const fileId = await upload();
    const a = (await request(app).post('/api/import/analyze').set(A()).send({ fileId, projectId: pid })).body;
    const row = a.rows.find((r: { code: string }) => r.code === 'AF.11111');
    expect(row.resolution.status).toBe('propose');
    expect(row.resolution.label).toBe('đề xuất chuyển mã');
    expect(row.resolution.code).toBeNull();
    expect(row.resolution.candidates[0]).toMatchObject({ code: 'AF.11110', name: 'Bê tông lót móng – Chiều rộng (cm) – ≤250' });
    expect(row.resolution.candidates[0].confidence).toBeGreaterThan(0.5);
    expect(row.resolution.candidates[0].reason).toMatch(/cùng họ mã AF\.111/);
  });

  it('the row without a code → AF.61110', async () => {
    const pid = await newProject('Update 3 B3');
    const fileId = await upload();
    const a = (await request(app).post('/api/import/analyze').set(A()).send({ fileId, projectId: pid })).body;
    const row = a.rows.find((r: { name: string }) => r.name.startsWith('Cốt thép móng'));
    expect(row.resolution.status).toBe('suggest');
    expect(row.resolution.candidates[0].code).toBe('AF.61110');
  });
});

describe('A + B. import: the grid mirrors the file', () => {
  it('imports with the file prices, accepted proposals, provenance and the expected totals', async () => {
    const pid = await newProject('Update 3 import');
    const fileId = await upload();
    const a = (await request(app).post('/api/import/analyze').set(A()).send({ fileId, projectId: pid })).body;
    const idx = (code: string) => a.rows.find((r: { code: string }) => r.code === code).index as number;
    const noCode = a.rows.find((r: { name: string }) => r.name.startsWith('Cốt thép móng')).index as number;
    const r = await request(app)
      .post(`/api/projects/${pid}/import-estimate`)
      .set(A())
      .send({ fileId, pricingOption: 'file', codeChoices: { [idx('AF.11111')]: 'AF.11110', [noCode]: 'AF.61110' } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ created: 3, categories: 1 });

    const est = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    expect(est.categories.map((c: { name: string }) => c.name)).toEqual(['PHẦN MÓNG']);
    const items = est.categories[0].items;
    expect(items.map((i: { name: string }) => i.name)).toEqual(['Đào đất móng bằng thủ công', 'Bê tông lót móng đá 4x6 M100', 'Cốt thép móng D<=10']);
    expect(items.map((i: { unit: string }) => i.unit)).toEqual(['m3', 'm3', 'tấn']);
    expect(items.map((i: { quantity: number }) => i.quantity)).toEqual([12.5, 3.2, 0.85]);
    expect(items.map((i: { amount: { total: number } }) => i.amount.total)).toEqual([1187500, 4384000, 15555000]);
    expect(est.total.total).toBe(21126500);
    expect(items[0].note).toBe('x');

    // file prices are item-level manual prices with the file/cell as source
    expect(items[0]).toMatchObject({ pricingMethod: 'CUSTOM_GTT', custom: { vl: 15000, nc: 80000, m: 0 } });
    expect(items[0].priceSource).toBe('File Excel test_import.xlsx, ô F6/G6');
    // raw source kept on every item (file / sheet / row / cell) and the raw code never overwritten
    expect(items[1].source).toMatchObject({ file: 'test_import.xlsx', sheet: 'DUTOAN', row: 7, code: 'AF.11111' });
    expect(items[1].source.cells).toMatchObject({ code: 'B7', quantity: 'E7', vl: 'F7', nc: 'G7', amount: 'H7' });
    expect(items.map((i: { normCodeRaw: string | null }) => i.normCodeRaw)).toEqual(['AB.11213', 'AF.11111', null]);
    // codes: kept (flagged), accepted proposal, accepted suggestion
    expect(items.map((i: { normCode: string }) => i.normCode)).toEqual(['AB.11213', 'AF.11110', 'AF.61110']);
    expect(items.map((i: { codeCheck: string }) => i.codeCheck)).toEqual(['mismatch', 'propose', 'suggest']);
    expect(items[0].codeCheckNote).toMatch(/không khớp|khác tên/);
    // norm-based price shown next to the file price for comparison, never added to the totals
    expect(items[1].normUnitCost).toBeTruthy();
    expect(items[1].analysis.length).toBeGreaterThan(0);
    expect(est.resourceSummary).toEqual([]);
  });

  it('"recompute from norms" prices by the norm instead of the file', async () => {
    const pid = await newProject('Update 3 norm option');
    const fileId = await upload();
    const r = await request(app).post(`/api/projects/${pid}/import-estimate`).set(A()).send({ fileId, pricingOption: 'norm' });
    expect(r.status).toBe(200);
    const est = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    expect(est.categories[0].items[0].pricingMethod).toBe('NORM_BASED');
    expect(est.total.total).not.toBe(21126500);
  });
});

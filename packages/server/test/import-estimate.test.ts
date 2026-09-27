import fs from 'node:fs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { seedAdmin, seedSampleData } from '../src/seed.js';

const db = openDb(':memory:');
seedAdmin(db, 'admin', 'admin123');
seedSampleData(db);
const app = createApp(db, { serveWeb: false });
let token = '';
const A = () => ({ Authorization: `Bearer ${token}` });
const fixture = (f: string) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url));

async function upload(file: string) {
  const r = await request(app).post('/api/import/upload').set(A()).attach('file', fixture(file), file);
  expect(r.status).toBe(200);
  return r.body.fileId as string;
}
async function newProject(name: string) {
  return (await request(app).post('/api/projects').set(A()).send({ name, priceDate: '2026-09-01' })).body.id as number;
}
async function items(pid: number) {
  const est = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
  return est.categories.flatMap((c: { name: string; items: object[] }) => c.items.map((i) => ({ ...i, category: c.name })));
}

beforeAll(async () => {
  const t = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' })).body.token;
  token = (await request(app).post('/api/auth/change-password').set({ Authorization: `Bearer ${t}` }).send({ oldPassword: 'admin123', newPassword: 'MatKhau2026!' })).body.token;
});

describe('import an existing estimate (F1-like)', () => {
  it('analyses: picks the DTCT sheet, detects columns and row types, checks codes', async () => {
    const pid = await newProject('F1');
    const fileId = await upload('du-toan-kieu-f1.xlsx');
    const a = (await request(app).post('/api/import/analyze').set(A()).send({ fileId, projectId: pid })).body;
    expect(a.sheets.map((s: { kind: string }) => s.kind)).toEqual(['tong_hop_chi_phi', 'du_toan_chi_tiet', 'tong_hop_vat_tu']);
    expect(a.sheetIndex).toBe(1);
    expect(a.header).toMatchObject({ headerRow: 3, headerRows: 2 });
    expect(a.counts).toMatchObject({ item: 8, category: 2, subtotal: 3 });
    expect(a.preview.length).toBeLessThanOrEqual(30);
    const unknown = a.rows.find((r: { code: string }) => r.code === 'ZZ.99999');
    expect(unknown.codeKnown).toBe(false);
    expect(unknown.warnings.join()).toMatch(/không có trong bộ định mức/);
  });

  it('imports with provenance, keeps unknown codes as source only, saves a template and can be undone', async () => {
    const pid = await newProject('F1 import');
    const fileId = await upload('du-toan-kieu-f1.xlsx');
    const r = (await request(app).post(`/api/projects/${pid}/import-estimate`).set(A()).send({ fileId, saveTemplate: 'Mẫu F1 công ty' })).body;
    expect(r.created).toBe(8);
    expect(r.withCode).toBe(7);
    const list = await items(pid);
    const cats = [...new Set(list.map((i: { category: string }) => i.category))];
    expect(cats).toEqual(['PHẦN MÓNG', 'PHẦN THÂN']);
    const bt = list.find((i: { normCode: string }) => i.normCode === 'AF.11213');
    expect(bt).toMatchObject({ codeStatus: 'imported', quantity: 45.6, unit: 'm3' });
    expect(bt.source).toMatchObject({ file: 'du-toan-kieu-f1.xlsx', sheet: 'DTCT', row: 10, quantity: 45.6, code: 'AF.11213' });
    const door = list.find((i: { name: string }) => i.name === 'Lắp đặt cửa nhôm kính hệ 55');
    expect(door).toMatchObject({ normCode: '', codeStatus: '' });
    expect(door.source.code).toBe('ZZ.99999');

    const tpl = (await request(app).get('/api/import/templates').query({ kind: 'estimate' }).set(A())).body;
    expect(tpl.map((t: { name: string }) => t.name)).toContain('Mẫu F1 công ty');

    // same layout (.xls copy) → template is recognised
    const f2 = await upload('du-toan-kieu-f1.xls');
    const a2 = (await request(app).post('/api/import/analyze').set(A()).send({ fileId: f2, projectId: pid, sheetIndex: 1 })).body;
    expect(a2.template.name).toBe('Mẫu F1 công ty');

    await request(app).post(`/api/projects/${pid}/assistant/undo`).set(A());
    expect(await items(pid)).toHaveLength(0);
  });
});

describe('import a free-form BOQ and auto-assign codes', () => {
  it('imports text numbers, skips totals/notes and auto-assigns confident codes', async () => {
    const pid = await newProject('BOQ');
    const fileId = await upload('boq-tu-do.xlsx');
    const r = (await request(app).post(`/api/projects/${pid}/import-estimate`).set(A()).send({ fileId, autoAssignThreshold: 0.8 })).body;
    expect(r.created).toBe(9);
    expect(r.withCode).toBe(0);
    expect(r.message).toMatch(/Đã gắn mã tự động cho \d+ công việc/);
    const list = await items(pid);
    const dao = list.find((i: { normCode: string }) => i.normCode === 'AB.25112');
    expect(dao.codeStatus).toBe('auto');
    expect(dao.quantity).toBeCloseTo(12.345, 10); // 1.234,5 m3 → 12,345 × 100m3
    expect(dao.source).toMatchObject({ quantity: 1234.5, unit: 'm3', row: 6 });
    const thep = list.find((i: { normCode: string }) => i.normCode === 'AF.61120');
    expect(thep.quantity).toBeCloseTo(4.25, 10); // 4.250 kg → 4,25 tấn
    const frame = list.find((i: { name: string }) => i.name.startsWith('Lắp dựng khung thép'));
    expect(frame.normCode).toBe(''); // no matching sample norm → stays "cần xem lại"
  });

  it('respects row-type overrides', async () => {
    const pid = await newProject('BOQ override');
    const fileId = await upload('boq-tu-do.xlsx');
    const a = (await request(app).post('/api/import/analyze').set(A()).send({ fileId, projectId: pid })).body;
    const zero = a.rows.find((r: { quantity: number; type: string }) => r.type === 'item' && r.quantity === 0);
    const r = (await request(app).post(`/api/projects/${pid}/import-estimate`).set(A()).send({ fileId, rowTypes: { [zero.index]: 'skip' } })).body;
    expect(r.created).toBe(8);
    expect(r.skipped).toBe(1);
  });
});

describe('import a bilingual Vietnamese–Chinese BOQ', () => {
  it('imports items under the bilingual categories', async () => {
    const pid = await newProject('Song ngữ');
    const fileId = await upload('song-ngu-viet-trung.xlsx');
    const r = (await request(app).post(`/api/projects/${pid}/import-estimate`).set(A()).send({ fileId })).body;
    expect(r.created).toBe(5);
    const list = await items(pid);
    expect([...new Set(list.map((i: { category: string }) => i.category))]).toEqual(['基础工程 / PHẦN MÓNG', '主体工程 / PHẦN THÂN']);
    const sugg = (await request(app).get(`/api/projects/${pid}/suggestions`).set(A())).body;
    const lot = sugg.find((s: { candidates: { code: string }[] }) => s.candidates[0]?.code === 'AF.11111');
    expect(lot).toBeTruthy();
  });
});

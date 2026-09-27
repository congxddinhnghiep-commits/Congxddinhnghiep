import Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { seedAdmin, seedSampleData } from '../src/seed.js';

async function login(app: ReturnType<typeof createApp>, username: string, pass: string, newPass: string) {
  let r = await request(app).post('/api/auth/login').send({ username, password: pass });
  r = await request(app).post('/api/auth/change-password').set({ Authorization: `Bearer ${r.body.token}` }).send({ oldPassword: pass, newPassword: newPass });
  return r.body.token as string;
}

const binary = (res: NodeJS.ReadableStream, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('migration of a Phase 1 database', () => {
  it('pins existing projects to TT11/2021 and keeps their result unchanged', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dutoan-')), 'old.db');
    // Phase 1 schema (subset) with one project and one historical norm
    const old = new Database(file);
    old.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'user', must_change_password INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER NOT NULL, name TEXT NOT NULL,
        owner_name TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', building_type TEXT NOT NULL DEFAULT 'dan_dung',
        price_base_date TEXT NOT NULL DEFAULT '', vat_rate REAL NOT NULL DEFAULT 8, cost_settings TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE estimate_items (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
        norm_code TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '', quantity REAL NOT NULL DEFAULT 0,
        quantity_formula TEXT, note TEXT);
      CREATE TABLE norms (code TEXT PRIMARY KEY, name TEXT NOT NULL, unit TEXT NOT NULL, grp TEXT NOT NULL DEFAULT '',
        name_search TEXT NOT NULL DEFAULT '', is_sample INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE resources (code TEXT PRIMARY KEY, name TEXT NOT NULL, unit TEXT NOT NULL, type TEXT NOT NULL,
        base_price REAL NOT NULL DEFAULT 0, name_search TEXT NOT NULL DEFAULT '', is_sample INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE norm_resources (norm_code TEXT NOT NULL REFERENCES norms(code) ON DELETE CASCADE, resource_code TEXT NOT NULL,
        consumption REAL NOT NULL, is_sample INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (norm_code, resource_code));
      INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin');
      INSERT INTO projects (owner_id, name) VALUES (1, 'Công trình cũ');
      INSERT INTO categories (project_id, name) VALUES (1, 'Móng');
      INSERT INTO resources (code, name, unit, type, base_price) VALUES ('X.NC', 'Nhân công bậc 3,5/7', 'công', 'NC', 100000000);
      INSERT INTO norms (code, name, unit) VALUES ('OLD.1', 'Công tác cũ', 'm3');
      INSERT INTO norm_resources (norm_code, resource_code, consumption) VALUES ('OLD.1', 'X.NC', 1);
      INSERT INTO estimate_items (category_id, norm_code, name, unit, quantity) VALUES (1, 'OLD.1', 'Công tác cũ', 'm3', 1);
    `);
    old.close();

    const db = openDb(file);
    const p = db.prepare('SELECT legal_set FROM projects WHERE id = 1').get() as { legal_set: string };
    expect(p.legal_set).toBe('TT11_2021');
    const n = db.prepare('SELECT dataset FROM norms WHERE code = ?').get('OLD.1') as { dataset: string };
    expect(n.dataset).toBe('TT12_2021');

    // T = 100.000.000 (NC only), dân dụng ≤ 15 tỷ, TT11 sample rates C 7,3 + LT 1,1 + TT 2,5 → GT 10,9 tr
    // TL = 110,9 × 5,5% = 6,0995 tr; G = 116,9995 tr; Gxd = 126,35946 tr (same as Phase 1)
    const app = createApp(db, { serveWeb: false });
    const { default: bcrypt } = await import('bcryptjs');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = 1').run(bcrypt.hashSync('MatKhau2026', 4));
    const t = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'MatKhau2026' })).body.token;
    const est = await request(app).get('/api/projects/1/estimate').set({ Authorization: `Bearer ${t}` });
    expect(est.body.legalSet.id).toBe('TT11_2021');
    expect(est.body.costSummary.Gxd).toBeCloseTo(126_359_460, 2);
    expect(est.body.warnings.join(' ')).toMatch(/lịch sử/);
  });
});

describe('legal sets via API', () => {
  const db = openDb(':memory:');
  seedAdmin(db, 'admin', 'admin123');
  seedSampleData(db);
  const app = createApp(db, { serveWeb: false });
  let admin = '';
  let user = '';
  const A = () => ({ Authorization: `Bearer ${admin}` });

  beforeAll(async () => {
    admin = await login(app, 'admin', 'admin123', 'QuanTri2026!');
    await request(app).post('/api/users').set(A()).send({ username: 'kysu', password: 'KySu2026!!', fullName: 'Kỹ sư', role: 'user' });
    user = await login(app, 'kysu', 'KySu2026!!', 'KySuMoi2026');
  });

  it('lists the legal register with provisional TT36 tables', async () => {
    const r = await request(app).get('/api/legal').set(A());
    expect(r.body.documents.find((d: { id: string }) => d.id === 'TT-36-2026').effective).toBe('2026-07-01');
    const tt36 = r.body.sets.find((s: { id: string }) => s.id === 'TT36_2026');
    expect(Object.keys(tt36.tables)).toEqual(['3.3', '3.4', '3.5', '3.6', '3.7']);
    expect(tt36.tables['3.3'].status).toBe('provisional');
    expect(tt36.tables['3.3'].source).toMatch(/Bảng 3\.3/);
  });

  it('picks the legal set from the price date and uses the matching norm dataset', async () => {
    const newP = await request(app).post('/api/projects').set(A()).send({ name: 'Mới', priceDate: '2026-08-15' });
    expect(newP.body.legalSet).toBe('TT36_2026');
    const oldP = await request(app).post('/api/projects').set(A()).send({ name: 'Cũ', priceDate: '2026-03-01' });
    expect(oldP.body.legalSet).toBe('TT11_2021');

    const n38 = await request(app).get('/api/norms/AF.11111').query({ dataset: 'TT38_2026' }).set(A());
    expect(n38.body.resources.map((r: { code: string }) => r.code)).toContain('N.NHOM3');
    const n12 = await request(app).get('/api/norms/AF.11111').query({ dataset: 'TT12_2021' }).set(A());
    expect(n12.body.resources.map((r: { code: string }) => r.code)).toContain('N.3.5');

    const est = await request(app).get(`/api/projects/${newP.body.id}/estimate`).set(A());
    const cat = est.body.categories[0].id;
    await request(app).post(`/api/projects/${newP.body.id}/items`).set(A()).send({ categoryId: cat, normCode: 'AF.11111', quantity: 10 });
    const e2 = await request(app).get(`/api/projects/${newP.body.id}/estimate`).set(A());
    expect(e2.body.resourceSummary.map((r: { code: string }) => r.code)).toContain('N.NHOM3');
    expect(e2.body.costSummary.lines.map((l: { code: string }) => l.code)).toContain('GXDNT');
    expect(e2.body.provisionalRates).toBe(true);
  });

  it('never switches the legal set without explicit confirmation', async () => {
    const p = (await request(app).post('/api/projects').set(A()).send({ name: 'X', priceDate: '2026-03-01' })).body;
    const r = await request(app).put(`/api/projects/${p.id}`).set(A()).send({ legalSet: 'TT36_2026' });
    expect(r.status).toBe(409);
    const ok = await request(app).put(`/api/projects/${p.id}`).set(A()).send({ legalSet: 'TT36_2026', confirmLegalSetChange: true });
    expect(ok.body.legalSet).toBe('TT36_2026');
    const est = await request(app).get(`/api/projects/${p.id}/estimate`).set(A());
    expect(est.body.warnings.join(' ')).toMatch(/trước ngày 2026-07-01/);
  });

  it('saves TT36 settings (Knc/Km, NC-based C, contingency by index)', async () => {
    const p = (await request(app).post('/api/projects').set(A()).send({ name: 'Trạm biến áp', buildingType: 'cong_nghiep' })).body;
    const r = await request(app)
      .put(`/api/projects/${p.id}/settings`)
      .set(A())
      .send({
        vatRate: 8,
        costSettings: { autoRates: true, cMode: 'NC', ncWorkType: 'lap_dat', nightShare: 20, nightPremium: 30, machineLaborShare: 25, contingencyPriceMode: 'index', priceIndexRate: 4, durationYears: 2 },
      });
    expect(r.status).toBe(200);
    const est = await request(app).get(`/api/projects/${p.id}/estimate`).set(A());
    expect(est.body.costSummary.Knc).toBeCloseTo(1.06, 10);
    expect(est.body.costSummary.lines.find((l: { code: string }) => l.code === 'C').source).toMatch(/Bảng 3\.4/);
    const bad = await request(app).put(`/api/projects/${p.id}/settings`).set(A()).send({ costSettings: { ncWorkType: 'khong_co' } });
    expect(bad.status).toBe(400);
  });

  it('only admins can mark rate tables verified', async () => {
    const denied = await request(app).put('/api/legal/TT36_2026/tables/3.3').set({ Authorization: `Bearer ${user}` }).send({ status: 'verified' });
    expect(denied.status).toBe(403);
    const ok = await request(app).put('/api/legal/TT36_2026/tables/3.3').set(A()).send({ status: 'verified' });
    expect(ok.body.status).toBe('verified');
    expect(ok.body.verifiedBy).toBe('admin');
    const lin = await request(app).put('/api/legal/TT36_2026/tables/3.3').set(A()).send({ interpolation: 'linear' });
    expect(lin.body.interpolation).toBe('linear');
    expect(lin.body.status).toBe('verified');
    await request(app).put('/api/legal/TT36_2026/tables/3.3').set(A()).send({ status: 'provisional', interpolation: 'none' });
  });

  it('puts legal basis and sources on the TH sheet', async () => {
    const p = (await request(app).post('/api/projects').set(A()).send({ name: 'Nhà A', priceDate: '2026-09-01' })).body;
    const cat = (await request(app).get(`/api/projects/${p.id}/estimate`).set(A())).body.categories[0].id;
    await request(app).post(`/api/projects/${p.id}/items`).set(A()).send({ categoryId: cat, normCode: 'AF.12214', quantity: 20 });
    const r = await request(app).get(`/api/projects/${p.id}/export.xlsx`).set(A()).buffer(true).parse(binary);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body);
    const th = wb.getWorksheet('TH')!;
    const text: string[] = [];
    th.eachRow((row) => row.eachCell((c) => text.push(String(typeof c.value === 'object' && c.value && 'formula' in c.value ? '=' + c.value.formula : c.value))));
    const all = text.join('\n');
    expect(all).toMatch(/Bộ căn cứ pháp lý: TT 36\/2026 \+ TT 38\/2026/);
    expect(all).toMatch(/Thông tư 36\/2026\/TT-BXD/);
    expect(all).toMatch(/Quyết định 1538\/QĐ-BXD/);
    expect(all).toMatch(/CẢNH BÁO: bảng tỷ lệ đang ở trạng thái TẠM/);
    expect(all).toMatch(/Bảng 3\.3 .*\[TẠM/);
    expect(all).toMatch(/GXDNT/);
    // nhà tạm formula references GXDTT, its rate and the VAT rate cell
    expect(all).toMatch(/=E\d+\*D\d+\/100\*\(1\+D\d+\/100\)/);
    // NC line = DTCT total × Knc
    expect(all).toMatch(/=DTCT!K\d+\*D\d+/);
  });
});

import ExcelJS from 'exceljs';
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
let projectId = 0;
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  const r = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
  token = r.body.token;
});

describe('auth', () => {
  it('rejects bad password', async () => {
    const r = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'x' });
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/Sai tên đăng nhập/);
  });

  it('forces password change on first login', async () => {
    const me = await request(app).get('/api/auth/me').set(auth());
    expect(me.body.mustChangePassword).toBe(true);
    const blocked = await request(app).get('/api/projects').set(auth());
    expect(blocked.status).toBe(403);
    const ch = await request(app).post('/api/auth/change-password').set(auth()).send({ oldPassword: 'admin123', newPassword: 'MatKhauMoi2024' });
    expect(ch.status).toBe(200);
    token = ch.body.token;
    const ok = await request(app).get('/api/projects').set(auth());
    expect(ok.status).toBe(200);
  });

  it('requires a token', async () => {
    expect((await request(app).get('/api/projects')).status).toBe(401);
  });
});

describe('projects and estimate', () => {
  it('creates a project with a default category', async () => {
    const r = await request(app).post('/api/projects').set(auth()).send({ name: 'Nhà ở 3 tầng', buildingType: 'dan_dung' });
    expect(r.status).toBe(200);
    projectId = r.body.id;
    const est = await request(app).get(`/api/projects/${projectId}/estimate`).set(auth());
    expect(est.body.categories[0].name).toBe('Hạng mục chung');
  });

  it('adds an item by norm code with a quantity formula', async () => {
    const est = await request(app).get(`/api/projects/${projectId}/estimate`).set(auth());
    const catId = est.body.categories[0].id;
    const r = await request(app)
      .post(`/api/projects/${projectId}/items`)
      .set(auth())
      .send({ categoryId: catId, normCode: 'af.11111', quantityFormula: '2*3,5*0,3' });
    expect(r.status).toBe(200);
    expect(r.body.normCode).toBe('AF.11111');
    expect(r.body.unit).toBe('m3');
    expect(r.body.quantity).toBeCloseTo(2.1);
    const est2 = await request(app).get(`/api/projects/${projectId}/estimate`).set(auth());
    expect(est2.body.total.total).toBeGreaterThan(0);
    expect(est2.body.costSummary.Gxd).toBeGreaterThan(est2.body.total.total);
  });

  it('searches norms without diacritics', async () => {
    const r = await request(app).get('/api/norms').query({ q: 'dao mong' }).set(auth());
    expect(r.body.map((n: { code: string }) => n.code)).toContain('AB.11312');
  });
});

describe('assistant', () => {
  it('asks to choose among ambiguous norms, then previews, confirms and undoes', async () => {
    const q = await request(app)
      .post(`/api/projects/${projectId}/assistant`)
      .set(auth())
      .send({ text: 'thêm 50 m3 bê tông cột mác 300 vào hạng mục phần thân' });
    expect(q.body.type).toBe('question');
    expect(q.body.options.length).toBeGreaterThanOrEqual(2);

    // choose the first norm → category "phần thân" does not exist → asks to create
    const q2 = await request(app).post(`/api/projects/${projectId}/assistant`).set(auth()).send({ intent: q.body.options[0].intent });
    expect(q2.body.type).toBe('question');
    expect(q2.body.options[0].label).toMatch(/Tạo hạng mục mới/);

    const preview = await request(app).post(`/api/projects/${projectId}/assistant`).set(auth()).send({ intent: q2.body.options[0].intent });
    expect(preview.body.type).toBe('preview');
    expect(preview.body.text).toMatch(/Tôi sẽ thêm: AF\.122\d4/);
    expect(preview.body.text).toMatch(/50 m3/);

    const c = await request(app).post(`/api/projects/${projectId}/assistant/confirm`).set(auth()).send({ action: preview.body.action });
    expect(c.status).toBe(200);
    let est = await request(app).get(`/api/projects/${projectId}/estimate`).set(auth());
    const than = est.body.categories.find((x: { name: string }) => x.name === 'phần thân');
    expect(than.items[0].quantity).toBe(50);

    const u = await request(app).post(`/api/projects/${projectId}/assistant/undo`).set(auth());
    expect(u.body.text).toMatch(/Đã hoàn tác/);
    est = await request(app).get(`/api/projects/${projectId}/estimate`).set(auth());
    expect(est.body.categories.find((x: { name: string }) => x.name === 'phần thân')).toBeUndefined();
  });

  it('converts price per tonne to per kg', async () => {
    const r = await request(app)
      .post(`/api/projects/${projectId}/assistant`)
      .set(auth())
      .send({ text: 'đổi giá xi măng PCB40 thành 1.650.000 đ/tấn' });
    expect(r.body.type).toBe('preview');
    expect(r.body.action).toEqual({ tool: 'setPrice', params: { resourceCode: 'V.XM40', price: 1650 } });
    await request(app).post(`/api/projects/${projectId}/assistant/confirm`).set(auth()).send({ action: r.body.action });
    const prices = await request(app).get(`/api/projects/${projectId}/prices`).set(auth());
    expect(prices.body.find((p: { code: string }) => p.code === 'V.XM40').projectPrice).toBe(1650);
  });

  it('asks for missing quantity and accepts a pending answer', async () => {
    const q = await request(app).post(`/api/projects/${projectId}/assistant`).set(auth()).send({ text: 'thêm AB.11312' });
    expect(q.body.type).toBe('question');
    expect(q.body.pending.field).toBe('quantity');
    const p = await request(app).post(`/api/projects/${projectId}/assistant`).set(auth()).send({ text: '12,5', pending: q.body.pending });
    expect(p.body.type).toBe('preview');
    expect(p.body.action.params.quantity).toBe(12.5);
  });
});

describe('excel export and import', () => {
  it('exports a workbook with formula sheets', async () => {
    const r = await request(app)
      .get(`/api/projects/${projectId}/export.xlsx`)
      .set(auth())
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(r.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body);
    // Update 6 D: "TỔNG HỢP" + one sheet per hạng mục công trình now come before the whole-project sheets.
    expect(wb.worksheets.map((w) => w.name)).toEqual(['TỔNG HỢP', 'Hạng mục chung', 'TH', 'DTCT', 'PTVT', 'THVT', 'CLVT', 'TDT']);
    const dt = wb.getWorksheet('DTCT')!;
    const item = dt.getRow(7);
    expect(item.getCell(2).value).toBe('AF.11111');
    expect((item.getCell(6).value as { formula: string }).formula).toBe('2*3.5*0.3');
    expect((item.getCell(10).value as { formula: string }).formula).toBe('F7*G7');
    expect(dt.getCell('A1').font?.name).toBe('Times New Roman');
  });

  it('imports norms from CSV with column mapping', async () => {
    const csv = 'Mã hiệu ĐM,Tên công tác,Đơn vị ĐM,Mã VT,Tên VT,Đơn vị VT,Loại,Hao phí,Đơn giá\n' +
      'ZZ.00001,Công tác thử nghiệm,m2,V.XM40,Xi măng PCB40,kg,VL,10,\n' +
      ',,,N.TEST,Nhân công thử,công,NC,0.5,300000\n';
    const up = await request(app).post('/api/import/upload').set(auth()).attach('file', Buffer.from(csv), 'dm.csv').field('target', 'norms');
    expect(up.status).toBe(200);
    expect(up.body.headerRow).toBe(0);
    const mapping = { normCode: 0, normName: 1, normUnit: 2, resourceCode: 3, resourceName: 4, resourceUnit: 5, resourceType: 6, consumption: 7, price: 8 };
    const ap = await request(app).post('/api/import/apply').set(auth()).send({ fileId: up.body.fileId, target: 'norms', headerRow: 0, mapping });
    expect(ap.status).toBe(200);
    expect(ap.body.count).toBe(2);
    const n = await request(app).get('/api/norms/ZZ.00001').set(auth());
    expect(n.body.resources).toHaveLength(2);
    expect(n.body.resources.find((r: { code: string }) => r.code === 'N.TEST').type).toBe('NC');
  });
});

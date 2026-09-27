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
let pid = 0;
let cat = 0;

beforeAll(async () => {
  const t = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' })).body.token;
  token = (await request(app).post('/api/auth/change-password').set({ Authorization: `Bearer ${t}` }).send({ oldPassword: 'admin123', newPassword: 'MatKhau2026!' })).body.token;
  pid = (await request(app).post('/api/projects').set(A()).send({ name: 'Nhà xưởng', priceDate: '2026-09-01' })).body.id;
  cat = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body.categories[0].id;
  // Items typed by name only (no norm code), as after importing a BOQ
  for (const [name, unit, quantity] of [
    ['Đào móng bằng máy đào, đất cấp II', 'm3', 250],
    ['Bê tông móng M250 đá 1x2', 'm3', 32.5],
    ['Bê tông cột mác 300', 'm3', 12],
    ['Cốt thép móng đk ≤10mm', 'kg', 1500],
  ] as const) {
    await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: cat, name, unit, quantity });
  }
});

describe('automatic code assignment', () => {
  it('suggests top-5 candidates with confidence and explanation', async () => {
    const r = await request(app).get(`/api/projects/${pid}/suggestions`).set(A());
    expect(r.body).toHaveLength(4);
    const first = r.body[0].candidates[0];
    expect(first.code).toBe('AB.25112');
    expect(first.confidence).toBeGreaterThanOrEqual(0.8);
    expect(first.why).toMatch(/quy đổi m3 → 100m3/);
  });

  it('previews, applies (status auto, quantity converted, source kept), blocks approval, then confirms', async () => {
    const prev = (await request(app).post(`/api/projects/${pid}/auto-assign/preview`).set(A()).send({ threshold: 0.8 })).body;
    expect(prev.assign.map((a: { normCode: string }) => a.normCode).sort()).toEqual(['AB.25112', 'AF.11213', 'AF.61110']);
    expect(prev.below).toBe(1); // "Bê tông cột mác 300" is ambiguous (tiết diện)

    const r = await request(app).post(`/api/projects/${pid}/auto-assign`).set(A()).send({ assignments: prev.assign });
    expect(r.body.text).toMatch(/Đã gắn mã tự động cho 3 công việc/);

    const items = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body.categories[0].items;
    const dao = items.find((i: { normCode: string }) => i.normCode === 'AB.25112');
    expect(dao.codeStatus).toBe('auto');
    expect(dao.unit).toBe('100m3');
    expect(dao.quantity).toBeCloseTo(2.5, 10);
    expect(dao.source).toMatchObject({ description: 'Đào móng bằng máy đào, đất cấp II', quantity: 250, unit: 'm3' });
    const thep = items.find((i: { normCode: string }) => i.normCode === 'AF.61110');
    expect(thep.quantity).toBeCloseTo(1.5, 10);

    const blocked = await request(app).post(`/api/projects/${pid}/approve`).set(A());
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/3 công việc gắn mã tự động/);

    const ids = items.filter((i: { codeStatus: string }) => i.codeStatus === 'auto').map((i: { id: number }) => i.id);
    expect((await request(app).post(`/api/projects/${pid}/confirm-codes`).set(A()).send({ itemIds: ids })).body.confirmed).toBe(3);
    const ok = await request(app).post(`/api/projects/${pid}/approve`).set(A());
    expect(ok.body.status).toBe('approved');
    // any later change returns the estimate to draft
    await request(app).put(`/api/projects/${pid}/items/${ids[0]}`).set(A()).send({ note: 'sửa' });
    expect((await request(app).get(`/api/projects/${pid}`).set(A())).body.status).toBe('draft');
  });

  it('one-click accept of a suggestion marks the code confirmed', async () => {
    const pending = (await request(app).get(`/api/projects/${pid}/suggestions`).set(A())).body;
    expect(pending).toHaveLength(1);
    const it0 = pending[0];
    const r = await request(app).post(`/api/projects/${pid}/items/${it0.itemId}/assign-code`).set(A()).send({ normCode: 'AF.12224' });
    expect(r.body.codeStatus).toBe('confirmed');
    expect(r.body.source.description).toBe('Bê tông cột mác 300');
  });

  it('assistant command previews and confirms, and can be undone', async () => {
    await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: cat, name: 'Trát tường trong dày 1,5cm', unit: 'm2', quantity: 300 });
    const q = await request(app).post(`/api/projects/${pid}/assistant`).set(A()).send({ text: 'gắn mã cho các công việc chưa có mã' });
    expect(q.body.type).toBe('preview');
    expect(q.body.text).toMatch(/AK\.21124/);
    await request(app).post(`/api/projects/${pid}/assistant/confirm`).set(A()).send({ action: q.body.action });
    let items = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body.categories[0].items;
    expect(items.find((i: { normCode: string }) => i.normCode === 'AK.21124').codeStatus).toBe('auto');
    await request(app).post(`/api/projects/${pid}/assistant/undo`).set(A());
    items = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body.categories[0].items;
    const back = items.find((i: { name: string }) => i.name === 'Trát tường trong dày 1,5cm');
    expect(back.normCode).toBe('');
    expect(back.quantity).toBe(300);
  });

  it('norm search accepts code prefixes and abbreviations', async () => {
    const byCode = (await request(app).get('/api/norms').query({ q: 'af11' }).set(A())).body.map((n: { code: string }) => n.code);
    expect(byCode).toEqual(['AF.11111', 'AF.11213', 'AF.11214']);
    const abbr = (await request(app).get('/api/norms').query({ q: 'VK cot' }).set(A())).body;
    expect(abbr[0].code).toBe('AF.81132');
    const bt = (await request(app).get('/api/norms').query({ q: 'bt san M300' }).set(A())).body;
    expect(bt[0].code).toBe('AF.12414');
  });
});

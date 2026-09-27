import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { runImportTt38 } from '../src/scripts/import-tt38.js';
import { runImportTt38Pl7 } from '../src/scripts/import-tt38-pl7.js';
import { seedAdmin } from '../src/seed.js';

// Real TT38_2026 norms + Phụ lục VII mix designs (no sample data), so a norm's actual "Vữa bê tông"
// resource line is available to expand – exercises the whole import → calculate() pipeline.
const db = openDb(':memory:');
seedAdmin(db, 'admin', 'admin123');
runImportTt38(db);
runImportTt38Pl7(db);
const app = createApp(db, { serveWeb: false });
let token = '';
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  const t = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' })).body.token;
  token = (await request(app).post('/api/auth/change-password').set({ Authorization: `Bearer ${t}` }).send({ oldPassword: 'admin123', newPassword: 'MatKhau2026!' })).body.token;
});

describe('mix designs (TT 38/2026 Phụ lục VII)', () => {
  it('suggests concrete mixes by grade', async () => {
    const r = await request(app).get('/api/mix-designs').query({ kind: 'concrete', grade: '250' }).set(auth());
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(3);
    expect(r.body.every((m: { kind: string; grade: string }) => m.kind === 'concrete' && m.grade === '250')).toBe(true);
    expect(r.body.map((m: { code: string }) => m.code)).toContain('11.11114');
  });

  it('returns a mix design with its constituent materials', async () => {
    const r = await request(app).get('/api/mix-designs/11.11114').set(auth());
    expect(r.status).toBe(200);
    expect(r.body.grade).toBe('250');
    const names = r.body.materials.map((m: { material: string }) => m.material);
    expect(names).toEqual(expect.arrayContaining(['Xi măng', 'Cát vàng', 'Đá dăm', 'Nước']));
    expect(r.body.materials.every((m: { resourceCode: string | null }) => m.resourceCode)).toBe(true);
  });

  it('expands a norm\'s "Vữa..." resource into cement/sand/stone/water once a mix code is set', async () => {
    const proj = await request(app).post('/api/projects').set(auth()).send({ name: 'CT thử nghiệm cấp phối', buildingType: 'dan_dung' });
    const pid = proj.body.id;
    const before = await request(app).get(`/api/projects/${pid}/estimate`).set(auth());
    const catId = before.body.categories[0].id;

    const item = await request(app).post(`/api/projects/${pid}/items`).set(auth()).send({ categoryId: catId, normCode: 'AF.11110', quantity: 10 });
    expect(item.status).toBe(200);
    const itemId = item.body.id;

    // Before choosing a mix: the norm's "Vữa bê tông" line is an unpriced placeholder (basePrice 0).
    const est1 = await request(app).get(`/api/projects/${pid}/estimate`).set(auth());
    const it1 = est1.body.categories[0].items.find((x: { id: number }) => x.id === itemId);
    expect(it1.analysis.some((a: { name: string }) => a.name === 'Vữa bê tông')).toBe(true);
    expect(it1.unitCost.vl).toBe(0);

    // Set a project price for the mix's cement so the expanded VL cost is non-zero and checkable.
    const mix = (await request(app).get('/api/mix-designs/11.11114').set(auth())).body;
    const cement = mix.materials.find((m: { material: string }) => m.material === 'Xi măng');
    await request(app).put(`/api/projects/${pid}/prices/${encodeURIComponent(cement.resourceCode)}`).set(auth()).send({ price: 1500 });

    const setMix = await request(app).put(`/api/projects/${pid}/items/${itemId}/mix`).set(auth()).send({ mixCode: '11.11114' });
    expect(setMix.status).toBe(200);
    expect(setMix.body.mixCode).toBe('11.11114');

    const est2 = await request(app).get(`/api/projects/${pid}/estimate`).set(auth());
    const it2 = est2.body.categories[0].items.find((x: { id: number }) => x.id === itemId);
    expect(it2.analysis.some((a: { name: string }) => a.name === 'Vữa bê tông')).toBe(false);
    const xm = it2.analysis.find((a: { resourceCode: string }) => a.resourceCode === cement.resourceCode);
    expect(xm).toBeDefined();
    // norm vữa consumption (1,025) × mix cement qty (360 kg) × 10 (item qty)
    expect(xm.quantity).toBeCloseTo(1.025 * 360 * 10, 4);
    expect(it2.unitCost.vl).toBeGreaterThan(0);

    // Clearing the mix code reverts to the unpriced placeholder.
    await request(app).put(`/api/projects/${pid}/items/${itemId}/mix`).set(auth()).send({ mixCode: null });
    const est3 = await request(app).get(`/api/projects/${pid}/estimate`).set(auth());
    const it3 = est3.body.categories[0].items.find((x: { id: number }) => x.id === itemId);
    expect(it3.unitCost.vl).toBe(0);
  });

  it('rejects an unknown mix code', async () => {
    const proj = await request(app).post('/api/projects').set(auth()).send({ name: 'CT 2', buildingType: 'dan_dung' });
    const pid = proj.body.id;
    const before = await request(app).get(`/api/projects/${pid}/estimate`).set(auth());
    const catId = before.body.categories[0].id;
    const item = await request(app).post(`/api/projects/${pid}/items`).set(auth()).send({ categoryId: catId, normCode: 'AF.11110', quantity: 1 });
    const r = await request(app).put(`/api/projects/${pid}/items/${item.body.id}/mix`).set(auth()).send({ mixCode: 'khong-ton-tai' });
    expect(r.status).toBe(404);
  });
});

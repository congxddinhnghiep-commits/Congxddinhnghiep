import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { seedAdmin } from '../src/seed.js';

// Update 5 — element-based quantity take-off: server wiring (sections A-F) and acceptance test I.10.
const db = openDb(':memory:');
seedAdmin(db, 'admin', 'admin123');
const app = createApp(db, { serveWeb: false });
let token = '';
const A = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  const t = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' })).body.token;
  token = (await request(app).post('/api/auth/change-password').set({ Authorization: `Bearer ${t}` }).send({ oldPassword: 'admin123', newPassword: 'MatKhau2026!' })).body.token;
});

async function newProject(name: string) {
  const p = (await request(app).post('/api/projects').set(A()).send({ name })).body;
  const est = (await request(app).get(`/api/projects/${p.id}/estimate`).set(A())).body;
  return { pid: p.id as number, catId: est.categories[0].id as number };
}

const MONG_DON_M1 = { a: 1.8, b: 1.2, h: 0.5, t_l: 0.1, e_l: 0.1, H_d: 1.5, e_tc: 0.3, m: 0 };

describe('Update 5 — element types metadata', () => {
  it('lists element type labels and defaults', async () => {
    const r = await request(app).get('/api/takeoff/element-types').set(A());
    expect(r.status).toBe(200);
    expect(r.body.labels.mong_don).toBe('Móng đơn');
    expect(r.body.defaults.cot.H).toBe(3);
  });
});

describe('Update 5 — stories', () => {
  it('creates, lists and deletes a story', async () => {
    const { pid } = await newProject('Bóc KL – tầng');
    const s = (await request(app).post(`/api/projects/${pid}/stories`).set(A()).send({ name: 'Trệt', heightM: 3.6 })).body;
    expect(s.name).toBe('Trệt');
    const list = (await request(app).get(`/api/projects/${pid}/stories`).set(A())).body;
    expect(list).toHaveLength(1);
    await request(app).delete(`/api/projects/${pid}/stories/${s.id}`).set(A());
    expect((await request(app).get(`/api/projects/${pid}/stories`).set(A())).body).toHaveLength(0);
  });
});

describe('Update 5 — manual calculation (section E)', () => {
  it('I.9 evaluates a named-variable expression with a trailing comment', async () => {
    const { pid } = await newProject('Bóc KL – tính tay');
    const r = await request(app)
      .post(`/api/projects/${pid}/takeoff/manual/eval`)
      .set(A())
      .send({ mode: 'expression', expression: 'a=3,5; b=4,2; 2*(a+b)*0,2*3 // tường bao' });
    expect(r.status).toBe(200);
    expect(r.body.result).toBeCloseTo(9.24, 3);
  });

  it('I.8 computes the quick table row (n, A, L, H)', async () => {
    const { pid } = await newProject('Bóc KL – bảng nhanh');
    const r = await request(app)
      .post(`/api/projects/${pid}/takeoff/manual`)
      .set(A())
      .send({ mode: 'quick', quick: { n: 4, a: 2.5, l: 6, h: 3 }, drawingName: 'Mái tôn' });
    expect(r.body.quick).toMatchObject({ area: 10, length: 24, volume: 30, lateralArea: 72 });
    const list = (await request(app).get(`/api/projects/${pid}/takeoff/manual`).set(A())).body;
    expect(list).toHaveLength(1);
  });
});

describe('Update 5 — rebar schedule (section D)', () => {
  it('I.7 computes total length/weight and the TT38 diameter group', async () => {
    const { pid } = await newProject('Bóc KL – thép');
    const r = await request(app)
      .put(`/api/projects/${pid}/takeoff/rebar`)
      .set(A())
      .send({ cauKien: 'M1', diaMm: 16, chieuDai1ThanhMm: 6200, soThanh1CauKien: 12, soCauKien: 8 });
    expect(r.body.computed.tongChieuDaiM).toBeCloseTo(595.2, 3);
    expect(r.body.computed.tongTrongLuongKg).toBeCloseTo(940.416, 3);
    expect(r.body.computed.group).toBe('le18');
  });
});

describe('Update 5 I.10 — push to estimate, re-push, override, undo', () => {
  it('creates items, re-push updates quantities, keeps a manual override and prices, undo restores', async () => {
    const { pid, catId } = await newProject('Bóc KL – đẩy dự toán');

    const el = (await request(app).post(`/api/projects/${pid}/takeoff/elements`).set(A()).send({ type: 'mong_don', name: 'M1', count: 10, categoryId: catId, params: MONG_DON_M1 })).body.element;

    // preview: every task is a brand-new item
    const preview1 = (await request(app).post(`/api/projects/${pid}/takeoff/push/preview`).set(A()).send({})).body;
    expect(preview1.rows).toHaveLength(5);
    expect(preview1.rows.every((r: { kind: string }) => r.kind === 'create')).toBe(true);

    const apply1 = (await request(app).post(`/api/projects/${pid}/takeoff/push/apply`).set(A()).send({})).body;
    expect(apply1.created).toBe(5);
    expect(apply1.updated).toBe(0);
    const rev1 = apply1.revisionId as number;
    expect(rev1).toBeGreaterThan(0);

    const est1 = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    const items1 = est1.categories.find((c: { id: number }) => c.id === catId).items;
    expect(items1).toHaveLength(5);
    const btMong1 = items1.find((i: { name: string }) => i.name === 'Bê tông móng');
    const btLot1 = items1.find((i: { name: string }) => i.name === 'Bê tông lót móng');
    expect(btMong1.quantity).toBeCloseTo(10.8, 3);
    expect(btLot1.quantity).toBeCloseTo(2.8, 3);

    // a custom price on "Bê tông móng" must survive the re-push below
    await request(app)
      .put(`/api/projects/${pid}/items/${btMong1.id}/pricing`)
      .set(A())
      .send({ pricingMethod: 'CUSTOM_GTT', custom: { vl: 1_000_000, nc: 200_000, m: 50_000 }, priceSource: 'Báo giá test' });

    // a manual override on the element's "Bê tông lót móng" task must survive re-generation
    await request(app)
      .put(`/api/projects/${pid}/takeoff/elements/${el.id}`)
      .set(A())
      .send({ overrides: { bt_lot: { value: 5, reason: 'Theo bản vẽ thi công' } } });

    // change count 10 -> 12 and re-push
    await request(app).put(`/api/projects/${pid}/takeoff/elements/${el.id}`).set(A()).send({ count: 12 });
    const preview2 = (await request(app).post(`/api/projects/${pid}/takeoff/push/preview`).set(A()).send({})).body;
    expect(preview2.rows.every((r: { kind: string }) => r.kind === 'update')).toBe(true);
    expect(preview2.conflicts).toBe(0);

    const apply2 = (await request(app).post(`/api/projects/${pid}/takeoff/push/apply`).set(A()).send({})).body;
    expect(apply2.created).toBe(0);
    expect(apply2.updated).toBe(5);
    const rev2 = apply2.revisionId as number;

    const est2 = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    const items2 = est2.categories.find((c: { id: number }) => c.id === catId).items;
    const btMong2 = items2.find((i: { name: string }) => i.name === 'Bê tông móng');
    const btLot2 = items2.find((i: { name: string }) => i.name === 'Bê tông lót móng');
    expect(btMong2.quantity).toBeCloseTo(12.96, 3); // 1.8*1.2*0.5*12
    expect(btLot2.quantity).toBeCloseTo(5, 3); // manual override survives re-generation
    // price kept
    expect(btMong2.pricingMethod).toBe('CUSTOM_GTT');
    expect(btMong2.custom).toMatchObject({ vl: 1_000_000, nc: 200_000, m: 50_000 });

    // undo the re-push: quantities go back to the first push, prices/override are untouched
    await request(app).post(`/api/projects/${pid}/takeoff/push/${rev2}/undo`).set(A());
    const est3 = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    const items3 = est3.categories.find((c: { id: number }) => c.id === catId).items;
    expect(items3.find((i: { name: string }) => i.name === 'Bê tông móng').quantity).toBeCloseTo(10.8, 3);
    expect(items3.find((i: { name: string }) => i.name === 'Bê tông lót móng').quantity).toBeCloseTo(2.8, 3);
    expect(items3.find((i: { name: string }) => i.name === 'Bê tông móng').pricingMethod).toBe('CUSTOM_GTT');

    // cannot undo a non-latest revision (rev1 is now behind rev2's undo marker, but once rev2 is undone, rev1 is latest active)
    await request(app).post(`/api/projects/${pid}/takeoff/push/${rev1}/undo`).set(A());
    const est4 = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    expect(est4.categories.find((c: { id: number }) => c.id === catId).items).toHaveLength(0);
  });
});

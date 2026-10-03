import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { seedAdmin } from '../src/seed.js';

/**
 * Update 6 E — price sources (dia_phuong / ho_so / chiet_tinh / thu_cong) and work-package mode (bao_gia / du_toan_tt36).
 */
const db = openDb(':memory:');
seedAdmin(db, 'admin', 'admin123');
const app = createApp(db, { serveWeb: false });
let token = '';
const A = () => ({ Authorization: `Bearer ${token}` });

// A test norm with one normally-priced resource and one zero-priced ("thiếu giá") resource.
db.prepare(`INSERT INTO norms (dataset, code, name, unit) VALUES ('TT38_2026', 'ZZ.TEST1', 'Công tác thử nghiệm', 'm3')`).run();
db.prepare(`INSERT INTO resources (code, name, unit, type, base_price) VALUES ('R.VL1', 'Vật liệu thử 1', 'kg', 'VL', 100000)`).run();
db.prepare(`INSERT INTO resources (code, name, unit, type, base_price) VALUES ('R.VL2', 'Vật liệu thử 2 (chưa có giá)', 'kg', 'VL', 0)`).run();
db.prepare(`INSERT INTO norm_resources (dataset, norm_code, resource_code, consumption) VALUES ('TT38_2026', 'ZZ.TEST1', 'R.VL1', 2)`).run();
db.prepare(`INSERT INTO norm_resources (dataset, norm_code, resource_code, consumption) VALUES ('TT38_2026', 'ZZ.TEST1', 'R.VL2', 1)`).run();

beforeAll(async () => {
  const t = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' })).body.token;
  token = (await request(app).post('/api/auth/change-password').set({ Authorization: `Bearer ${t}` }).send({ oldPassword: 'admin123', newPassword: 'MatKhau2026!' })).body.token;
});

async function newProject(name: string) {
  const p = (await request(app).post('/api/projects').set(A()).send({ name, priceDate: '2026-09-01' })).body;
  const est = (await request(app).get(`/api/projects/${p.id}/estimate`).set(A())).body;
  return { pid: p.id as number, catId: est.categories[0].id as number };
}

describe('Update 6 E — price source resolver', () => {
  it('fall-through when no local (verified) price book: chiết tính available, địa phương is not – never invents a price', async () => {
    const { pid, catId } = await newProject('Price source – fall-through');
    const item = (await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: catId, normCode: 'ZZ.TEST1', unit: 'm3', quantity: 10 })).body;
    const est = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    const ps = est.itemPriceSources[item.id];
    expect(ps.available).toEqual({ dia_phuong: false, ho_so: false, chiet_tinh: true });
    expect(ps.preferred).toBe('chiet_tinh');
    expect(ps.current).toBe('chiet_tinh');
  });

  it('per-item override always wins over the resolver, and clearing it falls back', async () => {
    const { pid, catId } = await newProject('Price source – override');
    const item = (await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: catId, normCode: 'ZZ.TEST1', unit: 'm3', quantity: 10 })).body;
    await request(app).put(`/api/projects/${pid}/items/${item.id}/price-source-override`).set(A()).send({ kind: 'thu_cong' });
    let est = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    expect(est.itemPriceSources[item.id].preferred).toBe('thu_cong');
    expect(est.itemPriceSources[item.id].current).toBe('thu_cong');

    await request(app).put(`/api/projects/${pid}/items/${item.id}/price-source-override`).set(A()).send({ kind: null });
    est = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    expect(est.itemPriceSources[item.id].preferred).toBe('chiet_tinh');
  });

  it('chiết tính with a missing resource price is flagged "thiếu giá vật tư", never silently 0', async () => {
    const { pid, catId } = await newProject('Price source – chiết tính missing');
    const item = (await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: catId, normCode: 'ZZ.TEST1', unit: 'm3', quantity: 10 })).body;
    const sheet = (await request(app).get(`/api/projects/${pid}/items/${item.id}/chiet-tinh`).set(A())).body;
    expect(sheet.resources).toHaveLength(2);
    const missing = sheet.resources.find((r: { resourceCode: string }) => r.resourceCode === 'R.VL2');
    expect(missing.missing).toBe(true);
    expect(sheet.flagged).toBe(true);
    expect(sheet.missingResources).toContain('Vật liệu thử 2 (chưa có giá)');
    const ok = sheet.resources.find((r: { resourceCode: string }) => r.resourceCode === 'R.VL1');
    expect(ok.missing).toBe(false);
    expect(ok.amount).toBe(2 * 100000);
  });

  it('reordering priority and "Áp dụng lại" switches an item from hồ sơ to chiết tính, as one undoable revision', async () => {
    const { pid, catId } = await newProject('Price source – reapply priority');
    const item = (await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: catId, name: 'Công tác nhập từ file', unit: 'm3', quantity: 10 })).body;
    // simulate an imported hồ sơ (file) price, THEN gán mã định mức sau đó (both ho_so and chiet_tinh become available)
    db.prepare(`UPDATE estimate_items SET pricing_method = 'CUSTOM_GTT', custom_vl = 50000, custom_nc = 20000, source_file = 'test.xlsx', source_file_prices = ? WHERE id = ?`).run(
      JSON.stringify({ vl: 50000, nc: 20000, m: null, unit: null, amount: 700000 }),
      item.id,
    );
    await request(app).put(`/api/projects/${pid}/items/${item.id}`).set(A()).send({ normCode: 'ZZ.TEST1' });

    let est = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    let ps = est.itemPriceSources[item.id];
    expect(ps.available).toEqual({ dia_phuong: false, ho_so: true, chiet_tinh: true });
    expect(ps.current).toBe('ho_so');
    expect(ps.preferred).toBe('ho_so'); // default priority: dia_phuong → ho_so → chiet_tinh, ho_so already applied

    await request(app).put(`/api/projects/${pid}/price-source-priority`).set(A()).send({ order: ['chiet_tinh', 'ho_so', 'dia_phuong'] });
    est = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    ps = est.itemPriceSources[item.id];
    expect(ps.current).toBe('ho_so');
    expect(ps.preferred).toBe('chiet_tinh');

    const preview = (await request(app).get(`/api/projects/${pid}/price-source-apply/preview`).set(A())).body;
    expect(preview.changes).toHaveLength(1);
    expect(preview.changes[0]).toMatchObject({ itemId: item.id, from: { kind: 'ho_so' }, to: { kind: 'chiet_tinh' } });
    // preview must not have persisted anything
    expect((await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body.categories.flatMap((c: { items: { id: number; pricingMethod: string }[] }) => c.items).find((x: { id: number }) => x.id === item.id).pricingMethod).toBe('CUSTOM_GTT');

    const applied = await request(app).post(`/api/projects/${pid}/price-source-apply`).set(A()).send();
    expect(applied.body.changed).toBe(1);
    const afterItem = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body.categories.flatMap((c: { items: { id: number; pricingMethod: string }[] }) => c.items).find((x: { id: number }) => x.id === item.id);
    expect(afterItem.pricingMethod).toBe('NORM_BASED');

    const revisions = (await request(app).get(`/api/projects/${pid}/revisions`).set(A())).body;
    const rev = revisions.find((r: { kind: string }) => r.kind === 'price_source_apply');
    expect(rev).toBeTruthy();
    await request(app).post(`/api/projects/${pid}/revisions/${rev.id}/undo`).set(A());
    const undoneItem = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body.categories.flatMap((c: { items: { id: number; pricingMethod: string }[] }) => c.items).find((x: { id: number }) => x.id === item.id);
    expect(undoneItem.pricingMethod).toBe('CUSTOM_GTT');
  });

  it('"Kiểm tra" tab reports a count + value summary per price_source, never mixed silently', async () => {
    const { pid, catId } = await newProject('Price source – Kiểm tra summary');
    const a = (await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: catId, normCode: 'ZZ.TEST1', unit: 'm3', quantity: 10 })).body;
    const b = (await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: catId, name: 'Công tác thủ công', unit: 'm2', quantity: 5 })).body;
    await request(app).put(`/api/projects/${pid}/items/${b.id}/pricing`).set(A()).send({ pricingMethod: 'CUSTOM_GTT', custom: { vl: 10000, nc: 5000, m: 0 }, priceSource: 'Nhập tay' });
    const report = (await request(app).get(`/api/projects/${pid}/validation`).set(A())).body;
    expect(report.priceSourceSummary).toEqual(
      expect.arrayContaining([
        { kind: 'chiet_tinh', count: 1, value: 10 * 2 * 100000 /* qty 10 × 2×R.VL1 – R.VL2 resolves to 0 */ },
        { kind: 'thu_cong', count: 1, value: 5 * (10000 + 5000) },
      ]),
    );
    void a;
  });
});

describe('Update 6 E.5 — work package mode (bao_gia / du_toan_tt36)', () => {
  it('bao_gia package total equals Σ thành tiền, no TT36 chi phí chung/TNCT on top', async () => {
    const { pid } = await newProject('Mode – bao_gia');
    const wp = (await request(app).post(`/api/projects/${pid}/work-packages`).set(A()).send({ name: 'CT01', mode: 'bao_gia' })).body;
    const cat = (await request(app).post(`/api/projects/${pid}/categories`).set(A()).send({ name: 'Phần', workPackageId: wp.id })).body;
    const item = (await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: cat.id, name: 'Công tác báo giá', unit: 'm3', quantity: 10 })).body;
    await request(app).put(`/api/projects/${pid}/items/${item.id}/pricing`).set(A()).send({ pricingMethod: 'CUSTOM_GTT', custom: { vl: 100000, nc: 50000, m: 0 }, priceSource: 'Báo giá nhà thầu' });

    const scoped = (await request(app).get(`/api/projects/${pid}/work-packages/${wp.id}/estimate`).set(A())).body;
    expect(scoped.total.total).toBe(10 * (100000 + 50000));
    expect(scoped.costSummary.total ?? scoped.costSummary.Gxd).toBe(scoped.total.total);
    expect(scoped.costSummary.lines).toHaveLength(1);
  });

  it('mode switch preview compares bao_gia vs du_toan_tt36 without persisting anything', async () => {
    const { pid } = await newProject('Mode – switch preview');
    const wp = (await request(app).post(`/api/projects/${pid}/work-packages`).set(A()).send({ name: 'CT01', mode: 'bao_gia' })).body;
    const cat = (await request(app).post(`/api/projects/${pid}/categories`).set(A()).send({ name: 'Phần', workPackageId: wp.id })).body;
    const item = (await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: cat.id, name: 'Công tác', unit: 'm3', quantity: 10 })).body;
    await request(app).put(`/api/projects/${pid}/items/${item.id}/pricing`).set(A()).send({ pricingMethod: 'CUSTOM_GTT', custom: { vl: 100000, nc: 50000, m: 0 }, priceSource: 'Báo giá' });

    const preview = (await request(app).get(`/api/projects/${pid}/work-packages/${wp.id}/mode-preview?mode=du_toan_tt36`).set(A())).body;
    expect(preview.before.mode).toBe('bao_gia');
    expect(preview.before.total).toBe(1500000);
    expect(preview.after.mode).toBe('du_toan_tt36');
    expect(preview.after.total).toBeGreaterThan(preview.before.total); // TT36 chi phí chung/TNCT added back

    const packages = (await request(app).get(`/api/projects/${pid}/work-packages`).set(A())).body;
    expect(packages.find((p: { id: number }) => p.id === wp.id).mode).toBe('bao_gia'); // preview never persists
  });
});

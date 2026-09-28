import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { runImportTt38 } from '../src/scripts/import-tt38.js';
import { seedAdmin } from '../src/seed.js';

// Update 3 C: "Cập nhật định mức & đơn giá theo khu vực" against the real TT38_2026 norms.
const db = openDb(':memory:');
seedAdmin(db, 'admin', 'admin123');
runImportTt38(db);
const app = createApp(db, { serveWeb: false });
let token = '';
const A = () => ({ Authorization: `Bearer ${token}` });
const HCM = 'TP. Hồ Chí Minh';

beforeAll(async () => {
  const t = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' })).body.token;
  token = (await request(app).post('/api/auth/change-password').set({ Authorization: `Bearer ${t}` }).send({ oldPassword: 'admin123', newPassword: 'MatKhau2026!' })).body.token;
});

// the resource of norm AF.11110 (bê tông lót móng) of the given type/name
const resourceCode = (like: string, type: string) =>
  (db.prepare("SELECT r.code FROM norm_resources nr JOIN resources r ON r.code = nr.resource_code WHERE nr.dataset = 'TT38_2026' AND nr.norm_code = 'AF.11110' AND r.name LIKE ? AND r.type = ?").get(like, type) as { code: string }).code;

async function book(type: 'VL' | 'NC' | 'M', month: number, rows: [string, string, number, string][], opts: { verify?: boolean } = {}) {
  const b = (await request(app).post('/api/price-books').set(A()).send({ region: HCM, issuer: 'Sở Xây dựng', docNumber: `T${type}${month}`, periodType: 'month', periodYear: 2026, periodValue: month, bookType: type, vat: 'excluded' })).body;
  const ins = db.prepare(`INSERT INTO price_book_rows (book_id, resource_code, name, unit, price, match_status, verification_status) VALUES (?, ?, ?, ?, ?, 'matched', 'needs_review')`);
  for (const [code, name, price, unit] of rows) ins.run(b.id, code, name, unit, price);
  if (opts.verify !== false) await request(app).post(`/api/price-books/${b.id}/status`).set(A()).send({ status: 'verified' });
  return b.id as number;
}

async function newProject(name: string, extra: Record<string, unknown> = {}) {
  const p = (await request(app).post('/api/projects').set(A()).send({ name, priceDate: '2026-09-01', ...extra })).body;
  const est = (await request(app).get(`/api/projects/${p.id}/estimate`).set(A())).body;
  return { pid: p.id as number, catId: est.categories[0].id as number };
}

describe('C. regional update: preview, apply as a revision, undo', () => {
  let vlBook = 0;
  let ncBook = 0;
  const vua = () => resourceCode('Vữa bê tông', 'VL');
  const nc2 = () => resourceCode('Nhân công nhóm 2', 'NC');

  beforeAll(async () => {
    vlBook = await book('VL', 8, [[vua(), 'Vữa bê tông', 1_200_000, 'm3']]);
    ncBook = await book('NC', 8, [[nc2(), 'Nhân công nhóm 2', 400_000, 'công']]);
  });

  it('previews old → new prices with sources, unpriced resources and the change of GXDTT/GXD', async () => {
    const { pid, catId } = await newProject('KV preview');
    await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: catId, normCode: 'AF.11110', quantity: 10 });
    const r = await request(app).post(`/api/projects/${pid}/regional-update/preview`).set(A()).send({ region: HCM, auto: true });
    expect(r.status).toBe(200);
    const pv = r.body;
    expect(pv.canApply).toBe(true);
    expect(pv.books.map((b: { type: string }) => b.type).sort()).toEqual(['NC', 'VL']);
    const vl = pv.resources.find((x: { code: string }) => x.code === vua());
    expect(vl).toMatchObject({ oldPrice: 0, newPrice: 1_200_000, type: 'VL' });
    expect(vl.newSource).toMatch(/TVL8|Sở Xây dựng|VL/);
    expect(vl.delta).toBeCloseTo(1_200_000 * 1.025 * 10, 2);
    const nc = pv.resources.find((x: { code: string }) => x.code === nc2());
    expect(nc).toMatchObject({ newPrice: 400_000 });
    // machines have no book for HCM: kept at the current price and flagged
    expect(pv.unpriced.some((u: { type: string }) => u.type === 'M')).toBe(true);
    expect(pv.warnings.join(' ')).toMatch(/Không có bộ giá ca máy/);
    expect(pv.items[0]).toMatchObject({ normCode: 'AF.11110' });
    expect(pv.items[0].missingPrices).toBeGreaterThan(0);
    expect(pv.totals.delta.direct).toBeGreaterThan(0);
    expect(pv.totals.delta.gxdtt).toBeGreaterThan(pv.totals.delta.direct);
    expect(pv.totals.delta.gxd).toBeGreaterThan(pv.totals.delta.gxdtt);
    expect(pv.normSet).toMatchObject({ dataset: 'TT38_2026', total: 9012 });
    // nothing was changed by the preview
    const p = (await request(app).get(`/api/projects/${pid}`).set(A())).body;
    expect(p.region ?? null).toBeNull();
  });

  it('respects the type checkboxes (only nhân công) and an explicit period', async () => {
    const { pid, catId } = await newProject('KV types');
    await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: catId, normCode: 'AF.11110', quantity: 1 });
    const a = (await request(app).post(`/api/projects/${pid}/regional-update/preview`).set(A()).send({ region: HCM, types: ['NC'] })).body;
    expect(a.books.map((b: { type: string }) => b.type)).toEqual(['NC']);
    expect(a.resources.every((x: { type: string }) => x.type === 'NC')).toBe(true);
    const june = (await request(app).post(`/api/projects/${pid}/regional-update/preview`).set(A()).send({ region: HCM, auto: false, period: { type: 'month', year: 2026, value: 6 }, types: ['VL'] })).body;
    expect(june.books).toEqual([]);
    expect(june.warnings.join(' ')).toMatch(/Không có bộ giá vật liệu/);
  });

  it('applies as a revision (audit log) and can be undone; manual prices stay', async () => {
    const { pid, catId } = await newProject('KV apply');
    await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: catId, normCode: 'AF.11110', quantity: 10 });
    const before = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    const r = await request(app).post(`/api/projects/${pid}/regional-update/apply`).set(A()).send({ region: HCM, auto: true });
    expect(r.status).toBe(200);
    expect(r.body.applied.resources).toBeGreaterThan(0);
    const after = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    expect(after.project.region).toBe(HCM);
    expect(after.total.total).toBeGreaterThan(before.total.total);
    expect(after.priceSources[vua()].label).toMatch(/Sở Xây dựng|VL/);
    const revs = (await request(app).get(`/api/projects/${pid}/revisions`).set(A())).body;
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({ kind: 'regional_update', createdBy: 'admin', undone: false });
    expect(revs[0].description).toMatch(/Cập nhật đơn giá theo khu vực TP\. Hồ Chí Minh/);

    const u = await request(app).post(`/api/projects/${pid}/revisions/${revs[0].id}/undo`).set(A());
    expect(u.status).toBe(200);
    const undone = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    expect(undone.total.total).toBe(before.total.total);
    expect(undone.project.region ?? null).toBeNull();
    expect((await request(app).get(`/api/projects/${pid}/revisions`).set(A())).body[0].undone).toBe(true);
    expect((await request(app).post(`/api/projects/${pid}/revisions/${revs[0].id}/undo`).set(A())).status).toBe(409);

    // a manual price wins over the price book and is not overwritten
    await request(app).put(`/api/projects/${pid}/prices/${encodeURIComponent(vua())}`).set(A()).send({ price: 999_000 });
    const pv = (await request(app).post(`/api/projects/${pid}/regional-update/preview`).set(A()).send({ region: HCM })).body;
    expect(pv.resources.find((x: { code: string }) => x.code === vua())).toBeUndefined();
  });

  it('never modifies an approved estimate', async () => {
    const { pid, catId } = await newProject('KV approved');
    await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: catId, normCode: 'AF.11110', quantity: 1, codeStatus: 'manual' });
    expect((await request(app).post(`/api/projects/${pid}/approve`).set(A())).status).toBe(200);
    const pv = (await request(app).post(`/api/projects/${pid}/regional-update/preview`).set(A()).send({ region: HCM })).body;
    expect(pv.canApply).toBe(false);
    expect(pv.warnings.join(' ')).toMatch(/đã được duyệt/);
    const r = await request(app).post(`/api/projects/${pid}/regional-update/apply`).set(A()).send({ region: HCM });
    expect(r.status).toBe(409);
    expect((await request(app).get(`/api/projects/${pid}/revisions`).set(A())).body).toEqual([]);
  });

  it('shows a badge when a newer verified price book exists – never applied silently', async () => {
    const { pid, catId } = await newProject('KV badge', { region: HCM });
    await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: catId, normCode: 'AF.11110', quantity: 1 });
    await request(app).post(`/api/projects/${pid}/regional-update/apply`).set(A()).send({ region: HCM });
    expect((await request(app).get(`/api/projects/${pid}/price-update-status`).set(A())).body).toMatchObject({ enabled: false, count: 0 });
    const on = (await request(app).put(`/api/projects/${pid}/auto-price-update`).set(A()).send({ enabled: true })).body;
    expect(on.autoPriceUpdate).toBe(true);
    const newer = await book('VL', 9, [[vua(), 'Vữa bê tông', 1_300_000, 'm3']]);
    const st = (await request(app).get(`/api/projects/${pid}/price-update-status`).set(A())).body;
    expect(st).toMatchObject({ enabled: true, count: 1 });
    expect(st.books[0].id).toBe(newer);
    // not applied: the project still uses the August book
    const est = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    expect(est.priceSources[vua()].label).not.toMatch(/TVL9/);
  });

  it('re-maps codes that are missing from the active norm set (section B flow) with preview, choice and undo', async () => {
    const { pid, catId } = await newProject('KV remap');
    const it = (await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: catId, normCode: 'AF.11111', name: 'Bê tông lót móng đá 4x6 M100', unit: 'm3', quantity: 3 })).body;
    const pv = (await request(app).post(`/api/projects/${pid}/regional-update/preview`).set(A()).send({ region: HCM, remapCodes: true })).body;
    const row = pv.remap.find((x: { itemId: number }) => x.itemId === it.id);
    expect(row.resolution.status).toBe('propose');
    expect(row.resolution.candidates[0].code).toBe('AF.11110');
    const ap = await request(app).post(`/api/projects/${pid}/regional-update/apply`).set(A()).send({ region: HCM, remapCodes: true, codeChoices: { [it.id]: 'AF.11110' } });
    expect(ap.status).toBe(200);
    expect(ap.body.applied.codes).toBe(1);
    const item = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body.categories[0].items[0];
    expect(item).toMatchObject({ normCode: 'AF.11110', normCodeRaw: 'AF.11111', codeStatus: 'confirmed' });
    const revs = (await request(app).get(`/api/projects/${pid}/revisions`).set(A())).body;
    await request(app).post(`/api/projects/${pid}/revisions/${revs[0].id}/undo`).set(A());
    const back = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body.categories[0].items[0];
    expect(back.normCode).toBe('AF.11111');
  });
});

import crypto from 'node:crypto';
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
const newProject = async (name: string, extra: object = {}) =>
  (await request(app).post('/api/projects').set(A()).send({ name, priceDate: '2026-09-01', ...extra })).body.id as number;
const items = async (pid: number) =>
  (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body.categories.flatMap((c: { items: object[] }) => c.items);
const validation = async (pid: number) => (await request(app).get(`/api/projects/${pid}/validation`).set(A())).body;
const check = (v: { checks: { id: string }[] }, id: string) => v.checks.find((c) => c.id === id) as { status: string; findings: { severity: string; message: string; itemId?: number }[] };

beforeAll(async () => {
  const t = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' })).body.token;
  token = (await request(app).post('/api/auth/change-password').set({ Authorization: `Bearer ${t}` }).send({ oldPassword: 'admin123', newPassword: 'MatKhau2026!' })).body.token;
});

describe('F3/F4/F5 – legacy VNI file with codes without dots, GTT, #NAME?, #REF!, external link', () => {
  let pid = 0;
  it('analyses: converts VNI to Unicode (raw kept), canonicalises codes, flags broken cells', async () => {
    pid = await newProject('VNI');
    const up = await request(app).post('/api/import/upload').set(A()).attach('file', fixture('du-toan-vni-loi.xlsx'), 'du-toan-vni-loi.xlsx');
    const a = (await request(app).post('/api/import/analyze').set(A()).send({ fileId: up.body.fileId, projectId: pid })).body;
    expect(a.encoding).toBe('vni');
    expect(a.sha256).toBe(crypto.createHash('sha256').update(fixture('du-toan-vni-loi.xlsx')).digest('hex'));
    expect(a.header.mapping).toMatchObject({ stt: 0, code: 1, name: 2, unit: 3, quantity: 4, unitPrice: 5 });
    expect(a.warnings.join(' ')).toMatch(/VNI – đã chuyển sang Unicode/);
    expect(a.warnings.join(' ')).toMatch(/FLAG_EXTERNAL_LINK_OR_BROKEN_FORMULA/);
    const lot = a.rows.find((r: { code: string }) => r.code === 'AF11111');
    expect(lot).toMatchObject({ name: 'Bê tông lót móng đá 4x6 M100', rawName: 'Beâ toâng loùt moùng ñaù 4x6 M100', normalizedCode: 'AF.11111', codeKnown: true });
    expect(lot.flags).toEqual(['FLAG_EXTERNAL_LINK_OR_BROKEN_FORMULA']); // #REF! in its price cell
    const dao = a.rows.find((r: { code: string }) => r.code === 'AB11312');
    expect(dao.warnings.join()).toMatch(/lỗi #NAME\?/);
    const trat = a.rows.find((r: { code: string }) => r.code === 'AK21124');
    expect(trat.warnings.join()).toMatch(/liên kết workbook khác/);
    const gtt = a.rows.find((r: { code: string }) => r.code === 'GTT');
    expect(gtt).toMatchObject({ pricingMethod: 'CUSTOM_GTT', codeKnown: false });
  });

  it('imports: canonical codes, raw text, flags and a CUSTOM_GTT item priced from the file', async () => {
    const up = await request(app).post('/api/import/upload').set(A()).attach('file', fixture('du-toan-vni-loi.xlsx'), 'du-toan-vni-loi.xlsx');
    const r = (await request(app).post(`/api/projects/${pid}/import-estimate`).set(A()).send({ fileId: up.body.fileId })).body;
    expect(r.created).toBe(5);
    const list = await items(pid);
    const lot = list.find((i: { normCode: string }) => i.normCode === 'AF.11111');
    expect(lot).toMatchObject({ codeStatus: 'imported', sourceRawText: 'Beâ toâng loùt moùng ñaù 4x6 M100', sourceFlags: ['FLAG_EXTERNAL_LINK_OR_BROKEN_FORMULA'] });
    expect(lot.source.code).toBe('AF11111');
    const gtt = list.find((i: { name: string }) => i.name.startsWith('Chống thấm'));
    expect(gtt).toMatchObject({ pricingMethod: 'CUSTOM_GTT', custom: { vl: 185000, nc: 0, m: 0 } });
    expect(gtt.amount.total).toBe(120 * 185000);
    expect(gtt.priceSource).toMatch(/dòng 6/);
    const dao = list.find((i: { normCode: string }) => i.normCode === 'AB.11312');
    expect(dao.quantity).toBe(0); // #NAME? – not used silently
    // no suggestions for the GTT item
    const sugg = (await request(app).get(`/api/projects/${pid}/suggestions`).set(A())).body;
    expect(sugg.find((s: { itemId: number }) => s.itemId === gtt.id)).toBeUndefined();
  });

  it('validation report flags broken cells, zero quantity and sample prices', async () => {
    const v = await validation(pid);
    expect(check(v, 'SOURCE_FLAGS').status).toBe('fail');
    expect(check(v, 'SOURCE_FLAGS').findings).toHaveLength(3);
    expect(check(v, 'REQUIRED').findings.some((f) => f.message === 'Khối lượng bằng 0')).toBe(true);
    expect(check(v, 'PRICE_SOURCE').status).toBe('warning');
    expect(check(v, 'CUSTOM_PRICE').status).toBe('pass'); // GTT has a price and a source
    expect(check(v, 'TOTALS').status).toBe('pass');
    expect(check(v, 'RECONCILE').status).toBe('pass');
    expect(check(v, 'EFFECTIVE').status).toBe('pass');
    expect(v.counts.error).toBeGreaterThan(0);
  });
});

describe('F1 – quantity lines', () => {
  it('saves lines with deduction and mm→m conversion; item quantity = Σ lines; validation detects drift', async () => {
    const pid = await newProject('KL');
    const cat = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body.categories[0].id;
    const it = (await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: cat, normCode: 'AE.22214', quantity: 0 })).body;
    const r = await request(app)
      .put(`/api/projects/${pid}/items/${it.id}/quantity-lines`)
      .set(A())
      .send({
        lines: [
          { description: 'Tường trục 1', expression: '13*5.4*0.1' },
          { description: 'Trừ cửa', expression: '9*0.6*0.6*0.1', sign: -1 },
          { description: 'Tường mm', expression: 'L*W*H*N', variablesText: 'L=4000; W=110; H=3300; N=2', unit: 'mm3' },
        ],
      });
    expect(r.status).toBe(200);
    // 7,02 − 0,324 + 4 × 0,11 × 3,3 × 2 = 6,696 + 2,904 = 9,6
    expect(r.body.total).toBeCloseTo(9.6, 9);
    expect(r.body.item).toMatchObject({ quantitySource: 'LINES' });
    expect(r.body.item.quantity).toBeCloseTo(9.6, 9);
    expect((await request(app).get(`/api/projects/${pid}/items/${it.id}/quantity-lines`).set(A())).body).toHaveLength(3);
    const bad = await request(app).put(`/api/projects/${pid}/items/${it.id}/quantity-lines`).set(A()).send({ lines: [{ expression: 'require("fs")' }] });
    expect(bad.status).toBe(400);
    const badUnit = await request(app).put(`/api/projects/${pid}/items/${it.id}/quantity-lines`).set(A()).send({ lines: [{ expression: '10', unit: 'm2' }] });
    expect(badUnit.body.error).toMatch(/không quy đổi được/);
    expect(check(await validation(pid), 'QTY_LINES').status).not.toBe('fail');
    await request(app).put(`/api/projects/${pid}/items/${it.id}`).set(A()).send({ quantity: 12 });
    expect(check(await validation(pid), 'QTY_LINES').status).toBe('fail');
    const ev = (await request(app).post('/api/quantity/evaluate').set(A()).send({ expression: '6.6*14.2*3.8', itemUnit: 'm3' })).body;
    expect(ev.total).toBeCloseTo(356.136, 9);
  });
});

describe('F2 – market quote pricing', () => {
  it('converts a VAT-inclusive quote to pre-VAT and validates quote fields', async () => {
    const pid = await newProject('Báo giá');
    const cat = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body.categories[0].id;
    const it = (await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: cat, name: 'Cửa nhôm Xingfa', unit: 'm2', quantity: 10 })).body;
    const noSupplier = await request(app).put(`/api/projects/${pid}/items/${it.id}/pricing`).set(A()).send({ pricingMethod: 'MARKET_QUOTE', custom: { vl: 1_100_000 } });
    expect(noSupplier.status).toBe(400);
    const r = await request(app)
      .put(`/api/projects/${pid}/items/${it.id}/pricing`)
      .set(A())
      .send({ pricingMethod: 'MARKET_QUOTE', custom: { vl: 1_100_000 }, priceSource: 'BG số 12/2026', quote: { supplier: 'Công ty A', number: '12/2026', date: '2026-08-01', validUntil: '2026-08-31', vatStatus: 'including_vat', vatRate: 10 } });
    expect(r.body.pricingMethod).toBe('MARKET_QUOTE');
    const list = await items(pid);
    expect(list[0].unitCost.total).toBeCloseTo(1_000_000, 6);
    const v = await validation(pid);
    expect(check(v, 'CUSTOM_PRICE').findings.map((f) => f.message).join()).toMatch(/hết hiệu lực 2026-08-31/);
    expect(check(v, 'UNRESOLVED').status).toBe('pass');
  });
});

describe('F6 – price book records (data contract) and province mergers', () => {
  it('rejects a former province mapped to the wrong successor and exports contract records with sha256', async () => {
    const wrong = await request(app)
      .post('/api/price-books')
      .set(A())
      .send({ region: 'Đồng Nai', jurisdictionAtIssue: 'Bình Dương', periodType: 'month', periodYear: 2025, periodValue: 5, bookType: 'VL' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatch(/thuộc TP\. Hồ Chí Minh/);
    const after = await request(app)
      .post('/api/price-books')
      .set(A())
      .send({ region: 'TP. Hồ Chí Minh', jurisdictionAtIssue: 'Bình Dương', periodType: 'month', periodYear: 2025, periodValue: 8, bookType: 'VL' });
    expect(after.body.error).toMatch(/địa giới mới/);
    const ok = (
      await request(app)
        .post('/api/price-books')
        .set(A())
        .send({ region: 'TP. Hồ Chí Minh', jurisdictionAtIssue: 'Bình Dương', issuer: 'Sở XD Bình Dương (thử)', docNumber: 'BD-TEST', periodType: 'month', periodYear: 2025, periodValue: 5, bookType: 'VL', vat: 'excluded', delivery: 'Tại kho, chưa gồm vận chuyển', transportIncluded: 'no' })
    ).body;
    expect(ok.jurisdictionAtIssue).toBe('Bình Dương');
    const up = await request(app).post('/api/import/upload').set(A()).attach('file', fixture('bang-gia-thu-nghiem.xlsx'), 'bang-gia-thu-nghiem.xlsx');
    await request(app).post(`/api/price-books/${ok.id}/import`).set(A()).send({ fileId: up.body.fileId });
    const recs = (await request(app).get(`/api/price-books/${ok.id}/records`).set(A())).body;
    expect(recs[0]).toMatchObject({
      record_type: 'material_price',
      jurisdiction_current: 'TP. Hồ Chí Minh',
      jurisdiction_at_issue: 'Bình Dương',
      currency: 'VND',
      vat_status: 'before_vat',
      period_from: '2025-05-01',
      publication_no: 'BD-TEST',
      commercial_terms: 'Tại kho, chưa gồm vận chuyển',
      source_file_name: 'bang-gia-thu-nghiem.xlsx',
      source_sha256: crypto.createHash('sha256').update(fixture('bang-gia-thu-nghiem.xlsx')).digest('hex'),
      verification_status: 'needs_review',
      unit_original: 'tấn',
      value_original: '1.650.000',
    });
    // proposals: the former-province book is not applied to the whole merged province
    const pid = await newProject('Thủ Dầu Một', { region: 'TP. Hồ Chí Minh', priceDate: '2025-06-10' });
    let pb = (await request(app).get(`/api/projects/${pid}/price-books`).set(A())).body;
    expect(pb.proposals.books.map((b: { id: number }) => b.id)).not.toContain(ok.id);
    expect(pb.proposals.excluded.find((e: { id: number }) => e.id === ok.id).reason).toMatch(/địa giới cũ "Bình Dương"/);
    await request(app).put(`/api/projects/${pid}`).set(A()).send({ subArea: 'Bình Dương' });
    pb = (await request(app).get(`/api/projects/${pid}/price-books`).set(A())).body;
    expect(pb.proposals.books.map((b: { id: number }) => b.id)).toContain(ok.id);
    expect((await request(app).get('/api/province-mergers').set(A())).body.mergers).toHaveLength(4);
  });
});

describe('F7 – transport to site without double counting', () => {
  it('adds legs to base prices, skips them for transport-inclusive sources', async () => {
    const pid = await newProject('Vận chuyển');
    const cat = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body.categories[0].id;
    await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: cat, normCode: 'AB.13411', quantity: 100 });
    const legs = [{ fromLocation: 'Mỏ cát', toLocation: 'Công trường', distance: 25, freightRate: 3000, weightFactor: 1.4, loadFactor: 1.1, handling: 8000, toll: 2000 }];
    const saved = (await request(app).put(`/api/projects/${pid}/transport/V.CATSL`).set(A()).send({ legs })).body;
    expect(saved[0].amount).toBeCloseTo(125500, 6);
    let est = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    const cat1 = est.resourceSummary.find((r: { code: string }) => r.code === 'V.CATSL');
    expect(cat1.price).toBeCloseTo(150000 + 125500, 6);
    expect(est.priceSources['V.CATSL']).toMatchObject({ kind: 'base', sourcePrice: 150000 });
    // manual site price → transport not added again
    await request(app).put(`/api/projects/${pid}/prices/V.CATSL`).set(A()).send({ price: 290000 });
    est = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    expect(est.resourceSummary.find((r: { code: string }) => r.code === 'V.CATSL').price).toBe(290000);
    const v = await validation(pid);
    expect(check(v, 'COEFFICIENTS').findings.map((f) => f.message).join()).toMatch(/tránh tính 2 lần/);
  });
});

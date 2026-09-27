import ExcelJS from 'exceljs';
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
const binary = (res: NodeJS.ReadableStream, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

beforeAll(async () => {
  const t = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' })).body.token;
  token = (await request(app).post('/api/auth/change-password').set({ Authorization: `Bearer ${t}` }).send({ oldPassword: 'admin123', newPassword: 'MatKhau2026!' })).body.token;
});

describe('price books', () => {
  let bookId = 0;
  let pid = 0;

  it('seeds one metadata-only HCMC book and the 34 provinces', async () => {
    const regions = (await request(app).get('/api/regions').set(A())).body;
    expect(regions).toHaveLength(34);
    expect(regions).toContain('TP. Hồ Chí Minh');
    const books = (await request(app).get('/api/price-books').set(A())).body;
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      region: 'TP. Hồ Chí Minh',
      issuer: 'Sở Xây dựng TP. Hồ Chí Minh',
      docNumber: '7563/TB-SXD-KTVLXD',
      docDate: '2026-03-10',
      periodStart: '2026-02-01',
      status: 'draft',
      rowCount: 0,
    });
    expect(books[0].note).toMatch(/Tải file công bố giá chính thức/);
    const bad = await request(app).post(`/api/price-books/${books[0].id}/status`).set(A()).send({ status: 'verified' });
    expect(bad.status).toBe(400);
  });

  it('creates a book and imports a price list with code / fuzzy matching and a review list', async () => {
    const b = await request(app)
      .post('/api/price-books')
      .set(A())
      .send({ region: 'TP. Hồ Chí Minh', issuer: 'Đơn vị thử nghiệm', docNumber: 'TEST-01', periodType: 'quarter', periodYear: 2026, periodValue: 2, bookType: 'VL', vat: 'excluded' });
    expect(b.status).toBe(200);
    bookId = b.body.id;
    expect(b.body).toMatchObject({ periodStart: '2026-04-01', periodEnd: '2026-06-30' });
    const up = await request(app).post('/api/import/upload').set(A()).attach('file', fs.readFileSync(new URL('./fixtures/bang-gia-thu-nghiem.xlsx', import.meta.url)), 'bang-gia-thu-nghiem.xlsx');
    const a = (await request(app).post('/api/import/analyze').set(A()).send({ fileId: up.body.fileId, kind: 'pricebook' })).body;
    expect(a.header.mapping).toMatchObject({ code: 1, name: 2, spec: 3, unit: 4, price: 5, subArea: 6 });
    const r = (await request(app).post(`/api/price-books/${bookId}/import`).set(A()).send({ fileId: up.body.fileId })).body;
    expect(r).toMatchObject({ imported: 5, matched: 4, unmatched: 1 });
    const rows = (await request(app).get(`/api/price-books/${bookId}`).set(A())).body.rows;
    expect(rows.find((x: { name: string }) => x.name === 'Cát vàng')).toMatchObject({ resourceCode: 'V.CATV', matchStatus: 'matched' });
    const steel = rows.find((x: { name: string }) => x.name === 'Thép hình I200');
    expect(steel.matchStatus).toBe('unmatched');
    const ig = await request(app).put(`/api/price-books/${bookId}/rows/${steel.id}`).set(A()).send({ ignore: true });
    expect(ig.body.matchStatus).toBe('ignored');
    expect((await request(app).post(`/api/price-books/${bookId}/status`).set(A()).send({ status: 'verified' })).body.status).toBe('verified');
  });

  it('proposes books for the project region and price date; selection changes prices with a diff preview', async () => {
    pid = (await request(app).post('/api/projects').set(A()).send({ name: 'Kho Q7', priceDate: '2026-05-20', region: 'TP. Hồ Chí Minh' })).body.id;
    const cat = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body.categories[0].id;
    await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: cat, normCode: 'AF.11213', quantity: 10 });
    const pb = (await request(app).get(`/api/projects/${pid}/price-books`).set(A())).body;
    expect(pb.proposals.books.map((b: { id: number }) => b.id)).toEqual([bookId, pb.books.find((b: { docNumber: string }) => b.docNumber === '7563/TB-SXD-KTVLXD').id]);

    const selection = [{ bookId, resourceType: 'VL', priority: 1 }];
    const prev = (await request(app).post(`/api/projects/${pid}/price-books/preview`).set(A()).send({ selection })).body;
    const xm = prev.rows.find((r: { code: string }) => r.code === 'V.XM40');
    expect(xm).toMatchObject({ oldPrice: 1500, newPrice: 1650 });
    expect(prev.totalDelta).toBeGreaterThan(0);
    await request(app).put(`/api/projects/${pid}/price-books`).set(A()).send({ selection });

    const prices = (await request(app).get(`/api/projects/${pid}/prices`).set(A())).body;
    const p = prices.find((x: { code: string }) => x.code === 'V.XM40');
    expect(p.effectivePrice).toBeCloseTo(1650, 6);
    expect(p.source.label).toMatch(/TEST-01/);
    expect(p.source.notes).toContain('quy đổi đ/tấn → đ/kg');
    const nuoc = prices.find((x: { code: string }) => x.code === 'V.NUOC');
    expect(nuoc.source.kind).toBe('base');

    // manual override wins
    await request(app).put(`/api/projects/${pid}/prices/V.XM40`).set(A()).send({ price: 1600 });
    const est = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    expect(est.resourceSummary.find((r: { code: string }) => r.code === 'V.XM40').price).toBe(1600);
    expect(est.priceSources['V.XM40'].kind).toBe('manual');
    expect(est.priceSources['V.CATV'].kind).toBe('book');
  });

  it('shows the price source on the THVT sheet and a price history per resource', async () => {
    const r = await request(app).get(`/api/projects/${pid}/export.xlsx`).set(A()).buffer(true).parse(binary);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body);
    const tv = wb.getWorksheet('THVT')!;
    expect(tv.getCell('I4').value).toBe('Nguồn giá');
    const col: string[] = [];
    tv.getColumn(9).eachCell((c) => col.push(String(c.value)));
    expect(col.join('\n')).toMatch(/TEST-01/);
    const h = (await request(app).get('/api/resources/V.XM40/price-history').set(A())).body;
    expect(h.points.map((x: { price: number }) => x.price)).toEqual([1650000, 1720000]);
  });

  it('rejects a book type that does not match the resource type and invalid periods', async () => {
    const bad = await request(app).put(`/api/projects/${pid}/price-books`).set(A()).send({ selection: [{ bookId, resourceType: 'NC', priority: 1 }] });
    expect(bad.status).toBe(400);
    const badP = await request(app).post('/api/price-books').set(A()).send({ region: 'TP. Hồ Chí Minh', periodType: 'month', periodYear: 2026, periodValue: 13, bookType: 'VL' });
    expect(badP.status).toBe(400);
    const badR = await request(app).post('/api/price-books').set(A()).send({ region: 'Hà Tây', periodType: 'year', periodYear: 2026, bookType: 'VL' });
    expect(badR.status).toBe(400);
  });
});

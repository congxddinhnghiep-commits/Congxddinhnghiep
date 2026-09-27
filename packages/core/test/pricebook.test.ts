import { describe, expect, it } from 'vitest';
import { bookTitle, matchResource, periodRange, proposeBooks, resolvePrices, type PriceBook, type PriceBookRow } from '@dutoan/core';

const book = (id: number, over: Partial<PriceBook> = {}): PriceBook => {
  const b: PriceBook = {
    id,
    region: 'TP. Hồ Chí Minh',
    subArea: null,
    issuer: 'Sở Xây dựng',
    docNumber: `${id}/TB`,
    docDate: null,
    periodType: 'month',
    periodYear: 2026,
    periodValue: 2,
    ...periodRange('month', 2026, 2),
    periodStart: '',
    periodEnd: '',
    bookType: 'VL',
    vat: 'excluded',
    vatRate: null,
    delivery: null,
    sourceUrl: null,
    sourceFile: null,
    status: 'verified',
    note: null,
    title: '',
    ...over,
  };
  const r = periodRange(b.periodType, b.periodYear, b.periodValue);
  b.periodStart = over.periodStart ?? r.start;
  b.periodEnd = over.periodEnd ?? r.end;
  b.title = bookTitle(b);
  return b;
};
const row = (id: number, bookId: number, code: string, price: number, over: Partial<PriceBookRow> = {}): PriceBookRow => ({
  id,
  bookId,
  resourceCode: code,
  rawCode: code,
  name: code,
  spec: null,
  unit: 'kg',
  price,
  subArea: null,
  ...over,
});

const XM = { code: 'V.XM40', unit: 'kg', type: 'VL' as const, basePrice: 1500, isSample: true };
const CAT = { code: 'V.CATV', unit: 'm3', type: 'VL' as const, basePrice: 350000, isSample: true };
const NC = { code: 'N.NHOM3', unit: 'công', type: 'NC' as const, basePrice: 272000 };

describe('periods', () => {
  it('computes month / quarter / year ranges', () => {
    expect(periodRange('month', 2026, 2)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(periodRange('quarter', 2026, 3)).toEqual({ start: '2026-07-01', end: '2026-09-30' });
    expect(periodRange('year', 2025, null)).toEqual({ start: '2025-01-01', end: '2025-12-31' });
  });

  it('proposes books of the same region whose period starts on/before the price date, latest first', () => {
    const books = [
      book(1, { periodValue: 1 }),
      book(2, { periodValue: 2 }),
      book(3, { periodValue: 5 }),
      book(4, { region: 'Đồng Nai', periodValue: 2 }),
      book(5, { bookType: 'NC', periodType: 'quarter', periodValue: 1 }),
    ];
    const p = proposeBooks(books, 'TP. Ho Chi Minh', '2026-03-15');
    expect(p.map((b) => b.id)).toEqual([5, 2, 1]);
    expect(proposeBooks(books, null, '2026-03-15')).toEqual([]);
  });
});

describe('price resolution', () => {
  const b1 = book(1, { periodValue: 2 });
  const b2 = book(2, { periodValue: 1, vat: 'included', vatRate: 10 });
  const rows1 = [row(11, 1, 'V.XM40', 1650)];
  const rows2 = [row(21, 2, 'V.XM40', 1760), row(22, 2, 'V.CATV', 440000, { unit: 'm3' })];

  it('manual override → books by priority → base price (flagged)', () => {
    const sel = [
      { book: b1, rows: rows1, resourceType: 'VL' as const, priority: 1 },
      { book: b2, rows: rows2, resourceType: 'VL' as const, priority: 2 },
    ];
    const r = resolvePrices([XM, CAT, NC], { 'N.NHOM3': 300000 }, sel);
    expect(r['V.XM40']).toMatchObject({ price: 1650, source: { kind: 'book', bookId: 1 } });
    expect(r['V.CATV'].price).toBeCloseTo(400000, 6); // 440.000 incl. 10% VAT → 400.000
    expect(r['V.CATV'].source.notes).toContain('đã trừ VAT 10%');
    expect(r['N.NHOM3']).toMatchObject({ price: 300000, source: { kind: 'manual' } });
    const r2 = resolvePrices([XM, CAT], { 'V.XM40': 1500 }, []);
    expect(r2['V.XM40'].source.kind).toBe('manual');
    expect(r2['V.CATV'].source).toMatchObject({ kind: 'base', label: expect.stringContaining('MẪU') });
  });

  it('respects priority order and resource type of the selection', () => {
    const sel = [
      { book: b1, rows: rows1, resourceType: 'VL' as const, priority: 2 },
      { book: b2, rows: rows2, resourceType: 'VL' as const, priority: 1 },
    ];
    expect(resolvePrices([XM], {}, sel)['V.XM40'].price).toBeCloseTo(1600, 6); // 1.760 / 1,1
    const wrongType = [{ book: b1, rows: rows1, resourceType: 'NC' as const, priority: 1 }];
    expect(resolvePrices([XM], {}, wrongType)['V.XM40'].source.kind).toBe('base');
  });

  it('flags unknown VAT status and draft books', () => {
    const b = book(3, { vat: 'unknown', status: 'draft' });
    const r = resolvePrices([XM], {}, [{ book: b, rows: [row(31, 3, 'V.XM40', 1700)], resourceType: 'VL', priority: 1 }]);
    expect(r['V.XM40'].price).toBe(1700);
    expect(r['V.XM40'].source.label).toMatch(/bản nháp/);
    expect(r['V.XM40'].source.notes).toContain('chưa rõ giá đã gồm VAT hay chưa');
  });

  it('converts the row unit (đ/tấn → đ/kg) and prefers the project sub-area', () => {
    const rows = [row(41, 4, 'V.XM40', 1_600_000, { unit: 'tấn' }), row(42, 4, 'V.XM40', 1_700_000, { unit: 'tấn', subArea: 'Cần Giờ' })];
    const sel = [{ book: book(4), rows, resourceType: 'VL' as const, priority: 1 }];
    expect(resolvePrices([XM], {}, sel)['V.XM40'].price).toBeCloseTo(1600, 6);
    const r = resolvePrices([XM], {}, sel, 'Cần Giờ')['V.XM40'];
    expect(r.price).toBeCloseTo(1700, 6);
    expect(r.source.label).toMatch(/Cần Giờ/);
    // incompatible unit → row ignored
    const bad = [{ book: book(5), rows: [row(51, 5, 'V.XM40', 99, { unit: 'm3' })], resourceType: 'VL' as const, priority: 1 }];
    expect(resolvePrices([XM], {}, bad)['V.XM40'].source.kind).toBe('base');
  });
});

describe('fuzzy resource matching', () => {
  const res = [
    { code: 'V.XM40', name: 'Xi măng PCB40', unit: 'kg' },
    { code: 'V.CATV', name: 'Cát vàng', unit: 'm3' },
    { code: 'V.DA12', name: 'Đá dăm 1x2', unit: 'm3' },
  ];
  it('matches by name/spec and unit, rejects ambiguous or unrelated rows', () => {
    expect(matchResource({ name: 'Xi măng', spec: 'PCB40', unit: 'tấn' }, res)?.resource.code).toBe('V.XM40');
    expect(matchResource({ name: 'Đá 1x2', unit: 'm3' }, res)?.resource.code).toBe('V.DA12');
    expect(matchResource({ name: 'Thép hình I200', unit: 'kg' }, res)).toBeNull();
    expect(matchResource({ name: 'Xi măng PCB40', unit: 'm3' }, res)).toBeNull();
  });
});

import { bookScopeFits, successorOf, transportLegAmount, type TransportLeg } from '@dutoan/core';

describe('transport to site (no double counting)', () => {
  // Cát vàng: 25 km × 3.000 đ/t.km × 1,4 t/m3 × 1,1 + bốc dỡ 8.000 + trạm phí 2.000 = 115.500 + 10.000 = 125.500 đ/m3
  const leg: TransportLeg = { fromLocation: 'Mỏ cát', toLocation: 'Công trường', distance: 25, freightRate: 3000, weightFactor: 1.4, loadFactor: 1.1, handling: 8000, toll: 2000 };
  it('computes a leg amount', () => expect(transportLegAmount(leg)).toBeCloseTo(125500, 6));

  it('adds transport to base / not-included sources only', () => {
    const base = resolvePrices([CAT], {}, [], null, { 'V.CATV': [leg] })['V.CATV'];
    expect(base.price).toBeCloseTo(350000 + 125500, 6);
    expect(base.source.sourcePrice).toBe(350000);
    expect(base.source.transport).toBeCloseTo(125500, 6);

    const incl = book(7, { transportIncluded: 'yes' });
    const r1 = resolvePrices([CAT], {}, [{ book: incl, rows: [row(71, 7, 'V.CATV', 480000, { unit: 'm3' })], resourceType: 'VL', priority: 1 }], null, { 'V.CATV': [leg] })['V.CATV'];
    expect(r1.price).toBe(480000);
    expect(r1.source.transport).toBe(0);
    expect(r1.source.notes!.join()).toMatch(/đã gồm vận chuyển.*tránh tính 2 lần/);

    const excl = book(8, { transportIncluded: 'no' });
    const r2 = resolvePrices([CAT], {}, [{ book: excl, rows: [row(81, 8, 'V.CATV', 300000, { unit: 'm3' })], resourceType: 'VL', priority: 1 }], null, { 'V.CATV': [leg] })['V.CATV'];
    expect(r2.price).toBeCloseTo(425500, 6);

    const manual = resolvePrices([CAT], { 'V.CATV': 500000 }, [], null, { 'V.CATV': [leg] })['V.CATV'];
    expect(manual.price).toBe(500000);
    expect(manual.source.transport).toBe(0);
  });
});

describe('province merger (2025) scope', () => {
  const mergers = [{ successor: 'TP. Hồ Chí Minh', predecessors: ['TP. Hồ Chí Minh', 'Bình Dương', 'Bà Rịa – Vũng Tàu'] }];
  it('maps former provinces to their successor', () => {
    expect(successorOf('Binh Duong', mergers)).toBe('TP. Hồ Chí Minh');
    expect(successorOf('Hà Nội', mergers)).toBeNull();
  });
  it('does not apply a former-province book to the whole merged province', () => {
    const old = book(9, { jurisdictionAtIssue: 'Bình Dương', periodType: 'month', periodValue: 5, periodYear: 2025 });
    expect(bookScopeFits(old, null)).toBe(false);
    expect(bookScopeFits(old, 'Bình Dương')).toBe(true);
    expect(proposeBooks([old], 'TP. Hồ Chí Minh', '2025-06-15')).toEqual([]);
    expect(proposeBooks([old], 'TP. Hồ Chí Minh', '2025-06-15', 'Bình Dương').map((b) => b.id)).toEqual([9]);
    expect(proposeBooks([book(10, { verificationStatus: 'superseded' })], 'TP. Hồ Chí Minh', '2026-06-15')).toEqual([]);
  });
});

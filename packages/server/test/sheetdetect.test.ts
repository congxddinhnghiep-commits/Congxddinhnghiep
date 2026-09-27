import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyRows, classifySheet, detectHeader, headerFingerprint, parseFlexibleNumber } from '@dutoan/core';
import { parseBuffer } from '../src/importer.js';

const fixture = (f: string) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url));

async function analyze(file: string, sheetName?: string) {
  const sheets = await parseBuffer(fixture(file), file);
  const sheet = sheetName ? sheets.find((s) => s.name === sheetName)! : sheets[0];
  const header = detectHeader(sheet.rows, sheet.merges)!;
  const rows = classifyRows(sheet.rows, header);
  return { sheets, sheet, header, rows, items: rows.filter((r) => r.type === 'item') };
}

describe('parseFlexibleNumber', () => {
  it.each([
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['1.234,5', 1234.5],
    ['18,5', 18.5],
    ['12.50', 12.5],
    ['4.250', 4250],
    ['1.650.000', 1650000],
    ['12 500', 12500],
    ['(1.000)', -1000],
    ['abc', null],
  ])('%s', (s, n) => expect(parseFlexibleNumber(s)).toBe(n));
});

describe('fixture 1 – F1-like layout (2-row merged header, formulas, subtotals)', () => {
  it('classifies all sheets', async () => {
    const { sheets } = await analyze('du-toan-kieu-f1.xlsx', 'DTCT');
    const kinds = sheets.map((s) => classifySheet(s.name, detectHeader(s.rows, s.merges)));
    expect(kinds).toEqual(['tong_hop_chi_phi', 'du_toan_chi_tiet', 'tong_hop_vat_tu']);
  });

  it('detects the 2-row header and the price sub-columns', async () => {
    const { header } = await analyze('du-toan-kieu-f1.xlsx', 'DTCT');
    expect(header.headerRow).toBe(3);
    expect(header.headerRows).toBe(2);
    expect(header.mapping).toMatchObject({ stt: 0, code: 1, name: 2, unit: 3, quantity: 4, priceVL: 5, priceNC: 6, priceM: 7 });
  });

  it('classifies rows: categories, 8 items, subtotals excluded, numbering row skipped', async () => {
    const { rows, items } = await analyze('du-toan-kieu-f1.xlsx', 'DTCT');
    expect(rows.filter((r) => r.type === 'category').map((r) => r.category)).toEqual(['PHẦN MÓNG', 'PHẦN THÂN']);
    expect(items).toHaveLength(8);
    expect(rows.filter((r) => r.type === 'subtotal')).toHaveLength(3);
    expect(rows.find((r) => r.index === 5)!.type).toBe('header');
    expect(items[0]).toMatchObject({ code: 'AB.25112', unit: '100m3', quantity: 2.5, category: 'PHẦN MÓNG' });
    expect(items[4]).toMatchObject({ code: 'AF.12224', quantity: 18.4, category: 'PHẦN THÂN' });
    expect(items[1].prices.vl).toBe(835613);
  });

  it('reads the legacy .xls version identically', async () => {
    const a = await analyze('du-toan-kieu-f1.xlsx', 'DTCT');
    const b = await analyze('du-toan-kieu-f1.xls', 'DTCT');
    expect(b.items.map((i) => [i.code, i.quantity])).toEqual(a.items.map((i) => [i.code, i.quantity]));
  });
});

describe('fixture 2 – free-form BOQ (merged header group, text numbers, warnings)', () => {
  it('maps columns under the "Giá trị dự thầu" group', async () => {
    const { header } = await analyze('boq-tu-do.xlsx');
    expect(header.headerRow).toBe(2);
    expect(header.headerRows).toBe(2);
    expect(header.mapping).toMatchObject({ stt: 0, name: 1, unit: 2, quantity: 3, unitPrice: 4, amount: 5, note: 6 });
    expect(header.mapping.code).toBeUndefined();
  });

  it('parses Vietnamese text numbers and flags zero/duplicate/unknown unit', async () => {
    const { rows, items } = await analyze('boq-tu-do.xlsx');
    expect(rows.filter((r) => r.type === 'category').map((r) => r.category)).toEqual(['PHẦN NỀN MÓNG', 'PHẦN THÂN']);
    expect(items.map((i) => i.quantity)).toEqual([1234.5, 18.5, 96.4, 4250, 55, 0, 320, 320, 4]);
    expect(items[5].warnings).toContain('Khối lượng bằng 0');
    expect(items[6].warnings.join()).toMatch(/Trùng với dòng/);
    expect(items[8].warnings.join()).toMatch(/Đơn vị lạ "khung"/);
    expect(rows.filter((r) => r.type === 'subtotal')).toHaveLength(2);
    expect(rows.filter((r) => r.type === 'note').map((r) => r.name)).toEqual(['Ghi chú: khối lượng tạm tính theo hồ sơ thiết kế cơ sở']);
  });
});

describe('fixture 3 – bilingual Vietnamese–Chinese', () => {
  it('detects bilingual headers, EN-format numbers and 小计/合计 totals', async () => {
    const { header, rows, items } = await analyze('song-ngu-viet-trung.xlsx');
    expect(header.headerRow).toBe(1);
    expect(header.mapping).toMatchObject({ stt: 0, code: 1, name: 2, unit: 3, quantity: 4, unitPrice: 5, amount: 6 });
    expect(items.map((i) => i.quantity)).toEqual([12.5, 1234.5, 60, 40, 520]);
    expect(rows.filter((r) => r.type === 'subtotal')).toHaveLength(2);
    expect(rows.filter((r) => r.type === 'category')).toHaveLength(2);
  });
});

describe('header fingerprint', () => {
  it('is stable for the same layout and differs between layouts', async () => {
    const a = await analyze('du-toan-kieu-f1.xlsx', 'DTCT');
    const b = await analyze('du-toan-kieu-f1.xls', 'DTCT');
    const c = await analyze('boq-tu-do.xlsx');
    expect(headerFingerprint(a.header.labels, a.header.headerRows)).toBe(headerFingerprint(b.header.labels, b.header.headerRows));
    expect(headerFingerprint(a.header.labels, 2)).not.toBe(headerFingerprint(c.header.labels, 2));
  });
});

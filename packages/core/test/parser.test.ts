import { describe, expect, it } from 'vitest';
import { parseCommand, parseVnNumber, searchByCodeOrName } from '@dutoan/core';

describe('parseVnNumber', () => {
  it.each([
    ['1.650.000', 1650000],
    ['1,5', 1.5],
    ['2.5', 2.5],
    ['1,650,000', 1650000],
    ['50', 50],
  ])('%s', (s, n) => expect(parseVnNumber(s)).toBe(n));
});

describe('RuleBasedProvider – Vietnamese commands', () => {
  const cases: [string, Record<string, unknown>][] = [
    [
      'thêm 50 m3 bê tông cột mác 300 vào hạng mục phần thân',
      { kind: 'addItem', quantity: 50, unit: 'm3', normQuery: 'bê tông cột mác 300', categoryName: 'phần thân' },
    ],
    [
      'them 50m3 be tong cot mac 300 vao hang muc phan than',
      { kind: 'addItem', quantity: 50, unit: 'm3', normQuery: 'be tong cot mac 300', categoryName: 'phan than' },
    ],
    ['Thêm AF.12213 khối lượng 12,5 vào Phần móng', { kind: 'addItem', normCode: 'AF.12213', quantity: 12.5, categoryName: 'Phần móng' }],
    ['bổ sung công tác xây tường gạch 25 m3', { kind: 'addItem', quantity: 25, unit: 'm3', normQuery: 'xây tường gạch' }],
    ['hãy thêm bê tông lót móng', { kind: 'addItem', normQuery: 'bê tông lót móng' }],
    ['tìm mã định mức đào đất móng', { kind: 'searchNorm', query: 'đào đất móng' }],
    ['tim dinh muc van khuon cot', { kind: 'searchNorm', query: 'van khuon cot' }],
    ['tra cứu AF.11111', { kind: 'searchNorm', query: 'AF.11111' }],
    [
      'đổi giá xi măng PCB40 thành 1.650.000 đ/tấn',
      { kind: 'setPrice', resourceQuery: 'xi măng PCB40', price: 1650000, priceUnit: 'tan' },
    ],
    ['doi gia xi mang pcb40 thanh 1650000 d/tan', { kind: 'setPrice', resourceQuery: 'xi mang pcb40', price: 1650000, priceUnit: 'tan' }],
    ['cập nhật giá cát vàng là 350 nghìn đồng/m3', { kind: 'setPrice', resourceQuery: 'cát vàng', price: 350000, priceUnit: 'm3' }],
    ['giá thép D10 = 18.500', { kind: 'setPrice', resourceQuery: 'thép D10', price: 18500 }],
    ['đổi giá V00123 thành 1,2 triệu', { kind: 'setPrice', resourceCode: 'V00123', price: 1200000 }],
    ['sửa khối lượng dòng 3 thành 45', { kind: 'updateQuantity', line: 3, quantity: 45 }],
    ['sua kl AF.11111 thanh 2*3,5*0,3', { kind: 'updateQuantity', normCode: 'AF.11111', quantityFormula: '2*3,5*0,3' }],
    ['đổi khối lượng bê tông lót móng thành 7,5', { kind: 'updateQuantity', query: 'bê tông lót móng', quantity: 7.5 }],
    ['tạo hạng mục Phần mái', { kind: 'createCategory', name: 'Phần mái' }],
    ['them hang muc "Cổng tường rào"', { kind: 'createCategory', name: 'Cổng tường rào' }],
    ['tính lại', { kind: 'recalc' }],
    ['tinh toan lai du toan', { kind: 'recalc' }],
    ['xuất excel', { kind: 'exportExcel' }],
    ['xuat file excel du toan', { kind: 'exportExcel' }],
    ['nhập file từ máy tính', { kind: 'importFile' }],
    ['hoàn tác', { kind: 'undo' }],
    ['hướng dẫn', { kind: 'help' }],
  ];

  it.each(cases)('%s', (text, expected) => {
    expect(parseCommand(text)).toMatchObject(expected);
  });

  it('does not take the concrete grade as quantity', () => {
    const r = parseCommand('thêm bê tông cột mác 300 vào phần thân');
    expect(r).toMatchObject({ kind: 'addItem', normQuery: 'bê tông cột mác 300', categoryName: 'phần thân' });
    expect((r as { quantity?: number }).quantity).toBeUndefined();
  });

  it('returns unknown for unrelated text', () => {
    expect(parseCommand('hôm nay trời đẹp').kind).toBe('unknown');
  });
});

describe('searchByCodeOrName', () => {
  const norms = [
    { code: 'AF.11111', name: 'Bê tông lót móng, đá 4x6, mác 100' },
    { code: 'AF.12213', name: 'Bê tông cột tiết diện ≤0,1m2, cao ≤6m, đá 1x2, mác 300' },
    { code: 'AF.12223', name: 'Bê tông cột tiết diện >0,1m2, cao ≤6m, đá 1x2, mác 300' },
    { code: 'AB.11312', name: 'Đào móng băng bằng thủ công, đất cấp II' },
  ];
  it('matches without diacritics', () => {
    expect(searchByCodeOrName(norms, 'dao mong').map((h) => h.item.code)).toEqual(['AB.11312']);
  });
  it('finds ambiguous matches', () => {
    expect(searchByCodeOrName(norms, 'bê tông cột mác 300')).toHaveLength(2);
  });
  it('expands abbreviations', () => {
    expect(searchByCodeOrName(norms, 'bt cot m300')).toHaveLength(2);
  });
  it('matches code prefix', () => {
    expect(searchByCodeOrName(norms, 'AF.12')[0].item.code).toBe('AF.12213');
  });
});

import { describe, expect, it } from 'vitest';
import { computeUnitCost, expandMixDesign, isMixResourceName, type MixDesign, type Resource } from '@dutoan/core';

describe('isMixResourceName', () => {
  it('recognises "Vữa..." placeholders regardless of diacritics/case', () => {
    expect(isMixResourceName('Vữa bê tông')).toBe(true);
    expect(isMixResourceName('vua xi mang')).toBe(true);
    expect(isMixResourceName('Vữa xây, trát')).toBe(true);
    expect(isMixResourceName('Xi măng PCB30')).toBe(false);
    expect(isMixResourceName('Vôi cục')).toBe(false);
  });
});

describe('expandMixDesign', () => {
  const mix: MixDesign = {
    code: '11.11114',
    section: '11.11100 Độ sụt 0,5 ÷ 1 cm',
    spec: 'Đá d = 10mm max (Cỡ 0,5x1cm)',
    kind: 'concrete',
    grade: '250',
    page: 5,
    status: 'imported_needs_review',
    materials: [
      { material: 'Xi măng', unit: 'kg', qty: 360, resourceCode: 'VL.XIMANG.aaa' },
      { material: 'Cát vàng', unit: 'm3', qty: 0.493, resourceCode: 'VL.CATVANG.bbb' },
      { material: 'Đá dăm', unit: 'm3', qty: 0.804, resourceCode: 'VL.DADAM.ccc' },
      { material: 'Nước', unit: 'lít', qty: 185, resourceCode: 'VL.NUOC.ddd' },
      { material: 'Phụ gia', unit: 'kg', qty: 0, resourceCode: null },
    ],
  };
  const nrs = [
    { normCode: 'AF.11213', resourceCode: 'VL.VUABETONG.xxx', consumption: 1.025 },
    { normCode: 'AF.11213', resourceCode: 'NC.NHOM2.yyy', consumption: 1.64 },
  ];

  it('replaces the vữa line with materials scaled by its consumption, keeps other lines', () => {
    const out = expandMixDesign(nrs, 'VL.VUABETONG.xxx', 1.025, mix);
    expect(out.find((r) => r.resourceCode === 'VL.VUABETONG.xxx')).toBeUndefined();
    expect(out.find((r) => r.resourceCode === 'NC.NHOM2.yyy')).toBeDefined();
    const xm = out.find((r) => r.resourceCode === 'VL.XIMANG.aaa')!;
    expect(xm.consumption).toBeCloseTo(1.025 * 360, 6);
    // "Phụ gia" with qty 0 / no resolved resource must not appear.
    expect(out.some((r) => r.resourceCode === null)).toBe(false);
    expect(out).toHaveLength(1 + 4); // NC line + 4 priced materials
  });

  it('feeds a correct VL subtotal into computeUnitCost', () => {
    const resources: Resource[] = [
      { code: 'VL.XIMANG.aaa', name: 'Xi măng', unit: 'kg', type: 'VL', basePrice: 1500 },
      { code: 'VL.CATVANG.bbb', name: 'Cát vàng', unit: 'm3', type: 'VL', basePrice: 350000 },
      { code: 'VL.DADAM.ccc', name: 'Đá dăm', unit: 'm3', type: 'VL', basePrice: 380000 },
      { code: 'VL.NUOC.ddd', name: 'Nước', unit: 'lít', type: 'VL', basePrice: 15 },
      { code: 'NC.NHOM2.yyy', name: 'Nhân công nhóm 2', unit: 'công', type: 'NC', basePrice: 250000 },
    ];
    const out = expandMixDesign(nrs, 'VL.VUABETONG.xxx', 1.025, mix);
    const u = computeUnitCost(out, new Map(resources.map((r) => [r.code, r])));
    const expectedVl = 1.025 * (360 * 1500 + 0.493 * 350000 + 0.804 * 380000 + 185 * 15);
    expect(u.vl).toBeCloseTo(expectedVl, 4);
    expect(u.nc).toBeCloseTo(1.64 * 250000, 6);
  });
});

import { describe, expect, it } from 'vitest';
import { NormIndex, extractParams, normalizeWork, unitFactor } from '@dutoan/core';
import { LABOUR_TT38, sampleNorms } from '../src/seed-data.js';

const norms = sampleNorms(LABOUR_TT38).map(([code, name, unit, group]) => ({ code, name, unit, group }));
const index = new NormIndex(norms);

// Description + unit → expected norm code on the sample dataset (at least 20 cases, Update 2 C5)
const CASES: [string, string, string][] = [
  ['Bê tông lót móng đá 4x6 mác 100', 'm3', 'AF.11111'],
  ['BT móng M250 đá 1x2', 'm3', 'AF.11213'],
  ['Bê tông móng mác 300', 'm3', 'AF.11214'],
  ['Bê tông cột tiết diện ≤0,1m2 mác 300', 'm3', 'AF.12214'],
  ['BTCT cột 30x40 M250', 'm3', 'AF.12223'],
  ['Bê tông dầm giằng B20', 'm3', 'AF.12313'],
  ['bt san mai mac 300', 'm3', 'AF.12414'],
  ['Bê tông cầu thang M250', 'm3', 'AF.12613'],
  ['Bê tông lanh tô, ô văng mác 250', 'm3', 'AF.12513'],
  ['Cốt thép móng đk ≤10mm', 'tấn', 'AF.61110'],
  ['SX lắp dựng CT móng D16', 'tấn', 'AF.61120'],
  ['Cốt thép móng Ø22', 'kg', 'AF.61130'],
  ['CT cột đường kính ≤18mm', 'tấn', 'AF.61421'],
  ['Cốt thép dầm Φ8', 'tấn', 'AF.61511'],
  ['Cốt thép sàn mái d≤10', 'tấn', 'AF.61711'],
  ['Ván khuôn móng', 'm2', 'AF.81111'],
  ['VK cột vuông', 'm2', 'AF.81132'],
  ['Ván khuôn xà dầm, giằng', '100m2', 'AF.81141'],
  ['Ván khuôn sàn mái', 'm2', 'AF.81151'],
  ['Xây tường gạch đặc dày 110 vữa XM M75', 'm3', 'AE.22214'],
  ['Xây tường gạch đặc dày 220', 'm3', 'AE.22224'],
  ['Xây tường gạch rỗng 2 lỗ dày 10cm', 'm3', 'AE.62214'],
  ['Trát tường trong dày 1,5cm vữa M75', 'm2', 'AK.21124'],
  ['Trát tường ngoài', 'm2', 'AK.21224'],
  ['Trát trần', 'm2', 'AK.23114'],
  ['Lát nền gạch ceramic 600x600', 'm2', 'AK.51260'],
  ['Đào móng băng thủ công đất cấp II', 'm3', 'AB.11312'],
  ['Đào móng bằng máy đào, đất C2', 'm3', 'AB.25112'],
  ['Đắp đất nền móng bằng đầm cóc K=0,95', 'm3', 'AB.65120'],
  ['Đắp cát nền móng', 'm3', 'AB.13411'],
  ['Ép cọc BTCT 25x25', 'm', 'AC.26122'],
  ['Nối cọc 25x25', 'mối nối', 'AC.29212'],
  ['Sơn tường trong nhà 1 nước lót 2 nước phủ', 'm2', 'AK.83421'],
  ['Sơn tường ngoài nhà', 'm2', 'AK.84424'],
  ['Bả matit tường', 'm2', 'AK.84114'],
  ['Vận chuyển đất bằng ô tô tự đổ 1km', 'm3', 'AB.41432'],
];

describe('auto code suggestion on the sample norms', () => {
  it.each(CASES)('%s (%s) → %s', (desc, unit, code) => {
    const s = index.suggest(desc, unit);
    expect(s[0]?.norm.code, JSON.stringify(s.slice(0, 3).map((x) => [x.norm.code, x.score.toFixed(2), x.confidence, x.why]))).toBe(code);
  });

  it('gives high confidence for unambiguous descriptions', () => {
    const high = CASES.filter(([d, u]) => (index.suggest(d, u)[0]?.confidence ?? 0) >= 0.8).length;
    expect(high).toBeGreaterThanOrEqual(20);
  });

  it('flags ambiguity (missing cross-section) with low confidence', () => {
    const s = index.suggest('Bê tông cột mác 300', 'm3');
    expect(['AF.12214', 'AF.12224']).toContain(s[0].norm.code);
    expect(s[0].confidence).toBeLessThan(0.8);
    expect(s.map((x) => x.norm.code)).toEqual(expect.arrayContaining(['AF.12214', 'AF.12224']));
  });

  it('treats unit as a hard filter and converts to the norm unit', () => {
    expect(index.suggest('Bê tông cột mác 300', 'm2')).toEqual([]);
    const s = index.suggest('Đào móng bằng máy đào đất cấp II', 'm3')[0];
    expect(s.norm.unit).toBe('100m3');
    expect(s.unitFactor).toBeCloseTo(0.01, 12);
    expect(s.why).toMatch(/quy đổi m3 → 100m3/);
  });

  it('explains why', () => {
    const s = index.suggest('BT móng M250', 'm3')[0];
    expect(s.why).toMatch(/đúng .*mác bê tông/);
  });

  it('searches by code prefix with or without dot', () => {
    expect(index.byCodePrefix('AF.1').length).toBeGreaterThan(5);
    expect(index.byCodePrefix('af11').map((n) => n.code)).toEqual(['AF.11111', 'AF.11213', 'AF.11214']);
  });
});

describe('normalisation helpers', () => {
  it('expands abbreviations and concrete classes', () => {
    expect(normalizeWork('BTCT dầm B20')).toBe('be tong cot thep dam mac 250');
    expect(normalizeWork('VK cột')).toBe('van khuon cot');
    expect(extractParams(normalizeWork('Cốt thép cột đk ≤ 10mm, cao ≤6m'))).toMatchObject({ work: 'cot_thep', member: 'cot', dia: 'le10', height: '6' });
    expect(extractParams(normalizeWork('Xây tường gạch dày 220 vữa XM M75'))).toMatchObject({ work: 'xay', thick: 'le33', mortar: '75' });
    expect(extractParams(normalizeWork('Đào đất cấp III'))).toMatchObject({ work: 'dao', soil: '3' });
  });
  it('converts units', () => {
    expect(unitFactor('m3', '100m3')).toBeCloseTo(0.01, 12);
    expect(unitFactor('kg', 'tấn')).toBeCloseTo(0.001, 12);
    expect(unitFactor('md', 'm')).toBe(1);
    expect(unitFactor('m3', 'm2')).toBeNull();
  });
});

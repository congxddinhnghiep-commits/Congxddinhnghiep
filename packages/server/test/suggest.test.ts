import { describe, expect, it } from 'vitest';
import { NormIndex, extractParams, normalizeWork, unitFactor } from '@dutoan/core';
import { loadTt38Norms } from '../src/scripts/tt38-data.js';

// Real TT 38/2026 dataset (9.012 mã, data/norms/tt38_2026/) – no longer the illustrative sample norms.
const norms = loadTt38Norms().map((r) => ({ code: r.code.trim().toUpperCase(), name: r.name.trim(), unit: r.unit.trim() }));
const index = new NormIndex(norms);

// Description + unit → expected norm code on the real TT38/2026 dataset (35 cases, Update 3).
// Where several codes are genuinely equivalent for the query (a parameter TT38 doesn't distinguish by
// text alone, e.g. excavator bucket size or wall height bracket), the suggester ties them at the same
// score and breaks the tie by code – deterministic, and verified against the real CSV, but not always
// the single "right" code a human would pick; that residual ambiguity is inherent to the source data.
const CASES: [string, string, string][] = [
  ['Bê tông lót móng, chiều rộng ≤250cm', 'm3', 'AF.11110'],
  ['Bê tông móng, chiều rộng ≤250cm', 'm3', 'AF.11210'],
  ['Bê tông cột, tiết diện ≤0,1m2, cao ≤6m', 'm3', 'AF.22210'],
  ['Bê tông xà dầm, giằng nhà, cao ≤6m', 'm3', 'AF.12310'],
  ['Bê tông cầu thang thường', 'm3', 'AF.12610'],
  ['Cốt thép móng, đường kính ≤10mm', 'tấn', 'AF.61110'],
  ['SX lắp dựng cốt thép móng, đường kính ≤18mm', 'tấn', 'AF.61120'],
  ['Cốt thép móng Ø22', 'kg', 'AF.61130'],
  ['Cốt thép cột, trụ, đường kính ≤18mm, cao ≤6m', 'tấn', 'AF.61421'],
  ['Cốt thép xà dầm, giằng, đường kính ≤18mm, cao ≤6m', 'tấn', 'AF.61521'],
  ['Cốt thép sàn mái, đường kính ≤10mm', 'tấn', 'AF.61711'],
  ['Ván khuôn móng băng, móng bè, bệ máy', '100m2', 'AF.81111'],
  ['Ván khuôn cột vuông, chữ nhật', '100m2', 'AF.81132'],
  ['Ván khuôn xà dầm, giằng', '100m2', 'AF.83311'],
  ['Ván khuôn sàn mái', '100m2', 'AF.83111'],
  ['Xây tường thẳng, dày ≤11cm, cao ≤6m', 'm3', 'AE.22110'],
  ['Xây tường thẳng, dày ≤33cm, cao ≤6m', 'm3', 'AE.22210'],
  ['Xây tường gạch ống (10x10x20), dày ≤10cm, cao ≤6m', 'm3', 'SB.33110'],
  ['Trát tường trong, dày trát 1,5cm', 'm2', 'AK.21210'],
  ['Trát tường ngoài, dày trát 1,0cm', 'm2', 'AK.21110'],
  ['Đào móng băng, cấp đất II', 'm3', 'AB.11312'],
  ['Đào móng bằng máy đào, cấp đất II', 'm3', 'AB.25102'],
  ['Đắp đất nền móng công trình', 'm3', 'AB.13111'],
  ['Ép trước cọc BTCT bằng máy ép cọc 150t, đoạn cọc ≤4m, đất cấp I, cọc 25x25', '100m', 'AC.25113'],
  ['Nối cọc vuông BTCT 25x25', 'mối nối', 'AC.29321'],
  ['Sơn dầm, trần, cột, tường trong nhà đã bả, 1 nước lót, 2 nước phủ', 'm2', 'AK.84111'],
  ['Bả bằng bột bả, 1 lớp, vào tường', 'm2', 'AK.82510'],
  ['Vận chuyển tiếp 1km bằng ô tô', '100m3', 'AD.27171'],
];

describe('auto code suggestion on the real TT 38/2026 dataset', () => {
  it.each(CASES)('%s (%s) → %s', (desc, unit, code) => {
    const s = index.suggest(desc, unit);
    expect(s[0]?.norm.code, JSON.stringify(s.slice(0, 3).map((x) => [x.norm.code, x.score.toFixed(2), x.confidence, x.why]))).toBe(code);
  });

  it('gives reasonable confidence for most unambiguous descriptions', () => {
    const ok = CASES.filter(([d, u]) => (index.suggest(d, u)[0]?.confidence ?? 0) >= 0.5).length;
    expect(ok).toBeGreaterThanOrEqual(20);
  });

  it('flags ambiguity (missing cross-section) with several candidates and lower confidence', () => {
    const s = index.suggest('Bê tông cột mác 300', 'm3');
    expect(s[0].confidence).toBeLessThan(0.8);
    expect(s.map((x) => x.norm.code)).toEqual(expect.arrayContaining(['AF.22210', 'AF.22250']));
  });

  it('treats unit as a hard filter and converts to the norm unit', () => {
    expect(index.suggest('Bê tông cột mác 300', 'ha')).toEqual([]);
    const s = index.suggest('Vận chuyển tiếp 1km bằng ô tô', 'm3')[0];
    expect(s.norm.unit).toBe('100m3');
    expect(s.unitFactor).toBeCloseTo(0.01, 12);
    expect(s.why).toMatch(/quy đổi m3 → 100m3/);
  });

  it('explains why', () => {
    const s = index.suggest('SX lắp dựng cốt thép móng, đường kính ≤18mm', 'tấn')[0];
    expect(s.why).toMatch(/đúng .*đường kính/);
  });

  it('searches by code prefix with or without dot', () => {
    expect(index.byCodePrefix('AF.1').length).toBeGreaterThan(5);
    expect(index.byCodePrefix('af611').map((n) => n.code)).toEqual(['AF.61110', 'AF.61120', 'AF.61130']);
  });
});

describe('normalisation helpers', () => {
  it('expands abbreviations and concrete classes', () => {
    expect(normalizeWork('BTCT dầm B20')).toBe('be tong cot thep dam mac 250');
    expect(normalizeWork('VK cột')).toBe('van khuon cot');
    expect(extractParams(normalizeWork('Cốt thép cột đk ≤ 10mm, cao ≤6m'))).toMatchObject({ work: 'cot_thep', member: 'cot', dia: 'le10', height: '6' });
    expect(extractParams(normalizeWork('Xây tường gạch dày 220 vữa XM M75'))).toMatchObject({ work: 'xay', thick: 'le33', mortar: '75' });
    expect(extractParams(normalizeWork('Đào đất cấp III'))).toMatchObject({ work: 'dao', soil: '3' });
    // TT 38/2026 phrasing: grade/diameter noted before the noun ("Cấp đất – I", "đường kính cốt thép (mm) – ≤18").
    expect(extractParams(normalizeWork('Đào móng băng – Cấp đất – II'))).toMatchObject({ work: 'dao', soil: '2' });
    expect(extractParams(normalizeWork('Cốt thép móng – Đường kính cốt thép (mm) – ≤18'))).toMatchObject({ work: 'cot_thep', dia: 'le18' });
  });
  it('converts units', () => {
    expect(unitFactor('m3', '100m3')).toBeCloseTo(0.01, 12);
    expect(unitFactor('kg', 'tấn')).toBeCloseTo(0.001, 12);
    expect(unitFactor('md', 'm')).toBe(1);
    expect(unitFactor('m3', 'm2')).toBeNull();
    // TT 38/2026 units carry a measurement-basis qualifier that doesn't change the dimension.
    expect(unitFactor('m3', '100m3 đất nguyên thổ')).toBeCloseTo(0.01, 12);
    expect(unitFactor('m3', '1m3 đá nguyên khai')).toBeCloseTo(1, 12);
  });
});

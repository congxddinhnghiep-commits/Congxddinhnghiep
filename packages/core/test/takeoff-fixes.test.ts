import { describe, expect, it } from 'vitest';
import {
  ELEMENT_DEFAULTS,
  ELEMENT_PARAM_META,
  elementParamLabel,
  formatDecimalInput,
  parseDecimalInput,
  rankFamilyNorms,
  taskNormHint,
  type ElementType,
} from '@dutoan/core';

// Fixes from manual testing of the take-off tab (after Update 5/6).

describe('parseDecimalInput — decimal comma and dot in take-off inputs', () => {
  it('accepts both 1,8 and 1.8 (never 18)', () => {
    expect(parseDecimalInput('1,8')).toBe(1.8);
    expect(parseDecimalInput('1.8')).toBe(1.8);
    expect(parseDecimalInput(' 0,25 ')).toBe(0.25);
    expect(parseDecimalInput(',5')).toBe(0.5);
    expect(parseDecimalInput('-0,3')).toBe(-0.3);
    expect(parseDecimalInput('12')).toBe(12);
    expect(parseDecimalInput(3.6)).toBe(3.6);
  });

  it('treats a single separator as decimal (dimensions), grouping only when unambiguous', () => {
    expect(parseDecimalInput('1,800')).toBe(1.8);
    expect(parseDecimalInput('1.650.000')).toBe(1650000);
    expect(parseDecimalInput('1.234,5')).toBe(1234.5);
    expect(parseDecimalInput('1,234.5')).toBe(1234.5);
  });

  it('rejects invalid text instead of guessing', () => {
    for (const bad of ['', '  ', 'abc', '1,8,2', '1.8.', '1,2.3,4', '1x2', '--1']) expect(parseDecimalInput(bad)).toBeNull();
  });

  it('formats back with a comma and no float noise', () => {
    expect(formatDecimalInput(1.8)).toBe('1,8');
    expect(formatDecimalInput(0.1 + 0.2)).toBe('0,3');
    expect(formatDecimalInput(10)).toBe('10');
    expect(formatDecimalInput(null)).toBe('');
    expect(parseDecimalInput(formatDecimalInput(2.976))).toBe(2.976);
  });
});

describe('Element parameter labels', () => {
  it('every parameter of every element type has a Vietnamese label, unit and tooltip', () => {
    for (const [type, defaults] of Object.entries(ELEMENT_DEFAULTS)) {
      for (const key of Object.keys(defaults)) {
        const m = ELEMENT_PARAM_META[type as ElementType][key];
        expect(m, `${type}.${key}`).toBeTruthy();
        expect(m.label.length, `${type}.${key}`).toBeGreaterThan(3);
        expect(m.hint.length, `${type}.${key}`).toBeGreaterThan(5);
      }
    }
  });

  it('formats "key – label (unit)"', () => {
    expect(elementParamLabel('mong_don', 'a')).toBe('a – cạnh dài móng (m)');
    expect(elementParamLabel('mong_don', 't_l')).toBe('t_l – chiều dày bê tông lót (m)');
    expect(elementParamLabel('mong_don', 'e_l')).toBe('e_l – mở rộng lót mỗi bên (m)');
    expect(elementParamLabel('mong_don', 'H_d')).toBe('H_d – chiều sâu đào (m)');
    expect(elementParamLabel('mong_don', 'e_tc')).toBe('e_tc – mở rộng thi công mỗi bên (m)');
    expect(elementParamLabel('mong_don', 'm')).toBe('m – hệ số mái dốc');
  });
});

describe('Norm family hints (TT38 PL2)', () => {
  // A slice of the real TT38 names: AF.21110 also contains the words "lót móng" but belongs to the AF.2 table.
  const norms = [
    { code: 'AF.11110', name: 'Bê tông lót móng – Chiều rộng (cm) – ≤250' },
    { code: 'AF.11120', name: 'Bê tông lót móng – Chiều rộng (cm) – >250' },
    { code: 'AF.11210', name: 'Bê tông móng – Chiều rộng (cm) – ≤250' },
    { code: 'AF.21110', name: 'Bê tông lót móng Bê tông móng – Lót móng' },
    { code: 'AF.12210', name: 'Bê tông cột – Tiết diện cột (m2) – ≤ 0,1 – Chiều cao (m) – ≤ 6' },
    { code: 'AF.12220', name: 'Bê tông cột – Tiết diện cột (m2) – ≤ 0,1 – Chiều cao (m) – ≤ 28' },
    { code: 'AF.12230', name: 'Bê tông cột – Tiết diện cột (m2) – > 0,1 – Chiều cao (m) – ≤ 6' },
    { code: 'AF.12240', name: 'Bê tông cột – Tiết diện cột (m2) – > 0,1 – Chiều cao (m) – ≤ 28' },
  ];

  it('"Bê tông lót móng" of M1 (1,8×1,2) → AF.11110 (≤250 cm), never AF.21110', () => {
    const hint = taskNormHint('mong_don', 'bt_lot', { a: 1.8, b: 1.2, e_l: 0.1 })!;
    expect(hint.family).toBe('AF.111');
    const ranked = rankFamilyNorms(norms, hint);
    expect(ranked[0].norm.code).toBe('AF.11110');
    expect(ranked[0].confidence).toBeGreaterThanOrEqual(0.8);
    expect(ranked.map((r) => r.norm.code)).not.toContain('AF.21110');
  });

  it('wide footing pad → AF.11120 (>250 cm)', () => {
    const ranked = rankFamilyNorms(norms, taskNormHint('mong_don', 'bt_lot', { a: 3, b: 2.6, e_l: 0.1 })!);
    expect(ranked[0].norm.code).toBe('AF.11120');
  });

  it('column 0,3×0,4 (0,12 m² > 0,1) on a tầng with top elevation 7,2 m → AF.12240; unknown height is only a suggestion', () => {
    const onStory = rankFamilyNorms(norms, taskNormHint('cot', 'bt_cot', { b: 0.3, h: 0.4, H: 3.6 }, { topElevationM: 7.2 })!);
    expect(onStory[0].norm.code).toBe('AF.12240');
    expect(onStory[0].confidence).toBeGreaterThanOrEqual(0.8);
    const small = rankFamilyNorms(norms, taskNormHint('cot', 'bt_cot', { b: 0.2, h: 0.2, H: 3.3 })!);
    expect(small[0].norm.code).toBe('AF.12210');
  });

  it('tasks without a family (ván khuôn, đào…) return null → generic engine', () => {
    expect(taskNormHint('mong_don', 'vk_mong', {})).toBeNull();
    expect(taskNormHint('mong_don', 'dao_mong', {})).toBeNull();
  });
});

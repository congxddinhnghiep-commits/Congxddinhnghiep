import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  canonicalNormCode,
  computeEstimate,
  computeQuantityLines,
  detectDominantEncoding,
  detectEncoding,
  evaluateQuantity,
  evaluateRuleSet,
  expandResource,
  parseQuantity,
  parseVariables,
  QuantityError,
  selectRuleSet,
  tcvn3ToUnicode,
  toUnicode,
  unitFactor,
  vniToUnicode,
  type CostRuleSet,
} from '@dutoan/core';

const skill = new URL('../../../.claude/skills/construction-estimation-engine/', import.meta.url);
const cases: { test_cases: Record<string, unknown>[] } = JSON.parse(fs.readFileSync(new URL('test_cases.json', skill), 'utf8'));
const legacy: CostRuleSet = JSON.parse(fs.readFileSync(new URL('../../../data/cost-rules/legacy-observed.json', import.meta.url), 'utf8'));

/** Flag used for broken formulas / external links (see server import). */
function flagCell(v: string): string | null {
  return /^#(NAME\?|REF!|VALUE!|DIV\/0!|N\/A|NULL!|NUM!)$/.test(v.trim()) ? 'FLAG_EXTERNAL_LINK_OR_BROKEN_FORMULA' : null;
}

/** Runs every case of the skill's test_cases.json (Section F9). */
describe('construction-estimation-engine test_cases.json', () => {
  it('has the expected cases', () => {
    expect(cases.test_cases.map((c) => c.id)).toEqual(['QTY-001', 'QTY-002', 'NORM-001', 'COST-001', 'COST-002', 'IMPORT-001', 'IMPORT-002', 'VALID-001']);
  });
  it.each(cases.test_cases.map((c) => [c.id as string, c]))('%s', (id, c) => {
    const tc = c as Record<string, unknown>;
    if (id.startsWith('QTY')) {
      expect(evaluateQuantity(tc.input as string)).toBeCloseTo(tc.expected as number, 9);
    } else if (id.startsWith('NORM')) {
      expect(expandResource(tc.quantity as number, tc.norm_consumption as number, tc.coefficient as number)).toBeCloseTo(tc.expected as number, 9);
    } else if (id === 'COST-001') {
      // rule "TT=1.5%*(VL+NC+M)" from the reference-only legacy set
      const v = evaluateRuleSet({ ...legacy, rules: legacy.rules.filter((r) => r.key === 'TT') }, tc.variables as Record<string, number>).values;
      expect(v.TT).toBe(tc.expected_TT_rounded_source);
    } else if (id === 'COST-002') {
      const v = evaluateRuleSet({ ...legacy, variables: ['T'], rules: legacy.rules.filter((r) => r.key === 'C') }, tc.variables as Record<string, number>).values;
      expect(v.C).toBe(tc.expected_C_rounded_source);
    } else if (id === 'IMPORT-001') {
      expect(canonicalNormCode(tc.raw_code as string)).toMatchObject({ raw: tc.raw_code, normalized: tc.expected_normalized, kind: 'norm' });
    } else if (id === 'IMPORT-002') {
      expect(canonicalNormCode(tc.raw_code as string).pricingMethod).toBe(tc.expected_pricing_method);
    } else if (id === 'VALID-001') {
      expect(flagCell(tc.input_error as string)).toBe(tc.expected);
    } else throw new Error(`Unhandled test case ${id}`);
  });
});

describe('safe quantity parser (AST whitelist, no eval)', () => {
  it.each([
    ['6.6*14.2*3.8', 356.136],
    ['12.1*6.2*0.1 + 1.8*5.6*0.1', 8.51],
    ['(2+3)*4', 20],
    ['2x3,5x0,3', 2.1],
    ['-2*3', -6],
    ['100*15%', 15],
    ['1,000,000,000/1e9', 1],
    ['1.000.000.000 / 1000', 1_000_000],
  ])('%s = %d', (e, v) => expect(evaluateQuantity(e)).toBeCloseTo(v, 9));

  it('supports variables and rejects anything outside the whitelist', () => {
    expect(evaluateQuantity('(L+W)*2*H*N', { L: 6, W: 4, H: 3.3, N: 2 })).toBeCloseTo(132, 9);
    expect(evaluateQuantity('X*2', { X: 3 })).toBe(6);
    expect(() => evaluateQuantity('L*W', { L: 2 })).toThrow(/Biến "W"/);
    for (const bad of ['process.exit()', 'constructor', '__proto__', '2**3', 'a;b', '`1`', '1/0', '((((', 'alert("x")', '2 + ', '']) {
      expect(() => evaluateQuantity(bad)).toThrow();
    }
    expect(() => parseQuantity('1+'.repeat(300) + '1')).toThrow(QuantityError);
    expect(() => parseQuantity('('.repeat(60) + '1' + ')'.repeat(60))).toThrow(/lồng quá sâu/);
  });

  it('parses variable lists', () => {
    expect(parseVariables('L=6,6; W=14.2 H=3,8')).toEqual({ L: 6.6, W: 14.2, H: 3.8 });
    expect(() => parseVariables('L 6')).toThrow();
  });
});

describe('quantity lines with deductions and unit conversion', () => {
  it('sums lines, subtracts documented deductions and converts mm³ → m³', () => {
    // Tường 13 × 5,4 × 0,1 = 7,02 m3; trừ 9 cửa 0,6 × 0,6 × 0,1 = 0,324 m3; cột 400×400×3300 mm × 2 = 1,056 m3
    const r = computeQuantityLines(
      [
        { description: 'Tường trục A', expression: '13*5.4*0.1' },
        { description: 'Trừ cửa sổ', expression: '9*0.6*0.6*0.1', sign: -1 },
        { description: 'Cột (mm)', expression: 'L*W*H*N', variables: { L: 400, W: 400, H: 3300, N: 2 }, unit: 'mm3' },
      ],
      'm3',
    );
    expect(r.errors).toBe(0);
    expect(r.lines.map((l) => l.result)).toEqual([7.02, -0.324, 1.056]);
    expect(r.total).toBeCloseTo(7.752, 9);
  });

  it('flags incompatible units and undocumented negative lines', () => {
    const r = computeQuantityLines(
      [
        { expression: '10', unit: 'm2' },
        { expression: '-3' },
      ],
      'm3',
    );
    expect(r.lines[0].error).toMatch(/không quy đổi được/);
    expect(r.lines[1].warnings[0]).toMatch(/phần trừ/);
    expect(unitFactor('mm', 'm')).toBeCloseTo(0.001, 12);
    expect(unitFactor('cm2', 'm2')).toBeCloseTo(0.0001, 12);
    expect(unitFactor('m3', '100m3')).toBeCloseTo(0.01, 12);
  });
});

describe('norm code canonicalisation', () => {
  it.each([
    ['AF11121', 'AF.11121', 'norm'],
    ['af.11121', 'AF.11121', 'norm'],
    [' AF 11121 ', 'AF.11121', 'norm'],
    ['AB.25112', 'AB.25112', 'norm'],
    ['GTT', 'GTT', 'custom'],
    ['gtt-01', 'GTT', 'custom'],
    ['TT', 'GTT', 'custom'],
    ['ZZ.9', 'ZZ.9', 'other'],
    ['', '', 'empty'],
  ])('%s → %s', (raw, n, kind) => expect(canonicalNormCode(raw)).toMatchObject({ normalized: n, kind }));
});

describe('legacy Vietnamese encodings', () => {
  it('converts VNI-Windows text', () => {
    expect(vniToUnicode('Ñaøo ñaát coâng trình')).toBe('Đào đất công trình');
    expect(vniToUnicode('Ñaép caùt neàn ñöôøng daøy 10cm  ñoä chaët K95')).toBe('Đắp cát nền đường dày 10cm  độ chặt K95');
    expect(vniToUnicode('Xaây töôøng gaïch oáng 8x8x19 chieàu daày <=10cm h<=4m M75')).toBe('Xây tường gạch ống 8x8x19 chiều dầy <=10cm h<=4m M75');
    expect(vniToUnicode('Beton loùt moùng roäng > 250cm ñaù 4x6 M100')).toBe('Beton lót móng rộng > 250cm đá 4x6 M100');
    expect(vniToUnicode('BEÂ TOÂNG')).toBe('BÊ TÔNG');
    expect(vniToUnicode('Taán')).toBe('Tấn');
  });

  it('converts TCVN3 (ABC) text', () => {
    expect(tcvn3ToUnicode('Bª t«ng lãt mãng')).toBe('Bê tông lót móng');
    expect(tcvn3ToUnicode('C«ng')).toBe('Công');
    expect(detectEncoding('Bª t«ng lãt mãng ®¸ 4x6')).toBe('tcvn3');
  });

  it('detects encodings and leaves Unicode / ASCII untouched', () => {
    expect(detectEncoding('Ñaøo ñaát')).toBe('vni');
    expect(detectEncoding('Đào đất')).toBe('unicode');
    expect(detectEncoding('M3')).toBe('plain');
    expect(toUnicode('Đào đất')).toBe('Đào đất');
  });

  it('converts the parsed_xlsx_code_catalog.csv fixture (codes canonicalised, raw kept)', () => {
    const csv = fs.readFileSync(new URL('parsed_xlsx_code_catalog.csv', skill), 'utf8').replace(/^﻿/, '');
    const rows = csv
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .map((line) => {
        const m = /^([^,]*),("(?:[^"]|"")*"|[^,]*),(\d+),(.*)$/.exec(line)!;
        return { code: m[1], raw: m[2].replace(/^"|"$/g, '').replace(/""/g, '"') };
      });
    expect(rows.length).toBeGreaterThan(50);
    const dom = detectDominantEncoding(rows.map((r) => r.raw));
    expect(dom.encoding).toBe('vni');
    const converted = rows.map((r) => ({ code: canonicalNormCode(r.code), raw: r.raw, text: toUnicode(r.raw, 'vni') }));
    // every converted text is free of VNI mark sequences, raw text is kept separately
    for (const c of converted) {
      expect(c.text).not.toMatch(/[Ññøûï]/);
      expect(c.raw).not.toBe('');
    }
    const byCode = (code: string) => converted.filter((c) => c.code.normalized === code).map((c) => c.text);
    expect(byCode('AB.13113')).toEqual(['Đắp đất công trình']);
    expect(byCode('AF.11111')[0]).toBe('Beton lót  đá 4x6 M100 cho nền');
    expect(converted.every((c) => c.code.kind === 'norm' || c.code.kind === 'custom' || c.code.kind === 'other')).toBe(true);
    expect(converted.filter((c) => c.code.kind === 'norm').length).toBeGreaterThan(40);
  });
});

describe('cost rule sets', () => {
  it('never selects the legacy reference-only variants as defaults', () => {
    expect(legacy.status).toBe('reference_only');
    expect(selectRuleSet([legacy], '2026-09-01')).toBeNull();
  });
  it('evaluates a full rule chain with traced values and rejects unknown variables', () => {
    const r = evaluateRuleSet(legacy, { VL: 0, NC: 61906, M: 0 });
    expect(r.values).toMatchObject({ TT: 929, T: 62835, C: 3770 });
    expect(r.trace.map((t) => t.key)).toEqual(['TT', 'T', 'C', 'TL', 'G', 'VAT', 'Gs', 'Glt', 'Gdt']);
    expect(() => evaluateRuleSet({ ...legacy, rules: [{ key: 'X', formula: 'Y*2' }] }, { VL: 1, NC: 1, M: 1 })).toThrow(/không nằm trong danh sách/);
  });
});

describe('resource expansion with coefficient in the estimate', () => {
  it('uses norm coefficient', () => {
    const r = computeEstimate({
      categories: [{ id: 1, name: 'A', order: 1 }],
      items: [{ id: 1, categoryId: 1, order: 1, normCode: 'N', name: 'x', unit: 'm3', quantity: 8.51 }],
      normResources: [{ normCode: 'N', resourceCode: 'XM', consumption: 256.25, coefficient: 1.1 }],
      resources: [{ code: 'XM', name: 'Xi măng', unit: 'kg', type: 'VL', basePrice: 2 }],
    });
    expect(r.resourceSummary[0].quantity).toBeCloseTo(8.51 * 256.25 * 1.1, 9);
  });
});

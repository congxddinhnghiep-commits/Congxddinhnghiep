import { describe, expect, it } from 'vitest';
import { computeElementTasks, computeQuickRow, computeRebarRow, evaluateManualFormula } from '@dutoan/core';

const task = (tasks: ReturnType<typeof computeElementTasks>, key: string) => {
  const t = tasks.find((x) => x.key === key);
  if (!t) throw new Error(`Task "${key}" not generated`);
  return t;
};

describe('Update 5 I.1-2 — Móng đơn', () => {
  const base = { a: 1.8, b: 1.2, h: 0.5, t_l: 0.1, e_l: 0.1, H_d: 1.5, e_tc: 0.3, m: 0 };

  it('I.1 m=0 (straight pit)', () => {
    const tasks = computeElementTasks('mong_don', base, 10);
    expect(task(tasks, 'bt_mong').value).toBeCloseTo(10.8, 3);
    expect(task(tasks, 'bt_lot').value).toBeCloseTo(2.8, 3);
    expect(task(tasks, 'vk_mong').value).toBeCloseTo(30, 3);
    expect(task(tasks, 'dao_mong').value).toBeCloseTo(78, 3);
    expect(task(tasks, 'dap_dat').value).toBeCloseTo(64.4, 3);
  });

  it('I.2 m=0,5 (sloped pit)', () => {
    const tasks = computeElementTasks('mong_don', { ...base, m: 0.5 }, 10);
    expect(task(tasks, 'dao_mong').perUnit).toBeCloseTo(14.1, 3);
    expect(task(tasks, 'dao_mong').value).toBeCloseTo(141, 3);
  });
});

it('I.3 Cột C1 0,3×0,4; H=3,6; h dầm 0,5; count 8', () => {
  const tasks = computeElementTasks('cot', { b: 0.3, h: 0.4, H: 3.6, h_dam: 0.5 }, 8);
  expect(task(tasks, 'bt_cot').value).toBeCloseTo(2.976, 3);
  expect(task(tasks, 'vk_cot').value).toBeCloseTo(34.72, 3);
});

it('I.4 Dầm D1 0,22×0,5; L=4,6; h sàn 0,12; count 6', () => {
  const tasks = computeElementTasks('dam', { b: 0.22, h: 0.5, L: 4.6, h_san: 0.12 }, 6);
  expect(task(tasks, 'bt_dam').value).toBeCloseTo(3.036, 3);
  expect(task(tasks, 'vk_dam').value).toBeCloseTo(27.048, 3);
});

it('I.5 Sàn S=20, lỗ 1, dày 0,12', () => {
  const tasks = computeElementTasks('san', { S: 20, S_lo: 1, t: 0.12 }, 1);
  expect(task(tasks, 'bt_san').value).toBeCloseTo(2.28, 3);
  expect(task(tasks, 'vk_san').value).toBeCloseTo(19, 3);
});

it('I.6 Tường xây L=5; H=3,1; dày=0,2; cửa 2,64 m²', () => {
  const tasks = computeElementTasks('tuong_xay', { L: 5, H: 3.1, day: 0.2, S_cua: 2.64 }, 1);
  expect(task(tasks, 'dt_tuong').value).toBeCloseTo(12.86, 3);
  expect(task(tasks, 'xay_tuong').value).toBeCloseTo(2.572, 3);
  expect(task(tasks, 'trat_2mat').value).toBeCloseTo(25.72, 3);
});

it('I.7 Rebar Ø16, 6200mm, 12 thanh/cấu kiện, 8 cấu kiện', () => {
  const r = computeRebarRow({ diaMm: 16, chieuDai1ThanhMm: 6200, soThanh1CauKien: 12, soCauKien: 8 });
  expect(r.tongChieuDaiM).toBeCloseTo(595.2, 3);
  expect(r.tongTrongLuongKg).toBeCloseTo(940.416, 3);
  expect(r.group).toBe('le18');
});

it('I.8 Quick table n=4, A=2,5, L=6, H=3', () => {
  const r = computeQuickRow({ n: 4, a: 2.5, l: 6, h: 3 });
  expect(r.area).toBeCloseTo(10, 3);
  expect(r.length).toBeCloseTo(24, 3);
  expect(r.volume).toBeCloseTo(30, 3);
  expect(r.lateralArea).toBeCloseTo(72, 3);
});

it('I.9 Expression a=3,5; b=4,2; 2*(a+b)*0,2*3 // tường bao', () => {
  const r = evaluateManualFormula('a=3,5; b=4,2; 2*(a+b)*0,2*3 // tường bao');
  expect(r.value).toBeCloseTo(9.24, 3);
  expect(r.variables).toEqual({ a: 3.5, b: 4.2 });
});

it('manual formula functions (tron, dt_tron, tt_chop_cut, pi)', () => {
  expect(evaluateManualFormula('tron(3.14159, 2)').value).toBeCloseTo(3.14, 3);
  expect(evaluateManualFormula('dt_tron(2)').value).toBeCloseTo(Math.PI, 3);
  expect(evaluateManualFormula('a=2,6; b=2; a2=4,1; b2=3,5; tt_chop_cut(a,b,a2,b2,1,5)').value).toBeCloseTo(14.1, 3);
  expect(evaluateManualFormula('2*pi').value).toBeCloseTo(2 * Math.PI, 6);
});

it('optional tasks stay off unless enabled, and can be forced on', () => {
  const off = computeElementTasks('tuong_xay', { L: 5, H: 3.1, day: 0.2, ba_son: 1 }, 1);
  // ba_son: condition reads the params flag, so it switches on by param, not by `opts.enabled`
  expect(task(off, 'ba_son').value).toBeCloseTo(31, 3);
  const noBaSon = computeElementTasks('tuong_xay', { L: 5, H: 3.1, day: 0.2 }, 1);
  expect(noBaSon.find((t) => t.key === 'ba_son')).toBeUndefined();
});

it('hoàn thiện uses the element name and L vs S for unit', () => {
  const tasks = computeElementTasks('hoan_thien', { S: 12 }, 3, { elementName: 'Lát gạch sân thượng' });
  expect(task(tasks, 'hoan_thien').name).toBe('Lát gạch sân thượng');
  expect(task(tasks, 'hoan_thien').unit).toBe('m2');
  expect(task(tasks, 'hoan_thien').value).toBeCloseTo(36, 3);
});

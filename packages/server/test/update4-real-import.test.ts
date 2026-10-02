import fs from 'node:fs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { runImportTt38 } from '../src/scripts/import-tt38.js';
import { seedAdmin } from '../src/seed.js';

// Update 4 A-bis (docs/update4/REAL-FILE-FINDINGS.md): a synthetic stand-in for the user's real .xls workbook
// (legacy BIFF, hidden sheets, several blocks per sheet, VNI/TCVN3 mixed with Unicode in the same cell,
// Vietnamese+Chinese bilingual names, no norm-code column, a TONGHOP summary sheet).
const db = openDb(':memory:');
seedAdmin(db, 'admin', 'admin123');
runImportTt38(db);
const app = createApp(db, { serveWeb: false });
let token = '';
const A = () => ({ Authorization: `Bearer ${token}` });
const fx = (f: string) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
const expected = JSON.parse(fs.readFileSync(new URL('./fixtures/import_tuchang_like.expected.json', import.meta.url), 'utf8'));

beforeAll(async () => {
  const t = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' })).body.token;
  token = (await request(app).post('/api/auth/change-password').set({ Authorization: `Bearer ${t}` }).send({ oldPassword: 'admin123', newPassword: 'MatKhau2026!' })).body.token;
});

async function upload() {
  const r = await request(app).post('/api/import/upload').set(A()).attach('file', fx('import_tuchang_like.xls'), 'import_tuchang_like.xls');
  expect(r.status).toBe(200);
  return r.body.fileId as string;
}
async function newProject(name: string) {
  return (await request(app).post('/api/projects').set(A()).send({ name, priceDate: '2026-09-01' })).body.id as number;
}

describe('A-bis .xls (BIFF) with hidden sheets, several blocks per sheet and a TONGHOP summary', () => {
  it('lists hidden sheets separately and finds every block without user action', async () => {
    const fileId = await upload();
    const pid = await newProject('Tu Chang like – overview');
    const r = (await request(app).post('/api/import/analyze-multi').set(A()).send({ fileId, projectId: pid })).body;
    expect(r.sheets.find((s: { name: string }) => s.name.includes('Bang tra 79-2017')).hidden).toBe(true);
    const building = r.sheets.find((s: { name: string }) => s.name === expected.sheet_building);
    expect(building.blocks).toBe(2);
    const mep = r.sheets.find((s: { name: string }) => s.name === expected.sheet_mep);
    expect(mep.blocks).toBe(1);
    expect(r.blocks).toHaveLength(3);
  });

  it('nested MEP subtotals ("A" ⊃ "I" ⊃ "I.1") never appear as công việc, and a lump-sum leaf ("II", chỉ có Thành tiền) is kept as 1 trọn gói', async () => {
    const fileId = await upload();
    const pid = await newProject('Tu Chang like – nested subtotals');
    const r = (await request(app).post('/api/import/analyze-multi').set(A()).send({ fileId, projectId: pid })).body;
    const mep = r.blocks.find((b: { sheetName: string }) => b.sheetName === expected.sheet_mep);
    for (const stt of expected.mep_nested_categories) {
      const row = mep.preview.find((p: { stt: string }) => p.stt === stt);
      expect(row, `thiếu dòng hạng mục "${stt}"`).toBeTruthy();
      expect(row.type, `"${stt}" phải là hạng mục, không phải công việc`).toBe('category');
    }
    const lump = expected.mep_lump_sum as { stt: string; name: string; tt: number };
    const lumpRow = mep.preview.find((p: { name: string }) => p.name === lump.name);
    expect(lumpRow, `thiếu dòng trọn gói "${lump.name}"`).toBeTruthy();
    expect(lumpRow.quantity).toBe(1);
    expect(lumpRow.amount).toBe(lump.tt);
    // the block still reconciles exactly (827tr = 447tr của "I" + 380tr trọn gói của "II"), nested or not
    expect(mep.ok).toBe(true);
    expect(mep.total).toBe(expected.mep_total);
  });

  it('reconciles every block against its own "Cộng trước thuế" and the sheet against TONGHOP', async () => {
    const fileId = await upload();
    const pid = await newProject('Tu Chang like – reconciliation');
    const r = (await request(app).post('/api/import/analyze-multi').set(A()).send({ fileId, projectId: pid })).body;
    const [b1, b2] = r.blocks.filter((b: { sheetName: string }) => b.sheetName === expected.sheet_building);
    expect(b1.total).toBe(expected.blocks[0].total);
    expect(b1.ok).toBe(true);
    expect(b2.total).toBe(expected.blocks[1].total);
    expect(b2.ok).toBe(true);
    const mep = r.blocks.find((b: { sheetName: string }) => b.sheetName === expected.sheet_mep);
    expect(mep.total).toBe(expected.mep_total);
    expect(mep.ok).toBe(true);
    expect(mep.tbvt).toBe(expected.mep_rows.length); // equipment rows need no norm code
    expect(r.grand.total).toBe(expected.grand_total);
    expect(r.allOk).toBe(true);
    expect(r.summary.sheetName).toContain('TONGHOP');
    expect(r.summary.totalCheck.ok).toBe(true);
    expect(r.summary.totalCheck.file).toBe(expected.grand_total);
    expect(r.summary.matches.every((m: { ok: boolean | null }) => m.ok !== false)).toBe(true);
  });

  it('imports every block as its own hạng mục with converted names, units, Chinese split off, and breakdown rows attached', async () => {
    const fileId = await upload();
    const pid = await newProject('Tu Chang like – import');
    const r = (await request(app).post(`/api/projects/${pid}/import-sheets`).set(A()).send({ fileId })).body;
    expect(r.blocks).toHaveLength(3);
    expect(r.allOk).toBe(true);
    expect(r.tbvt).toBe(expected.mep_rows.length);

    const est = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body as {
      categories: { items: { id: number; name: string; nameZh?: string | null; unit: string; quantity: number; amount: { total: number }; source: { code: string | null } | null; codeStatus: string; pricingMethod: string }[] }[];
    };
    const items = est.categories.flatMap((c) => c.items);
    // match by converted Vietnamese name (per names_expected)
    for (const [, name] of Object.entries(expected.names_expected) as [string, string][]) {
      const it = items.find((x) => x.name === name);
      expect(it, `thiếu công việc tên "${name}"`).toBeTruthy();
    }
    for (const [key, unit] of Object.entries(expected.units_expected) as [string, string][]) {
      const name = expected.names_expected[key];
      const it = name ? items.find((x) => x.name === name) : items.find((x) => x.unit === unit);
      if (name) expect(it!.unit, `đơn vị của "${name}"`).toBe(unit);
    }
    const dao = items.find((x) => x.name === expected.names_expected['1']);
    expect(dao!.nameZh).toBe(expected.chinese_expected['1']);
    expect(dao!.quantity).toBe(86.4); // the file's own quantity, even though the breakdown rows sum to 43.2

    // unpriced item ("Lát gạch 600x600 (chưa có giá)") kept, zero price
    const unpriced = items.find((x) => x.name.includes('chưa có giá'));
    expect(unpriced).toBeTruthy();

    // MEP equipment rows: "thiết bị / vật tư theo báo giá", not "cần xem lại" / flooding the suggestion list
    const recloser = items.find((x) => x.name.includes('Recloser'));
    expect(recloser!.codeStatus).toBe('tbvt');
    const sugg = (await request(app).get(`/api/projects/${pid}/suggestions`).set(A())).body as { itemId: number }[];
    expect(sugg.some((s) => s.itemId === recloser!.id)).toBe(false);

    // the lump-sum leaf ("II", no KL/ĐVT – only Thành tiền) imports as 1 trọn gói, not dropped nor double-counted,
    // and the nested subtotal headings above it never show up as công việc of their own
    const lump = expected.mep_lump_sum as { stt: string; name: string; tt: number };
    const lumpItem = items.find((x) => x.name === lump.name);
    expect(lumpItem, `thiếu công việc trọn gói "${lump.name}"`).toBeTruthy();
    expect(lumpItem!.quantity).toBe(1);
    expect(lumpItem!.amount.total).toBe(lump.tt);
    for (const stt of ['A', 'I', 'I.1'] as const) expect(items.some((x) => x.name === stt)).toBe(false);
  });

  it('suggests the expected norm chapter per work (PL6 sửa chữa chapters excluded) for every coded line', async () => {
    const fileId = await upload();
    const pid = await newProject('Tu Chang like – codes');
    await request(app).post(`/api/projects/${pid}/import-sheets`).set(A()).send({ fileId });
    const sugg = (await request(app).get(`/api/projects/${pid}/suggestions`).set(A())).body as { itemId: number; candidates: { code: string }[] }[];
    const est = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body as { categories: { items: { id: number; name: string }[] }[] };
    const items = est.categories.flatMap((c) => c.items);
    // "Đập đầu cọc" is counted by the file in "cái" (số cọc) while the only official TT38 norm for pile-head breaking
    // (AA.224xx) is priced per m3 – a genuine unit mismatch the user must resolve by hand, not a matcher bug, so no
    // confident suggestion is expected there; every other coded line must get one, in the right chapter.
    const unitMismatch = new Set(['1c']);
    for (const [key, family] of Object.entries(expected.expected_code_family) as [string, string][]) {
      const name = expected.names_expected[key];
      if (!name || unitMismatch.has(key)) continue; // only check entries we also assert the name for
      const it = items.find((x) => x.name === name)!;
      const s = sugg.find((x) => x.itemId === it.id);
      expect(s, `không có gợi ý mã cho "${name}"`).toBeTruthy();
      expect(s!.candidates[0]?.code.toUpperCase().startsWith(family), `"${name}" → ${s!.candidates[0]?.code}, muốn ${family}*`).toBe(true);
      expect(/^S[A-Z]/i.test(s!.candidates[0]?.code ?? '')).toBe(false); // PL6 repair chapters never suggested here
    }
  });
});

describe('fidelity: a row whose own Thành tiền disagrees with KL×đơn giá (stt 8, "Lợp tole…": file ghi 0 dù có đơn giá VL/NC)', () => {
  const fm = expected.fidelity_mismatch as { stt: string; name: string; fileAmount: number; calcAmount: number };

  it('analyze-multi: the block still reconciles exactly with "Cộng trước thuế" by default (keeps the file\'s Thành tiền)', async () => {
    const fileId = await upload();
    const pid = await newProject('Fidelity – analyze');
    const r = (await request(app).post('/api/import/analyze-multi').set(A()).send({ fileId, projectId: pid })).body;
    const b1 = r.blocks.find((b: { sheetName: string; blockIndex: number }) => b.sheetName === expected.sheet_building && b.blockIndex === 0);
    expect(b1.ok).toBe(true);
    expect(b1.total).toBe(expected.blocks[0].total); // 788.454.000, unchanged by the mismatched row
    const row = b1.preview.find((p: { name: string }) => p.name === fm.name);
    expect(row.amount).toBe(fm.fileAmount); // the grid preview shows what will actually be imported
    expect(row.amountMode).toBe('file');
  });

  it('import: the item\'s applied amount is the file\'s Thành tiền, flagged and toggleable; the block total matches the file exactly', async () => {
    const fileId = await upload();
    const pid = await newProject('Fidelity – import default');
    const r = (await request(app).post(`/api/projects/${pid}/import-sheets`).set(A()).send({ fileId })).body;
    expect(r.allOk).toBe(true);

    const est = async () => (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body as {
      categories: { name: string; total: { total: number }; items: { id: number; name: string; amount: { total: number }; amountMode?: string | null; note?: string | null }[] }[];
    };
    let data = await est();
    const items = data.categories.flatMap((c) => c.items);
    const row = items.find((x) => x.name === fm.name)!;
    expect(row).toBeTruthy();
    expect(row.amount.total).toBe(fm.fileAmount); // 0 đ, exactly the file's own Thành tiền
    expect(row.amountMode).toBe('file');
    expect(row.note ?? '').toMatch(/Thành tiền theo file/);
    const cat = data.categories.find((c) => c.items.some((x) => x.id === row.id))!;
    const catTotalBefore = cat.total.total;

    // per-row toggle: "Tính lại theo KL×đơn giá"
    await request(app).put(`/api/projects/${pid}/items/${row.id}/amount-mode`).set(A()).send({ mode: 'calc' }).expect(200);
    data = await est();
    const after = data.categories.flatMap((c) => c.items).find((x) => x.id === row.id)!;
    expect(after.amount.total).toBe(fm.calcAmount); // 300 × (180.000 + 95.000) = 82.500.000
    expect(after.amountMode).toBe('calc');
    const catAfter = data.categories.find((c) => c.items.some((x) => x.id === row.id))!;
    expect(catAfter.total.total).toBe(catTotalBefore + fm.calcAmount);

    // toggle back
    await request(app).put(`/api/projects/${pid}/items/${row.id}/amount-mode`).set(A()).send({ mode: 'file' }).expect(200);
    data = await est();
    expect(data.categories.flatMap((c) => c.items).find((x) => x.id === row.id)!.amount.total).toBe(fm.fileAmount);
  });

  it('bulk "Tính lại theo KL×đơn giá" option: the whole import recomputes from KL×đơn giá, correctly breaking the match with the file', async () => {
    const fileId = await upload();
    const pid = await newProject('Fidelity – bulk calc');
    const r = (await request(app).post(`/api/projects/${pid}/import-sheets`).set(A()).send({ fileId, amountFidelity: 'calc' })).body;
    expect(r.allOk).toBe(false); // correct: the file's own "Cộng trước thuế" no longer matches Σ KL×đơn giá
    const est = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body as { categories: { name: string; items: { name: string; amount: { total: number }; amountMode?: string | null }[] }[] };
    const items = est.categories.flatMap((c) => c.items);
    const row = items.find((x) => x.name === fm.name)!;
    expect(row.amount.total).toBe(fm.calcAmount);
    expect(row.amountMode).toBe('calc');
  });
});

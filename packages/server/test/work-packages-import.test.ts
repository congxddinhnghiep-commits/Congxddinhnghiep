import fs from 'node:fs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { runImportTt38 } from '../src/scripts/import-tt38.js';
import { seedAdmin } from '../src/seed.js';

// Update 6 B — one import flow: each sheet becomes its own hạng mục công trình (work package); blocks inside a
// sheet become Phần (categories) of THAT package instead of flat project-root hạng mục (fixes problem #1 of UPDATE-6).
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

describe('Update 6 B — sheet → work package (not flat categories)', () => {
  it('a sheet with 2 blocks becomes ONE package with 2 Phần; a different sheet becomes a SEPARATE package', async () => {
    const fileId = await upload();
    const pid = await newProject('Tu Chang like – packages');
    const r = (await request(app).post(`/api/projects/${pid}/import-sheets`).set(A()).send({ fileId })).body;
    expect(r.blocks).toHaveLength(3);

    const packages = (await request(app).get(`/api/projects/${pid}/work-packages`).set(A())).body as { id: number; name: string; sourceSheet: string | null }[];
    // the project's own default package ("Hạng mục chung") + one per imported sheet with blocks
    const building = packages.find((p) => p.sourceSheet === expected.sheet_building);
    const mep = packages.find((p) => p.sourceSheet === expected.sheet_mep);
    expect(building).toBeTruthy();
    expect(mep).toBeTruthy();
    expect(building!.id).not.toBe(mep!.id);

    const buildingEst = (await request(app).get(`/api/projects/${pid}/work-packages/${building!.id}/estimate`).set(A())).body;
    expect(buildingEst.categories).toHaveLength(2); // the sheet's 2 blocks, as Phần of the same package
    const mepEst = (await request(app).get(`/api/projects/${pid}/work-packages/${mep!.id}/estimate`).set(A())).body;
    expect(mepEst.categories).toHaveLength(1);

    // items of one package never leak into the other (problem #1 of UPDATE-6)
    const buildingItems = buildingEst.categories.flatMap((c: { items: { name: string }[] }) => c.items);
    const mepItems = mepEst.categories.flatMap((c: { items: { name: string }[] }) => c.items);
    expect(buildingItems.some((i: { name: string }) => i.name.includes('Recloser'))).toBe(false);
    expect(mepItems.some((i: { name: string }) => i.name.includes('Recloser'))).toBe(true);
  });

  it('splitBlocks: a sheet with 2 blocks can become 2 separate packages instead of 1 package with 2 Phần', async () => {
    const fileId = await upload();
    const pid = await newProject('Tu Chang like – split blocks');
    const a = (await request(app).post('/api/import/analyze-multi').set(A()).send({ fileId, projectId: pid })).body;
    const buildingSheetIndex = a.sheets.find((s: { name: string }) => s.name === expected.sheet_building).index;
    const r = (await request(app)
      .post(`/api/projects/${pid}/import-sheets`)
      .set(A())
      .send({ fileId, targets: [{ sheetIndex: buildingSheetIndex, mode: 'new', splitBlocks: true }] })).body;
    expect(r.blocks).toHaveLength(3);
    const packages = (await request(app).get(`/api/projects/${pid}/work-packages`).set(A())).body as { sourceSheet: string | null }[];
    expect(packages.filter((p) => p.sourceSheet === expected.sheet_building)).toHaveLength(2);
  });

  it('target "add": a re-imported sheet can be added into an already-existing package instead of creating a new one', async () => {
    const fileId = await upload();
    const pid = await newProject('Tu Chang like – add to existing package');
    const existing = (await request(app).get(`/api/projects/${pid}/work-packages`).set(A())).body[0];
    const a = (await request(app).post('/api/import/analyze-multi').set(A()).send({ fileId, projectId: pid })).body;
    const mepSheetIndex = a.sheets.find((s: { name: string }) => s.name === expected.sheet_mep).index;
    const r = (await request(app)
      .post(`/api/projects/${pid}/import-sheets`)
      .set(A())
      .send({ fileId, sheetIndexes: [mepSheetIndex], targets: [{ sheetIndex: mepSheetIndex, mode: 'add', workPackageId: existing.id }] })).body;
    expect(r.blocks).toHaveLength(1);
    const scoped = (await request(app).get(`/api/projects/${pid}/work-packages/${existing.id}/estimate`).set(A())).body;
    expect(scoped.categories).toHaveLength(1);
    const packages = (await request(app).get(`/api/projects/${pid}/work-packages`).set(A())).body;
    expect(packages).toHaveLength(1); // no new package was created
  });

  it('re-import of the same workbook into "replace" clears the package\'s old content first (undoable)', async () => {
    const fileId = await upload();
    const pid = await newProject('Tu Chang like – replace');
    await request(app).post(`/api/projects/${pid}/import-sheets`).set(A()).send({ fileId });
    const before = (await request(app).get(`/api/projects/${pid}/work-packages`).set(A())).body as { id: number; sourceSheet: string | null }[];
    const building = before.find((p) => p.sourceSheet === expected.sheet_building)!;
    const beforeCount = before.length;

    const fileId2 = await upload();
    const a = (await request(app).post('/api/import/analyze-multi').set(A()).send({ fileId: fileId2, projectId: pid })).body;
    const buildingSheetIndex = a.sheets.find((s: { name: string }) => s.name === expected.sheet_building).index;
    const r = (await request(app)
      .post(`/api/projects/${pid}/import-sheets`)
      .set(A())
      .send({ fileId: fileId2, sheetIndexes: [buildingSheetIndex], targets: [{ sheetIndex: buildingSheetIndex, mode: 'replace', workPackageId: building.id }] })).body;
    expect(r.blocks).toHaveLength(2);
    const after = (await request(app).get(`/api/projects/${pid}/work-packages`).set(A())).body;
    expect(after).toHaveLength(beforeCount); // no extra package created by the replace
    const scoped = (await request(app).get(`/api/projects/${pid}/work-packages/${building.id}/estimate`).set(A())).body;
    expect(scoped.categories).toHaveLength(2); // old categories were replaced, not duplicated
  });
});

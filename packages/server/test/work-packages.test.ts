import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { seedAdmin } from '../src/seed.js';

// Update 6 A — "Hạng mục công trình" (work packages): one level above Phần (categories).
const db = openDb(':memory:');
seedAdmin(db, 'admin', 'admin123');
const app = createApp(db, { serveWeb: false });
let token = '';
const A = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  const t = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' })).body.token;
  token = (await request(app).post('/api/auth/change-password').set({ Authorization: `Bearer ${t}` }).send({ oldPassword: 'admin123', newPassword: 'MatKhau2026!' })).body.token;
});

async function newProject(name: string) {
  const p = (await request(app).post('/api/projects').set(A()).send({ name })).body;
  return p.id as number;
}

describe('Update 6 A — work packages', () => {
  it('a new project gets exactly one default work package holding the seed category', async () => {
    const pid = await newProject('Dự án A');
    const list = (await request(app).get(`/api/projects/${pid}/work-packages`).set(A())).body;
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Hạng mục chung');
    const est = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    expect(est.categories[0].workPackageId).toBe(list[0].id);
  });

  it('creates, renames and scopes a second work package independently from the first', async () => {
    const pid = await newProject('Dự án B');
    const wp0 = (await request(app).get(`/api/projects/${pid}/work-packages`).set(A())).body[0];
    const wp1 = (await request(app).post(`/api/projects/${pid}/work-packages`).set(A()).send({ name: 'CT02 Nhà xưởng', areaM2: 500 })).body;
    expect(wp1.mode).toBe('du_toan_tt36');

    const cat1 = (await request(app).post(`/api/projects/${pid}/categories`).set(A()).send({ name: 'Phần móng', workPackageId: wp1.id })).body;
    await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: cat1.id, name: 'Đào móng', unit: 'm3', quantity: 10 });

    const scoped0 = (await request(app).get(`/api/projects/${pid}/work-packages/${wp0.id}/estimate`).set(A())).body;
    const scoped1 = (await request(app).get(`/api/projects/${pid}/work-packages/${wp1.id}/estimate`).set(A())).body;
    expect(scoped0.categories.flatMap((c: { items: unknown[] }) => c.items)).toHaveLength(0);
    expect(scoped1.categories.flatMap((c: { items: unknown[] }) => c.items)).toHaveLength(1);
    expect(scoped1.workPackage.id).toBe(wp1.id);

    await request(app).put(`/api/projects/${pid}/work-packages/${wp1.id}`).set(A()).send({ name: 'CT02 Nhà xưởng (đổi tên)' });
    const renamed = (await request(app).get(`/api/projects/${pid}/work-packages`).set(A())).body.find((w: { id: number }) => w.id === wp1.id);
    expect(renamed.name).toBe('CT02 Nhà xưởng (đổi tên)');
  });

  it('"Chuyển sang hạng mục…" moves a Phần to another package explicitly', async () => {
    const pid = await newProject('Dự án C');
    const wp0 = (await request(app).get(`/api/projects/${pid}/work-packages`).set(A())).body[0];
    const wp1 = (await request(app).post(`/api/projects/${pid}/work-packages`).set(A()).send({ name: 'CT02' })).body;
    const est = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    const catId = est.categories[0].id;
    expect(est.categories[0].workPackageId).toBe(wp0.id);

    await request(app).post(`/api/projects/${pid}/categories/${catId}/move`).set(A()).send({ workPackageId: wp1.id });
    const after = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body;
    expect(after.categories[0].workPackageId).toBe(wp1.id);
  });

  it('deleting a work package requires confirmation when it has items, then is undoable via snapshot restore', async () => {
    const pid = await newProject('Dự án D');
    const wp1 = (await request(app).post(`/api/projects/${pid}/work-packages`).set(A()).send({ name: 'CT02' })).body;
    const cat1 = (await request(app).post(`/api/projects/${pid}/categories`).set(A()).send({ name: 'Phần móng', workPackageId: wp1.id })).body;
    await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: cat1.id, name: 'Đào móng', unit: 'm3', quantity: 10 });

    const refused = await request(app).delete(`/api/projects/${pid}/work-packages/${wp1.id}`).set(A());
    expect(refused.status).toBe(409);

    const del = await request(app).delete(`/api/projects/${pid}/work-packages/${wp1.id}?confirm=1`).set(A());
    expect(del.status).toBe(200);
    expect((await request(app).get(`/api/projects/${pid}/work-packages`).set(A())).body).toHaveLength(1);

    await request(app).post(`/api/projects/${pid}/work-packages/restore`).set(A()).send(del.body.undo);
    const restored = (await request(app).get(`/api/projects/${pid}/work-packages`).set(A())).body;
    expect(restored).toHaveLength(2);
    const restoredWp1 = restored.find((w: { id: number }) => w.id === wp1.id);
    const scoped = (await request(app).get(`/api/projects/${pid}/work-packages/${restoredWp1.id}/estimate`).set(A())).body;
    expect(scoped.categories.flatMap((c: { items: unknown[] }) => c.items)).toHaveLength(1);
  });

  it('duplicates a work package with its categories and items', async () => {
    const pid = await newProject('Dự án E');
    const wp1 = (await request(app).post(`/api/projects/${pid}/work-packages`).set(A()).send({ name: 'CT02' })).body;
    const cat1 = (await request(app).post(`/api/projects/${pid}/categories`).set(A()).send({ name: 'Phần móng', workPackageId: wp1.id })).body;
    await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: cat1.id, name: 'Đào móng', unit: 'm3', quantity: 10 });

    const copy = (await request(app).post(`/api/projects/${pid}/work-packages/${wp1.id}/duplicate`).set(A()).send({ name: 'CT02 (bản sao)' })).body;
    const scoped = (await request(app).get(`/api/projects/${pid}/work-packages/${copy.id}/estimate`).set(A())).body;
    expect(scoped.categories).toHaveLength(1);
    expect(scoped.categories[0].items).toHaveLength(1);
    expect(scoped.categories[0].items[0].name).toBe('Đào móng');
  });

  it('"Tổng hợp dự án": per-package totals + project-level % line + grand total', async () => {
    const pid = await newProject('Dự án F');
    const wp0 = (await request(app).get(`/api/projects/${pid}/work-packages`).set(A())).body[0];
    const wp1 = (await request(app).post(`/api/projects/${pid}/work-packages`).set(A()).send({ name: 'CT02', areaM2: 100 })).body;
    const cat1 = (await request(app).post(`/api/projects/${pid}/categories`).set(A()).send({ name: 'Phần móng', workPackageId: wp1.id })).body;
    await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: cat1.id, name: 'Đào móng', normCode: 'AB.1', unit: 'm3', quantity: 10 });
    await request(app).post(`/api/projects/${pid}/summary-lines`).set(A()).send({ label: 'Chi phí quản lý dự án', kind: 'rate', value: 3 });

    const summary = (await request(app).get(`/api/projects/${pid}/summary`).set(A())).body;
    expect(summary.packages).toHaveLength(2);
    expect(summary.packages.find((p: { workPackage: { id: number } }) => p.workPackage.id === wp0.id).itemCount).toBe(0);
    const pkg1 = summary.packages.find((p: { workPackage: { id: number } }) => p.workPackage.id === wp1.id);
    expect(pkg1.itemCount).toBe(1);
    expect(pkg1.unitValue).toBeCloseTo(pkg1.value / 100, 6);
    expect(summary.lines).toHaveLength(1);
    expect(summary.lines[0].amount).toBeCloseTo(summary.packagesTotal * 0.03, 6);
    expect(summary.grandTotal).toBeCloseTo(summary.packagesTotal + summary.lines[0].amount, 6);
  });

  it('copying a project preserves its work package structure', async () => {
    const pid = await newProject('Dự án G');
    const wp1 = (await request(app).post(`/api/projects/${pid}/work-packages`).set(A()).send({ name: 'CT02' })).body;
    await request(app).post(`/api/projects/${pid}/categories`).set(A()).send({ name: 'Phần móng', workPackageId: wp1.id });

    const copy = (await request(app).post(`/api/projects/${pid}/copy`).set(A())).body;
    const wps = (await request(app).get(`/api/projects/${copy.id}/work-packages`).set(A())).body;
    expect(wps.map((w: { name: string }) => w.name).sort()).toEqual(['CT02', 'Hạng mục chung'].sort());
  });
});

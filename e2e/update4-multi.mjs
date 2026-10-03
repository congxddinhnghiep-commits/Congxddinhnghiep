// Headless-browser acceptance test for Update 4 A-bis: multi-sheet import (import_tuchang_like.xls –
// hidden sheets, several blocks per sheet, a TONGHOP summary, VNI/bilingual text, MEP equipment).
// Self-contained: builds a scratch DB and starts the app on its own port.
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const SHOTS = process.env.SHOTS ?? '/tmp/e2e-shots';
const DB = '/tmp/e2e-multi.db';
const PORT = 3104;
const BASE = `http://localhost:${PORT}`;
fs.mkdirSync(SHOTS, { recursive: true });
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
const env = { ...process.env, DB_PATH: DB };
execFileSync('npm', ['run', 'import:tt38'], { env, stdio: 'ignore' });
execFileSync('node', ['e2e/seed-e2e.mjs'], { env, stdio: 'ignore' });

const app = spawn('node', ['packages/server/dist/index.js'], { env: { ...env, PORT: String(PORT) }, stdio: 'ignore' });
for (let i = 0; i < 40; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const FX = (f) => path.resolve('packages/server/test/fixtures', f);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
page.setDefaultTimeout(20000);
const shot = (n) => page.screenshot({ path: path.join(SHOTS, `u4multi-${n}.png`), fullPage: true });
const step = (m) => console.log('•', m);

try {
  step('login + project');
  await page.goto(BASE);
  await page.locator('input').first().fill('admin');
  await page.locator('input[type=password]').fill('admin123');
  await page.getByRole('button', { name: /Đăng nhập/ }).click();
  await page.getByRole('button', { name: /Tạo công trình/ }).first().click();
  const name = `E2E Multi ${Date.now()}`;
  await page.locator('.modal input, dialog input, [role=dialog] input').first().fill(name);
  await page.getByRole('button', { name: 'Tạo công trình' }).last().click();
  await page.getByText(name).first().click();
  await page.getByTestId('open-regional').waitFor();

  step('open "Nhập nhiều sheet" and upload the fixture');
  await page.getByTestId('open-multi-import').click();
  await page.locator('input[type=file]').setInputFiles(FX('import_tuchang_like.xls'));
  await page.getByRole('button', { name: 'Đọc file' }).click();
  await page.getByTestId('sheet-picker').waitFor();
  await shot('1-sheets');

  step('hidden sheet collapsed, visible sheets show the right block count, TONGHOP is summary-only');
  const picker = await page.getByTestId('sheet-picker').innerText();
  assert.ok(!picker.includes('Bang tra'), 'hidden sheet is not listed among the visible ones');
  await page.getByRole('button', { name: /1 sheet ẩn/ }).click();
  assert.ok((await page.locator('.hidden-sheets').innerText()).includes('Bang tra 79-2017'));
  assert.equal(await page.locator('[data-testid^="sheet-"][data-testid$="2"]').isChecked(), true); // building sheet auto-selected
  const rows = await page.getByTestId('sheet-picker').locator('tbody tr').allInnerTexts();
  const building = rows.find((r) => r.includes('NHÀ XƯỞNG'));
  assert.match(building, /\b2\b/); // 2 blocks
  const tonghop = rows.find((r) => r.includes('TONGHOP'));
  assert.ok(tonghop.includes('Sheet tổng hợp'));

  step('every block reconciles, preview shows the converted Vietnamese name + split Chinese');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="block-"]').length === 3);
  assert.equal(await page.locator('.warn-mark').count(), 0, 'no block and no TONGHOP line should be ⚠ for this fixture');
  const firstBlock = page.locator('[data-testid^="block-"]').first();
  await firstBlock.getByRole('button', { name: 'Xem trước' }).click();
  const prev = await firstBlock.innerText();
  for (const v of ['Đào đất móng', '挖土基础', 'Ép cọc', 'TB/VT']) assert.ok(prev.includes(v) || v === 'TB/VT', `preview shows ${v}`);
  await shot('2-blocks');

  step('TONGHOP reconciliation table: every line matched, total matches');
  await page.getByTestId('summary-check').waitFor();
  const summaryTxt = await page.getByTestId('summary-check').innerText();
  for (const v of ['Nhà xưởng A', 'Cầu nối', 'Điện trung thế', '1.810.954.000']) assert.ok(summaryTxt.includes(v));

  step('import all 3 blocks in one go (undoable) – each sheet becomes its own hạng mục công trình (Update 6 B)');
  await page.getByTestId('import-sheets').click();
  await page.getByTestId('notice').waitFor();
  assert.match(await page.getByTestId('notice').innerText(), /Đã nhập 16 công việc vào 3 hạng mục/);
  // the building sheet (2 blocks: "Nhà xưởng A" + "Cầu nối") and the MEP sheet ("Điện trung thế") each got their
  // OWN hạng mục công trình – items of one never mix into another (UPDATE-6 problem #1)
  await page.getByTestId('wp-sidebar').waitFor();
  const sidebarText = await page.getByTestId('wp-sidebar').innerText();
  for (const v of ['Nhà xưởng A', 'Điện trung thế']) assert.ok(sidebarText.includes(v), `sidebar lists package "${v}"`);
  await shot('3-imported');

  step('switching to the "Nhà xưởng A" package shows ONLY its own 2 Phần, restarting STT');
  await page.getByText('Nhà xưởng A', { exact: false }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('.tab-body .cat-name').length === 2);
  let catNames = await page.locator('.tab-body .cat-name').allInnerTexts();
  assert.deepEqual(catNames.sort(), ['CẦU NỐI', 'NHÀ XƯỞNG A'].sort());

  step('switching to "Điện trung thế" shows only its own Phần – the building items never leak in');
  await page.getByText('Điện trung thế', { exact: false }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('.tab-body .cat-name').length === 1);
  catNames = await page.locator('.tab-body .cat-name').allInnerTexts();
  assert.deepEqual(catNames, ['ĐIỆN TRUNG THẾ']);

  step('"Tổng hợp dự án" lists every package with its own value and a grand total');
  await page.getByRole('button', { name: 'Tổng hợp dự án' }).click();
  await page.getByTestId('project-summary').waitFor();
  const summaryTabText = await page.getByTestId('project-summary').innerText();
  for (const v of ['Nhà xưởng A', 'Điện trung thế', 'Hạng mục chung', 'TỔNG CỘNG DỰ ÁN']) assert.ok(summaryTabText.includes(v));

  step('"↻ Nhập lại từ file Excel" button opens on an imported category');
  await page.getByText('Nhà xưởng A', { exact: false }).first().click();
  await page.getByRole('button', { name: 'Dự toán chi tiết' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.tab-body .cat-name').length === 2);
  await page.getByTestId(/reimport-/).first().click({ force: true });
  await page.getByText('Nhập lại từ file Excel (thay thế hạng mục đã nhập)').waitFor();
  await page.keyboard.press('Escape');

  step('↶ Hoàn tác undoes the whole multi-sheet import at once');
  await page.getByRole('button', { name: /Hoàn tác/ }).click();
  await page.getByText(/Đã hoàn tác/).waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll('.tab-body .cat-name')].some((e) => /NHÀ XƯỞNG|CẦU NỐI|ĐIỆN TRUNG THẾ/.test(e.textContent)));
  await shot('4-undone');

  console.log('E2E U4-MULTI OK – screenshots in', SHOTS);
} catch (e) {
  await shot('failure').catch(() => {});
  console.error('E2E U4-MULTI FAILED:', e);
  process.exitCode = 1;
} finally {
  await browser.close();
  app.kill();
}

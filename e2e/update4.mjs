// Headless-browser acceptance test for Update 4 A (import fixes) – see e2e/README.md.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL ?? 'http://localhost:3101';
const SHOTS = process.env.SHOTS ?? '/tmp/e2e-shots';
const FX = (f) => path.resolve('packages/server/test/fixtures', f);
fs.mkdirSync(SHOTS, { recursive: true });
const PROJECT = `E2E Update 4 ${Date.now()}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(20000);
const shot = (n) => page.screenshot({ path: path.join(SHOTS, `u4-${n}.png`), fullPage: true });
const step = (m) => console.log('•', m);

async function openImport(file) {
  await page.getByRole('button', { name: /Nhập dữ liệu/ }).click();
  await page.locator('input[type=file]').setInputFiles(FX(file));
  await page.getByRole('button', { name: 'Đọc file' }).click();
  await page.getByTestId('import-review').waitFor();
}

try {
  step('login + project');
  await page.goto(BASE);
  await page.locator('input').first().fill('admin');
  await page.locator('input[type=password]').fill('admin123');
  await page.getByRole('button', { name: /Đăng nhập/ }).click();
  await page.getByRole('button', { name: /Tạo công trình/ }).first().click();
  await page.locator('.modal input, dialog input, [role=dialog] input').first().fill(PROJECT);
  await page.getByRole('button', { name: 'Tạo công trình' }).last().click();
  await page.getByText(PROJECT).first().click();
  await page.getByTestId('open-regional').waitFor();

  step('import_wide.xlsx: merged headers, hidden columns, text numbers');
  await openImport('import_wide.xlsx');
  assert.match(await page.getByTestId('map-name').locator('option:checked').innerText(), /^C – Nội dung công việc/);
  assert.equal(await page.getByTestId('map-note').inputValue(), '-1'); // hidden column is not auto-mapped
  assert.match(await page.getByTestId('map-priceVL').locator('option:checked').innerText(), /^G – Đơn giá \/ Vật liệu/);
  const options = await page.getByTestId('map-name').locator('option').allInnerTexts();
  assert.ok(options.some((o) => /\[cột ẩn\]/.test(o)), 'hidden columns are labelled');
  assert.ok(!options.some((o) => o.startsWith('D –')), 'continuation of the merged description is not listed');
  const preview = await page.getByTestId('grid-preview').innerText();
  for (const v of ['PHẦN MÓNG', 'AB.11312', 'Đào móng băng', '195.000', '2.437.500', 'AF.61120', 'tấn']) assert.ok(preview.includes(v), `grid preview shows ${v}`);
  assert.equal(await page.getByTestId('name-numeric').count(), 0);
  assert.equal(await page.getByTestId('grand-computed').innerText(), '100.690.500');
  await shot('1-wide');
  await page.getByTestId('do-import').click();
  await page.getByText(/Đã nhập 6 công việc/).waitFor();
  await page.keyboard.press('Escape');

  step('edit the imported columns ("Sửa lại cột đã nhập") from the stored rows, no upload');
  await page.getByTestId(/edit-import-/).first().click();
  await page.getByTestId('import-review').waitFor();
  assert.equal(await page.getByTestId('map-name').inputValue(), '2');
  await page.getByTestId('take-priceM').uncheck();
  await page.waitForFunction(() => document.querySelector('[data-testid="map-priceM"]').value === '-1');
  await page.waitForFunction(() => document.querySelector('[data-testid="grand-computed"]').innerText !== '100.690.500');
  const zero = await page.getByTestId('grand-computed').innerText();
  assert.notEqual(zero, '100.690.500');
  await shot('2-remap');
  await page.getByTestId('take-priceM').check();
  await page.waitForFunction(() => document.querySelector('[data-testid="grand-computed"]').innerText === '100.690.500');
  await page.getByTestId('do-import').click();
  await page.getByText(/Đã nhập 6 công việc/).waitFor();
  await page.keyboard.press('Escape');
  const names = await page.locator('.tab-body .cat-name').allInnerTexts();
  assert.deepEqual(names, ['PHẦN MÓNG', 'PHẦN THÂN']);

  step('VNI / TCVN3: units become Unicode in the preview');
  await openImport('import_vni.xlsx');
  await page.getByRole('button', { name: /^VNI/ }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="grid-preview"]')?.innerText.includes('Đào móng băng'));
  const vni = await page.getByTestId('grid-preview').innerText();
  assert.ok(vni.includes('tấn') && !vni.includes('taán'));
  await page.getByRole('button', { name: /^Hon hop/ }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="grid-preview"]')?.innerText.includes('tấn'));
  await shot('3-vni');
  await page.keyboard.press('Escape');

  console.log('E2E U4 OK – screenshots in', SHOTS);
} catch (e) {
  await shot('failure').catch(() => {});
  console.error('E2E U4 FAILED:', e);
  process.exitCode = 1;
} finally {
  await browser.close();
}

// Headless-browser smoke test for Update 6 E (price sources + work-package mode) UI.
// Self-contained: builds a scratch DB (real TT38_2026 norms + 2 verified HCM price books) and starts the app.
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const SHOTS = process.env.SHOTS ?? '.tmp/e2e-shots';
const DB = '/tmp/e2e-pricesource.db';
const PORT = 3107;
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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(20000);
page.on('dialog', (d) => d.accept());
const shot = (n) => page.screenshot({ path: path.join(SHOTS, `u6ps-${n}.png`), fullPage: true });
const step = (m) => console.log('•', m);

try {
  step('login + project');
  await page.goto(BASE);
  await page.locator('input').first().fill('admin');
  await page.locator('input[type=password]').fill('admin123');
  await page.getByRole('button', { name: /Đăng nhập/ }).click();
  await page.getByRole('button', { name: /Tạo công trình/ }).first().click();
  const name = `E2E PriceSource ${Date.now()}`;
  await page.locator('.modal input, dialog input, [role=dialog] input').first().fill(name);
  await page.getByRole('button', { name: 'Tạo công trình' }).last().click();
  await page.getByText(name).first().click();
  await page.getByTestId('open-regional').waitFor();

  step('seed a chiết tính item (normCode AF.11110) via the API, from inside the page (keeps the same auth token)');
  const token = await page.evaluate(() => localStorage.getItem('dutoan.token'));
  const pid = Number(new URL(page.url()).hash.match(/project\/(\d+)/)?.[1]);
  const est = await page.evaluate(
    async ({ pid, token }) => (await fetch(`/api/projects/${pid}/estimate`, { headers: { Authorization: `Bearer ${token}` } })).json(),
    { pid, token },
  );
  const catId = est.categories[0].id;
  await page.evaluate(
    async ({ pid, token, catId }) =>
      fetch(`/api/projects/${pid}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ categoryId: catId, normCode: 'AF.11110', quantity: 5 }) }),
    { pid, token, catId },
  );
  await page.reload();

  step('item carries a price_source badge in the grid, opens the "Nguồn giá" tab with a chiết tính breakdown');
  await page.getByTestId('price-source-badge').first().waitFor();
  await page.getByTestId('price-source-badge').first().click();
  await page.getByRole('button', { name: 'Nguồn giá' }).click();
  await page.getByText('Phiếu chiết tính đơn giá').waitFor();
  await page.waitForFunction(() => !document.querySelector('.modal-body')?.textContent?.includes('Đang tải…'));
  const chietTinhText = await page.locator('.modal-body').innerText();
  assert.match(chietTinhText, /Đơn giá \/ /);
  await shot('1-chiet-tinh');
  await page.keyboard.press('Escape');

  step('"Cài đặt hệ số" tab shows the price-source priority settings and a working preview');
  await page.getByRole('button', { name: 'Cài đặt hệ số' }).click();
  await page.getByTestId('price-source-priority').waitFor();
  await page.getByRole('button', { name: /Xem trước "Áp dụng lại/ }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Không có công việc nào cần đổi nguồn giá') || document.querySelector('[data-testid="price-source-apply-preview"]'));
  await shot('2-priority-settings');

  step('sidebar mode toggle (💰 báo giá ↔ 📐 TT36) switches the badge, with a before/after confirm');
  const pkgLi = page.getByTestId('wp-sidebar').locator('li').first();
  const before = await pkgLi.innerText();
  await pkgLi.hover();
  await pkgLi.locator('button[title*="Đang ở chế độ"]').click();
  await page.waitForFunction((prev) => document.querySelector('[data-testid="wp-sidebar"] li')?.textContent !== prev, before);
  await shot('3-mode-toggled');

  console.log('E2E U6-PRICE-SOURCE OK – screenshots in', SHOTS);
} catch (e) {
  await shot('failure').catch(() => {});
  console.error('E2E U6-PRICE-SOURCE FAILED:', e);
  process.exitCode = 1;
} finally {
  await browser.close();
  app.kill();
}

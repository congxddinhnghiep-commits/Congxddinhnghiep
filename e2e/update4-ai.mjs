// Headless-browser acceptance test for Update 4 B (AI settings screen + agent preview/apply/undo + offline fallback).
// Self-contained: starts a fake OpenAI API and the app on a scratch DB (keys only via the server's environment).
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startFakeAi } from './fake-ai-server.mjs';

const SHOTS = process.env.SHOTS ?? '/tmp/e2e-shots';
const DB = '/tmp/e2e-ai.db';
const KEY = 'sk-e2e-fake-SECRET-0123456789';
fs.mkdirSync(SHOTS, { recursive: true });
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
const env = { ...process.env, DB_PATH: DB };
execFileSync('npm', ['run', 'import:tt38'], { env, stdio: 'ignore' });
execFileSync('node', ['e2e/seed-e2e.mjs'], { env, stdio: 'ignore' });

const fake = await startFakeAi(3199);
const PORT = 3102;
const app = spawn('node', ['packages/server/dist/index.js'], {
  env: { ...env, PORT: String(PORT), OPENAI_API_KEY: KEY, OPENAI_BASE_URL: 'http://localhost:3199/v1', ANTHROPIC_API_KEY: '', AI_PROVIDER: '' },
  stdio: 'ignore',
});
const BASE = `http://localhost:${PORT}`;
for (let i = 0; i < 40; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(20000);
const shot = (n) => page.screenshot({ path: path.join(SHOTS, `u4ai-${n}.png`), fullPage: true });
const step = (m) => console.log('•', m);
const leaked = [];
page.on('pageerror', (e) => console.log('PAGEERROR', e.stack.split('\n').slice(0,6).join(' / ')));
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
page.on('response', async (r) => {
  try {
    if ((await r.text()).includes('sk-e2e-fake')) leaked.push(r.url());
  } catch {}
});

try {
  step('login');
  await page.goto(BASE);
  await page.locator('input').first().fill('admin');
  await page.locator('input[type=password]').fill('admin123');
  await page.getByRole('button', { name: /Đăng nhập/ }).click();

  step('settings screen: status per provider');
  await page.getByTestId('nav-ai').click();
  await page.getByTestId('ai-settings').waitFor();
  assert.equal(await page.getByTestId('ai-active').innerText(), 'ChatGPT (OpenAI)');
  assert.equal(await page.getByTestId('ai-status-openai').innerText(), 'Đã kết nối');
  assert.equal(await page.getByTestId('ai-status-anthropic').innerText(), 'Chưa có khóa API');
  assert.equal(await page.getByTestId('ai-test-anthropic').isDisabled(), true);
  assert.ok((await page.locator('.guide').innerText()).includes('Codespaces'));
  await shot('1-settings');

  step('"Kiểm tra kết nối" → real round trip to the (fake) provider');
  await page.getByTestId('ai-test-openai').click();
  await page.getByText(/Kết nối ChatGPT hoạt động/).waitFor();
  assert.ok(fake.seen.auth.some((a) => a === `Bearer ${KEY}`), 'the server sent the key from its environment to the provider');

  step('choose Claude (no key) → falls back to offline; then back to ChatGPT with a model name');
  await page.getByTestId('ai-provider-anthropic').check();
  await page.getByTestId('ai-save').click();
  await page.getByText(/chưa có khóa API – đang dùng chế độ ngoại tuyến/).waitFor();
  assert.equal(await page.getByTestId('ai-active').innerText(), 'Ngoại tuyến (quy tắc)');
  await page.getByTestId('ai-provider-openai').check();
  await page.getByTestId('ai-model-openai').fill('gpt-e2e');
  await page.getByTestId('ai-save').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="ai-active"]')?.textContent === 'ChatGPT (OpenAI)');

  step('assistant panel header shows the provider; agent → preview → apply → undo');
  await page.getByRole('link', { name: 'Công trình' }).first().click();
  await page.getByRole('button', { name: /Tạo công trình/ }).first().click();
  const name = `E2E AI ${Date.now()}`;
  await page.locator('.modal input, dialog input, [role=dialog] input').first().fill(name);
  await page.getByRole('button', { name: 'Tạo công trình' }).last().click();
  await page.getByText(name).first().click();
  await page.getByTestId('assistant-provider').waitFor();
  assert.equal(await page.getByTestId('assistant-provider').innerText(), 'ChatGPT (OpenAI) · gpt-e2e');
  await page.locator('.assistant-input input').fill('thêm 3 m3 bê tông lót móng vào hạng mục phần móng');
  await page.locator('.assistant-input button').click();
  await page.getByTestId('agent-preview').waitFor();
  assert.match(await page.getByTestId('agent-preview').innerText(), /Thêm vào «PHẦN MÓNG \(tạo mới\)»: AF\.11110/);
  assert.equal(await page.locator('.cat-name', { hasText: 'PHẦN MÓNG' }).count(), 0, 'nothing applied before "Áp dụng"');
  await shot('2-preview');
  await page.getByTestId('agent-apply').click();
  await page.locator('.cat-name', { hasText: 'PHẦN MÓNG' }).waitFor();
  await page.getByText('AF.11110').first().waitFor();
  await shot('3-applied');
  await page.getByRole('button', { name: /Hoàn tác/ }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.cat-name')].some((e) => e.textContent.includes('PHẦN MÓNG')));

  step('provider failure → automatic offline fallback with a Vietnamese notice');
  await fake.close();
  await page.locator('.assistant-input input').fill('tạo hạng mục phần thân');
  await page.locator('.assistant-input button').click();
  await page.getByText(/Đã chuyển sang chế độ ngoại tuyến/).waitFor();
  await shot('4-fallback');
  assert.deepEqual(leaked, [], JSON.stringify(leaked) + ' ' + 'the API key never appears in any response sent to the browser');
  console.log('E2E U4-AI OK – screenshots in', SHOTS);
} catch (e) {
  await shot('failure').catch(() => {});
  console.error('E2E U4-AI FAILED:', e);
  process.exitCode = 1;
} finally {
  await browser.close();
  app.kill();
  await fake.close().catch(() => {});
}

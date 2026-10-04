// Headless-browser acceptance test for Update 5 (element-based quantity take-off), section I.11.
// Usage: BASE_URL=http://localhost:3101 SHOTS=/tmp/shots node e2e/update5.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL ?? 'http://localhost:3101';
const SHOTS = process.env.SHOTS ?? '.tmp/e2e-shots';
fs.mkdirSync(SHOTS, { recursive: true });

const PROJECT = `E2E Update 5 ${Date.now()}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(15000);
const shot = (n) => page.screenshot({ path: path.join(SHOTS, `u5-${n}.png`), fullPage: true });
const step = (m) => console.log('•', m);

try {
  step('login (change the forced default password first)');
  await page.goto(BASE);
  await page.locator('input').first().fill('admin');
  await page.locator('input[type=password]').fill('admin123');
  await page.getByRole('button', { name: /Đăng nhập/ }).click();
  const changePwBtn = page.getByRole('button', { name: 'Lưu mật khẩu' });
  if (await changePwBtn.waitFor({ timeout: 5000 }).then(() => true).catch(() => false)) {
    await page.locator('input[type=password]').nth(0).fill('admin123');
    await page.locator('input[type=password]').nth(1).fill('MatKhau2026!');
    await page.locator('input[type=password]').nth(2).fill('MatKhau2026!');
    await changePwBtn.click();
  }

  step('create a project');
  await page.getByRole('button', { name: /Tạo công trình/ }).first().click();
  await page.locator('.modal input, dialog input, [role=dialog] input').first().fill(PROJECT);
  await page.getByRole('button', { name: 'Tạo công trình' }).last().click();
  await page.getByText(PROJECT).first().click();
  await page.getByTestId('open-regional').waitFor();

  step('open tab "Bóc khối lượng"');
  await page.getByRole('button', { name: 'Bóc khối lượng' }).click();
  await page.getByTestId('takeoff-subtab-elements').waitFor();

  step('add a story');
  await page.getByTestId('takeoff-subtab-settings').click();
  await page.getByTestId('story-name').fill('Trệt');
  await page.getByTestId('story-add-btn').click();
  await page.getByText('Trệt').waitFor();

  step('create a Móng đơn element → see the generated tasks');
  await page.getByTestId('takeoff-subtab-elements').click();
  await page.getByTestId('add-element-type').selectOption('mong_don');
  await page.getByTestId('generated-tasks').waitFor();
  await page.getByTestId('element-name').fill('M1');
  await page.getByTestId('element-count').fill('10');
  // Fix: decimal comma – "1,8" must be 1.8 (type=number used to turn it into 18); both "," and "." are accepted.
  await page.getByTestId('param-a').fill('1,8');
  await page.getByTestId('param-b').fill('1.2');
  await page.getByTestId('param-h').fill('0,5');
  await page.getByTestId('param-H_d').fill('1,5');
  await page.getByTestId('param-H_d').blur();
  await page.waitForTimeout(400); // onBlur saves are fired per-field; let the last PUT land
  assert.equal(await page.getByTestId('param-a').inputValue(), '1,8', 'typed 1,8 stays 1,8');
  assert.equal(await page.getByTestId('param-b').inputValue(), '1,2', 'typed 1.2 is shown back with a comma');
  const saved = await page.evaluate(async () => {
    const token = localStorage.getItem('dutoan.token');
    const pid = /#\/project\/(\d+)/.exec(location.hash)?.[1];
    const r = await fetch(`/api/projects/${pid}/takeoff/elements`, { headers: { Authorization: `Bearer ${token}` } });
    return r.ok ? (await r.json())[0]?.element.params : null;
  });
  assert.equal(saved?.a, 1.8, 'API stored a = 1.8 (not 18)');

  step('invalid number is flagged, never silently changed');
  await page.getByTestId('param-b').fill('1,2,5');
  await page.getByTestId('param-b').blur();
  assert.match((await page.getByTestId('param-b').getAttribute('class')) ?? '', /invalid/, '"1,2,5" is marked invalid');
  assert.equal(await page.getByTestId('param-b').inputValue(), '1,2,5', 'invalid text is kept for correction, not dropped');
  await page.getByTestId('param-b').fill('1,2');
  await page.getByTestId('param-b').blur();
  await page.waitForTimeout(400);

  step('parameter labels are Vietnamese with units');
  assert.match(await page.getByTestId('param-label-a').innerText(), /a – cạnh dài móng \(m\)/);
  assert.match(await page.getByTestId('param-label-t_l').innerText(), /t_l – chiều dày bê tông lót \(m\)/);
  assert.match(await page.getByTestId('param-label-e_tc').innerText(), /e_tc – mở rộng thi công mỗi bên \(m\)/);
  assert.match(await page.getByTestId('param-label-m').innerText(), /m – hệ số mái dốc/);
  assert.ok(((await page.getByTestId('param-label-H_d').getAttribute('title')) ?? '').length > 20, 'H_d has a tooltip');
  await shot('1-element');
  const tasksText = await page.getByTestId('generated-tasks').innerText();
  for (const t of ['Bê tông móng', 'Bê tông lót móng', 'Ván khuôn móng', 'Đào móng', 'Đắp đất'])
    assert.ok(tasksText.includes(t), `generated tasks include "${t}"`);
  assert.match(await page.getByTestId('task-bt_mong').innerText(), /10,8/, 'Bê tông móng = 10,8 m³ (1,8×1,2×0,5×10)');

  step('"Mã gợi ý" shows the top suggestion with confidence; Bê tông lót móng → AF.111xx table');
  const lotCode = await page.getByTestId('task-code-bt_lot').innerText();
  assert.doesNotMatch(lotCode, /chưa có mã/, 'Mã gợi ý is filled');
  assert.match(lotCode, /AF\.111\d\d\s+\d+%/, `Bê tông lót móng suggests an AF.111xx code with %, got "${lotCode}"`);

  step('push to the estimate');
  await page.getByTestId('push-preview-btn').click();
  await page.getByTestId('push-apply-btn').waitFor();
  await shot('2-push-preview');
  await page.getByTestId('push-apply-btn').click();
  await page.getByText(/Đã đẩy sang dự toán: thêm 5/).waitFor();
  await shot('3-pushed');

  step('the item appears in the estimate grid');
  await page.getByRole('button', { name: 'Dự toán chi tiết' }).click();
  const gridText = async () =>
    page.locator('.tab-body').evaluate((el) => el.innerText + '\n' + [...el.querySelectorAll('input')].map((i) => i.value).join('\n'));
  await page.waitForFunction(() => [...document.querySelectorAll('.tab-body input')].some((i) => i.value === 'Bê tông móng'));
  const text = await gridText();
  assert.ok(text.includes('Bê tông móng'), 'grid shows Bê tông móng');
  assert.ok(text.includes('Bê tông lót móng'), 'grid shows Bê tông lót móng');
  assert.ok(text.includes('10,8'), 'Bê tông móng quantity 10,8 m³');
  assert.ok(text.includes('2,8'), 'Bê tông lót móng quantity 2,8 m³');
  step('"Diễn giải KL" shows the generated breakdown lines');
  const breakdowns = await page.getByTestId('item-breakdown').allInnerTexts();
  assert.ok(breakdowns.some((b) => b.includes('M1 × 10: 1,8×1,2×0,5 = 10,8')), `breakdown line present, got ${JSON.stringify(breakdowns)}`);
  await shot('4-estimate-grid');

  step('undo the push removes the items again');
  await page.getByRole('button', { name: 'Bóc khối lượng' }).click();
  await page.getByTestId('takeoff-undo-push').click();
  await page.getByText(/Đã hoàn tác lần đẩy sang dự toán/).waitFor();
  await page.getByRole('button', { name: 'Dự toán chi tiết' }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.tab-body input')].some((i) => i.value === 'Bê tông móng'));
  await shot('5-undone');

  console.log('E2E OK – screenshots in', SHOTS);
} catch (e) {
  await shot('failure').catch(() => {});
  console.error('E2E FAILED:', e);
  process.exitCode = 1;
} finally {
  await browser.close();
}

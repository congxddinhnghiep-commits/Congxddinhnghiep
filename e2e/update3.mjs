// Headless-browser acceptance test for Update 3 (run against a scratch DB, see e2e/README.md).
// Usage: BASE_URL=http://localhost:3101 SHOTS=/tmp/shots node e2e/update3.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL ?? 'http://localhost:3101';
const SHOTS = process.env.SHOTS ?? '/tmp/e2e-shots';
const FIXTURE = path.resolve('packages/server/test/fixtures/test_import.xlsx');
fs.mkdirSync(SHOTS, { recursive: true });

const PROJECT = `E2E Update 3 ${Date.now()}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(15000);
const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`), fullPage: true });
const step = (m) => console.log('•', m);

try {
  step('login');
  await page.goto(BASE);
  await page.locator('input').first().fill('admin');
  await page.locator('input[type=password]').fill('admin123');
  await page.getByRole('button', { name: /Đăng nhập/ }).click();

  step('create a project');
  await page.getByRole('button', { name: /Tạo công trình/ }).first().click();
  await page.locator('.modal input, dialog input, [role=dialog] input').first().fill(PROJECT);
  await page.getByRole('button', { name: 'Tạo công trình' }).last().click();
  await page.getByText(PROJECT).first().click();
  await page.getByTestId('open-regional').waitFor();

  step('upload test_import.xlsx');
  await page.getByRole('button', { name: /Nhập dữ liệu/ }).click();
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Đọc file' }).click();
  await page.getByTestId('import-review').waitFor();
  await shot('1-analysis');

  step('auto-detected mapping: 2-row header without merged cells, G = Đơn giá / Nhân công');
  const nc = page.getByTestId('map-priceNC');
  assert.equal(await nc.inputValue(), '6');
  assert.match(await nc.locator('option:checked').innerText(), /^G – Đơn giá 单价 \/ Nhân công \(vd: 80\.000/);
  assert.match(await page.getByTestId('map-priceVL').locator('option:checked').innerText(), /^F – Đơn giá 单价 \/ Vật liệu/);
  assert.equal(await page.getByTestId('header-row').inputValue(), '3');
  assert.equal(await page.getByTestId('header-rows').inputValue(), '2');
  assert.equal(await page.getByTestId('first-row').inputValue(), '5');
  assert.equal(await page.getByTestId('last-row').inputValue(), '9');

  step('user changes the mapping manually: drop G, then pick G as "Đơn giá nhân công" again');
  await page.getByTestId('take-priceNC').uncheck();
  await page.waitForFunction(() => document.querySelector('[data-testid="map-priceNC"]').value === '-1');
  await page.getByTestId('map-priceNC').selectOption('6');
  await page.waitForFunction(() => document.querySelector('[data-testid="take-priceNC"]').checked);
  assert.equal(await page.getByTestId('map-priceNC').inputValue(), '6');
  // also make "Thành tiền" come from H by choosing it in the dropdown
  await page.getByTestId('map-amount').selectOption('7');
  await page.waitForFunction(() => document.querySelector('[data-testid="map-amount"]').value === '7');

  step('row types: 3 items, 1 category, subtotal excluded; the user can override the badge');
  const types = await page.locator('[data-testid^="type-"]').evaluateAll((els) => els.map((e) => `${e.dataset.testid}=${e.value}`));
  assert.deepEqual(types, ['type-5=category', 'type-6=item', 'type-7=item', 'type-8=item', 'type-9=subtotal']);

  step('pricing option: keep file prices (default)');
  assert.ok(await page.getByTestId('pricing-file').isChecked());

  step('fidelity check: file vs recomputed, all ✔');
  const recon = page.getByTestId('recon-table');
  for (const v of ['1.187.500', '4.384.000', '15.555.000', '21.126.500']) assert.ok((await recon.innerText()).includes(v), `reconciliation shows ${v}`);
  assert.equal(await page.getByTestId('grand-file').innerText(), '21.126.500');
  assert.equal(await page.getByTestId('grand-computed').innerText(), '21.126.500');
  assert.equal(await recon.locator('.warn-mark').count(), 0);
  assert.ok((await recon.locator('.ok-mark').count()) >= 5);

  step('code proposals: mismatch kept & flagged, AF.11111 → AF.11110, empty → AF.61110');
  assert.match(await page.getByTestId('status-6').innerText(), /không khớp/);
  assert.match(await page.locator('tr[data-row="6"]').innerText(), /Đào xúc đất.*Cấp đất – III/);
  assert.match(await page.getByTestId('status-7').innerText(), /đề xuất chuyển mã/);
  assert.match(await page.getByTestId('code-7').locator('option').nth(1).innerText(), /^AF\.11110/);
  await page.getByTestId('code-7').selectOption('AF.11110');
  await page.getByTestId('code-8').selectOption('AF.61110');
  await shot('2-mapping-and-proposals');

  step('confirm the import');
  await page.getByTestId('do-import').click();
  await page.getByText(/Đã nhập 3 công việc/).waitFor();
  await page.getByRole('button', { name: /Đóng|×|✕/ }).first().click().catch(() => {});
  await page.keyboard.press('Escape');

  step('the grid mirrors the file');
  const gridText = () => page.locator('.tab-body').evaluate((el) => el.innerText + '\n' + [...el.querySelectorAll('input')].map((i) => i.value).join('\n'));
  await page.locator('.tab-body .cat-name', { hasText: 'PHẦN MÓNG' }).waitFor();
  assert.equal(await page.locator('.tab-body .cat-name').count(), 1, 'a single category: PHẦN MÓNG');
  const rows = page.locator('.tab-body tbody tr').filter({ has: page.locator('td .qty-cell') });
  assert.equal(await rows.count(), 3);
  const text = await gridText();
  for (const v of ['Đào đất móng bằng thủ công', 'Bê tông lót móng đá 4x6 M100', 'Cốt thép móng D<=10', 'AB.11213', 'AF.11110', 'AF.61110', '1.187.500', '4.384.000', '15.555.000', '12,5', '3,2', '0,85', 'mã không khớp tên'])
    assert.ok(text.includes(v), `grid shows ${v}`);
  assert.equal((await page.getByTestId('item-note').first().innerText()).trim(), 'x');
  assert.match(await page.locator('.kpi').first().innerText(), /Chi phí xây dựng/);
  await shot('3-grid');

  step('button "Cập nhật định mức & đơn giá theo khu vực" with TP. Hồ Chí Minh');
  await page.getByTestId('open-regional').click();
  await page.getByTestId('regional-dialog').waitFor();
  await page.getByTestId('regional-region').selectOption('TP. Hồ Chí Minh');
  await page.getByTestId('regional-preview').click();
  await page.getByTestId('regional-preview-result').waitFor();
  const pv = await page.getByTestId('regional-preview-result').innerText();
  assert.match(pv, /TT38_2026/);
  assert.match(pv, /Vật liệu: .*tháng 08\/2026/);
  assert.match(pv, /Nhân công: .*tháng 08\/2026/);
  assert.match(pv, /Không có bộ giá ca máy/);
  assert.match(await page.getByTestId('regional-totals').innerText(), /Chi phí xây dựng trước thuế/);
  // file-priced items keep their price, the norm-based comparison shows the regional prices
  const res = await page.getByTestId('regional-resources').innerText();
  assert.match(res, /Vữa bê tông/);
  assert.match(res, /1\.200\.000/);
  assert.match(res, /Nhân công nhóm 2/);
  assert.match(res, /400\.000/);
  assert.match(res, /chỉ để so sánh/);
  assert.match(pv, /đang dùng đơn giá trong file/);
  await shot('4-regional-preview');
  // file-priced items keep their price: nothing changes for them; only the norm-based comparison would move
  await page.getByTestId('regional-remap').check();
  await page.getByTestId('regional-preview').click();
  await page.getByTestId('regional-remap-table').waitFor();
  await shot('5-regional-preview-remap');

  step('apply as a revision and undo it');
  await page.getByTestId('regional-apply').click();
  await page.getByTestId('regional-revisions').getByText(/Cập nhật đơn giá theo khu vực TP\. Hồ Chí Minh/).waitFor();
  await page.getByTestId('revision-undo').click();
  await page.getByTestId('regional-revisions').getByText('đã hoàn tác').waitFor();
  await shot('6-revisions');
  console.log('E2E OK – screenshots in', SHOTS);
} catch (e) {
  await shot('failure').catch(() => {});
  console.error('E2E FAILED:', e);
  process.exitCode = 1;
} finally {
  await browser.close();
}

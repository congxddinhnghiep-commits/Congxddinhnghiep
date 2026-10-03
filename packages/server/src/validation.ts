import { normalizeText, unitFactor, type ItemResult } from '@dutoan/core';
import type { LegalService } from './legal.js';
import type { PriceBookService } from './pricebooks.js';
import type { Repo } from './repo.js';

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  severity: Severity;
  message: string;
  itemId?: number;
  line?: number;
  category?: string;
  code?: string;
}

export interface Check {
  id: string;
  title: string;
  /** Rule from the construction-estimation-engine skill (§6 Kiểm tra bắt buộc / validation). */
  rule: string;
  status: 'pass' | 'warning' | 'fail';
  findings: Finding[];
}

const TOL_VND = 1;
const close = (a: number, b: number, tol = TOL_VND) => Math.abs(a - b) <= tol;
const fmt = (n: number) => Math.round(n).toLocaleString('vi-VN');

/** Validation report of an estimate – mandatory checks of the construction-estimation-engine skill. */
export function validateProject(repo: Repo, legal: LegalService, priceBooks: PriceBookService, projectId: number) {
  const calc = repo.calculate(projectId);
  const p = calc.project;
  const set = legal.get(p.legalSet);
  const dataset = set.normDataset;
  const rawItems = new Map(repo.listItems(projectId).map((i) => [i.id, i as ReturnType<Repo['listItems']>[number] & { sourceFlags?: string[] }]));
  const all: { item: ItemResult; cat: string; line: number }[] = [];
  let line = 0;
  for (const c of calc.categories) for (const it of c.items) all.push({ item: it, cat: c.name, line: ++line });
  const where = (x: { item: ItemResult; cat: string; line: number }) => ({ itemId: x.item.id, line: x.line, category: x.cat, code: x.item.normCode || undefined });

  const checks: Check[] = [];
  const add = (id: string, title: string, rule: string, findings: Finding[]) => {
    const status = findings.some((f) => f.severity === 'error') ? 'fail' : findings.some((f) => f.severity === 'warning') ? 'warning' : 'pass';
    checks.push({ id, title, rule, status, findings });
  };

  // 1. Required fields
  add(
    'REQUIRED',
    'Công tác có đủ tên, đơn vị, khối lượng',
    'Each estimate item must have work name, unit and quantity unless it is a heading/subtotal.',
    all.flatMap((x) => {
      const f: Finding[] = [];
      if (!x.item.name.trim()) f.push({ severity: 'error', message: 'Thiếu tên công tác', ...where(x) });
      if (!x.item.unit.trim()) f.push({ severity: 'error', message: 'Thiếu đơn vị', ...where(x) });
      if (!x.item.quantity) f.push({ severity: 'warning', message: 'Khối lượng bằng 0', ...where(x) });
      if (x.item.quantity < 0) f.push({ severity: 'error', message: 'Khối lượng âm', ...where(x) });
      return f;
    }),
  );

  // 2. quantity == Σ quantity lines
  add(
    'QTY_LINES',
    'Khối lượng = tổng các dòng bóc tách',
    'quantity == sum(quantity_lines)',
    all.flatMap((x) => {
      const lines = repo.quantityLines(x.item.id);
      if (!lines.length) return [];
      const f: Finding[] = [];
      const sum = lines.reduce((a, l) => a + (l.result ?? 0), 0);
      if (Math.abs(sum - x.item.quantity) > 1e-6 * Math.max(1, Math.abs(sum))) {
        f.push({ severity: 'error', message: `Khối lượng ${x.item.quantity} ≠ tổng dòng bóc tách ${Math.round(sum * 1e6) / 1e6}`, ...where(x) });
      }
      lines.forEach((l, i) => {
        if (l.sign === 1 && (l.result ?? 0) < 0) f.push({ severity: 'warning', message: `Dòng ${i + 1} âm nhưng không đánh dấu là phần trừ`, ...where(x) });
        if (l.factor !== null && l.factor !== 1) f.push({ severity: 'info', message: `Dòng ${i + 1} quy đổi ${l.unit} → ${x.item.unit} (×${l.factor})`, ...where(x) });
      });
      return f;
    }),
  );

  // 3. amount == quantity × unit price
  add(
    'AMOUNT',
    'Thành tiền = khối lượng × đơn giá',
    'amount == quantity * unit_price',
    all
      .filter((x) => !close(x.item.amount.total, x.item.quantity * x.item.unitCost.total, TOL_VND))
      .map((x) => ({ severity: 'error' as const, message: `Thành tiền ${fmt(x.item.amount.total)} ≠ ${x.item.quantity} × ${fmt(x.item.unitCost.total)}`, ...where(x) })),
  );

  // 4. item unit vs norm unit
  add(
    'UNIT',
    'Đơn vị công tác phù hợp đơn vị định mức',
    'unit of item must match the norm unit; reject implicit conversions when dimension differs',
    all.flatMap((x) => {
      if ((x.item.pricingMethod ?? 'NORM_BASED') !== 'NORM_BASED' || !x.item.normCode) return [];
      const norm = repo.getNorm(x.item.normCode, dataset);
      if (!norm) return [];
      const f = unitFactor(x.item.unit, norm.unit);
      if (f === null) return [{ severity: 'error' as const, message: `Đơn vị "${x.item.unit}" không tương thích với định mức (${norm.unit})`, ...where(x) }];
      if (f !== 1) return [{ severity: 'error' as const, message: `Đơn vị "${x.item.unit}" khác định mức (${norm.unit}) – khối lượng phải quy đổi ×${f}`, ...where(x) }];
      return [];
    }),
  );

  // 5. norm set / rule set effective at the price date
  {
    const f: Finding[] = [];
    const date = p.priceDate;
    if (!date) f.push({ severity: 'warning', message: 'Chưa nhập ngày lập giá – không kiểm tra được hiệu lực định mức / bộ quy tắc' });
    else {
      if (set.effectiveFrom && date < set.effectiveFrom) f.push({ severity: 'error', message: `Bộ ${set.label} có hiệu lực từ ${set.effectiveFrom}, sau ngày lập giá ${date}` });
      if (set.effectiveTo && date > set.effectiveTo) f.push({ severity: 'error', message: `Bộ ${set.label} (định mức ${dataset}) đã hết hiệu lực từ sau ${set.effectiveTo} – ngày lập giá ${date}` });
    }
    if (Object.values(set.tables).some((t) => t.status !== 'verified')) f.push({ severity: 'warning', message: 'Bảng tỷ lệ của bộ pháp lý chưa được xác minh' });
    add('EFFECTIVE', 'Định mức và bộ quy tắc còn hiệu lực tại ngày lập giá', 'No current calculation may silently use an expired rule set / norm version.', f);
  }

  // 6. unresolved codes
  add(
    'UNRESOLVED',
    'Không có mã chưa giải quyết được tính im lặng',
    'Normalized norm code must map to exactly one active norm version or be flagged unresolved.',
    all.flatMap((x): Finding[] => {
      if ((x.item.pricingMethod ?? 'NORM_BASED') !== 'NORM_BASED') return [];
      if (!x.item.normCode) return [{ severity: 'error' as const, message: 'Chưa có mã định mức – chi phí đang bằng 0', ...where(x) }];
      if (x.item.missingNorm) return [{ severity: 'error' as const, message: `Mã ${x.item.normCode} không có trong bộ ${dataset} – chi phí đang bằng 0`, ...where(x) }];
      if (x.item.codeStatus === 'auto') return [{ severity: 'warning' as const, message: `Mã ${x.item.normCode} gắn tự động, chưa xác nhận`, ...where(x) }];
      return [];
    }),
  );

  // 7. custom (GTT) and market-quote items
  add(
    'CUSTOM_PRICE',
    'Giá tạm tính (GTT) / báo giá có nguồn',
    'GTT or items without a norm code follow CUSTOM_GTT / MARKET_QUOTE and require a price source.',
    all.flatMap((x) => {
      const m = x.item.pricingMethod ?? 'NORM_BASED';
      if (m === 'NORM_BASED') return [];
      const f: Finding[] = [];
      if (!x.item.unitCost.total) f.push({ severity: 'error', message: 'Chưa có đơn giá', ...where(x) });
      if (m === 'CUSTOM_GTT' && !x.item.priceSource) f.push({ severity: 'error', message: 'GTT thiếu nguồn / diễn giải đơn giá', ...where(x) });
      if (m === 'MARKET_QUOTE') {
        const q = x.item.quote;
        if (!q?.supplier || !q?.date) f.push({ severity: 'error', message: 'Báo giá thiếu nhà cung cấp hoặc ngày báo giá', ...where(x) });
        if (q?.validUntil && p.priceDate && q.validUntil < p.priceDate) f.push({ severity: 'warning', message: `Báo giá hết hiệu lực ${q.validUntil}`, ...where(x) });
        if (!q?.vatStatus || q.vatStatus === 'not_stated') f.push({ severity: 'warning', message: 'Báo giá chưa ghi rõ đã gồm VAT hay chưa', ...where(x) });
      }
      return f;
    }),
  );

  // 8. resource prices with source / date / area
  add(
    'PRICE_SOURCE',
    'Giá tài nguyên có nguồn, ngày giá, địa bàn',
    'Price source, date and location are required for auditable resource prices.',
    calc.resourceSummary.flatMap((r) => {
      const s = calc.priceSources[r.code];
      if (!s) return [];
      if (s.kind === 'base') return [{ severity: 'warning' as const, message: `${r.code} ${r.name}: ${s.label} – chưa có nguồn/ngày/địa bàn`, code: r.code }];
      if (s.kind === 'manual') return [{ severity: 'warning' as const, message: `${r.code} ${r.name}: giá nhập tay – cần lưu chứng từ nguồn`, code: r.code }];
      if (/bản nháp/.test(s.label)) return [{ severity: 'warning' as const, message: `${r.code} ${r.name}: lấy từ bộ giá chưa xác minh`, code: r.code }];
      return [];
    }),
  );

  // 9. parent totals == Σ children, summary chain
  {
    const f: Finding[] = [];
    for (const c of calc.categories) {
      const sum = c.items.reduce((a, i) => a + i.amount.total, 0);
      if (!close(sum, c.total.total)) f.push({ severity: 'error', message: `Hạng mục ${c.name}: tổng ${fmt(c.total.total)} ≠ Σ công tác ${fmt(sum)}`, category: c.name });
    }
    const catSum = calc.categories.reduce((a, c) => a + c.total.total, 0);
    if (!close(catSum, calc.total.total)) f.push({ severity: 'error', message: `Tổng dự toán ${fmt(calc.total.total)} ≠ Σ hạng mục ${fmt(catSum)}` });
    const L = Object.fromEntries(calc.costSummary.lines.map((l) => [l.code, l.value]));
    const chain: [string, number, number][] = [
      ['T = VL + NC + M', L.T, (L.VL ?? 0) + (L.NC ?? 0) + (L.M ?? 0)],
      ['GT = C + TT' + (L.LT !== undefined ? ' + LT + GTk' : ''), L.GT, (L.C ?? 0) + (L.TT ?? 0) + (L.LT ?? 0) + (L.GTk ?? 0)],
      ['G = T + GT + TL', calc.costSummary.G, L.T + L.GT + L.TL],
      ['Gxd = G + GTGT', calc.costSummary.Gxd, calc.costSummary.G + calc.costSummary.GTGT],
    ];
    for (const [name, a, b] of chain) if (!close(a, b)) f.push({ severity: 'error', message: `Bảng tổng hợp: ${name} không khớp (${fmt(a)} ≠ ${fmt(b)})` });
    const tdt = calc.totalEstimate.lines.filter((l) => l.code !== 'TDT').reduce((a, l) => a + l.value, 0);
    if (!close(tdt, calc.totalEstimate.total)) f.push({ severity: 'error', message: `Tổng dự toán ≠ Σ khoản mục` });
    add('TOTALS', 'Tổng cha = tổng con', 'Parent summaries equal sum(children).', f);
  }

  // 10. component unit prices reconcile with the resource analysis
  add(
    'RECONCILE',
    'Đơn giá VL/NC/M khớp phân tích hao phí',
    'For norm-based items, resource breakdown must reconcile to item material/labor/machine unit price within tolerance.',
    all.flatMap((x) => {
      if ((x.item.pricingMethod ?? 'NORM_BASED') !== 'NORM_BASED' || x.item.missingNorm) return [];
      const s = { VL: 0, NC: 0, M: 0 };
      for (const a of x.item.analysis) s[a.type] += a.unitAmount;
      const bad = (['VL', 'NC', 'M'] as const).filter((t) => !close(s[t], x.item.unitCost[t.toLowerCase() as 'vl' | 'nc' | 'm'], 0.01));
      return bad.map((t) => ({ severity: 'error' as const, message: `Đơn giá ${t} không khớp phân tích hao phí`, ...where(x) }));
    }),
  );

  // 11. unusual / double-applied coefficients
  {
    const f: Finding[] = [];
    const cs = calc.costSummary as { Knc?: number; Km?: number };
    if ((cs.Knc ?? 1) > 1.3) f.push({ severity: 'warning', message: `Knc = ${cs.Knc?.toFixed(4)} lớn bất thường` });
    if ((cs.Km ?? 1) > 1.3) f.push({ severity: 'warning', message: `Km = ${cs.Km?.toFixed(4)} lớn bất thường` });
    if (calc.settings.autoRates === false) f.push({ severity: 'info', message: 'Tỷ lệ chi phí đang nhập tay (không tra bảng)' });
    for (const c of calc.categories) if ((c.ttRate ?? 0) > 10) f.push({ severity: 'warning', message: `Hạng mục ${c.name}: tỷ lệ TT riêng ${c.ttRate}% lớn bất thường`, category: c.name });
    for (const [code, src] of Object.entries(calc.priceSources) as [string, { transport?: number; notes?: string[] }][]) {
      if (src.transport === 0 && src.notes?.some((n) => /tránh tính 2 lần/.test(n))) f.push({ severity: 'info', message: `${code}: không cộng vận chuyển vì nguồn giá đã gồm vận chuyển (tránh tính 2 lần)`, code });
    }
    for (const x of all) {
      const q = x.item.quote;
      if (x.item.pricingMethod === 'MARKET_QUOTE' && q?.vatStatus === 'including_vat') f.push({ severity: 'info', message: 'Báo giá gồm VAT đã được quy về giá trước thuế (VAT chỉ cộng 1 lần ở bảng tổng hợp)', ...where(x) });
    }
    add('COEFFICIENTS', 'Hệ số bất thường hoặc áp hai lần', 'Warn on abnormal coefficients or coefficients applied twice.', f);
  }

  // 12. broken formulas / external links in imported data
  add(
    'SOURCE_FLAGS',
    'Ô lỗi (#NAME?, #REF!) và liên kết workbook ngoài',
    'External workbook links or #NAME? / #REF! values must be flagged.',
    all.flatMap((x) => {
      const flags = rawItems.get(x.item.id)?.sourceFlags ?? [];
      return flags.length
        ? [{ severity: 'error' as const, message: `Dòng nguồn ${x.item.source?.file ?? ''} / ${x.item.source?.sheet ?? ''} / dòng ${x.item.source?.row ?? ''} có ${flags.join(', ')} – kiểm tra lại giá trị`, ...where(x) }]
        : [];
    }),
  );

  // 13. duplicates
  {
    const seen = new Map<string, number>();
    const f: Finding[] = [];
    for (const x of all) {
      const key = `${x.cat}|${x.item.normCode}|${normalizeText(x.item.name)}|${x.item.unit}`;
      if (seen.has(key)) f.push({ severity: 'info', message: `Trùng với dòng ${seen.get(key)}`, ...where(x) });
      else seen.set(key, x.line);
    }
    add('DUPLICATES', 'Công tác trùng lặp', 'Detect duplicated items.', f);
  }

  const counts = { error: 0, warning: 0, info: 0 };
  for (const c of checks) for (const f of c.findings) counts[f.severity]++;

  // Update 6 E.2: price_source summary (count + value per kind), never mixed silently.
  const priceSourceSummary: { kind: string; count: number; value: number }[] = [];
  {
    const byKind = new Map<string, { count: number; value: number }>();
    for (const x of all) {
      const kind = calc.itemPriceSources[x.item.id]?.current ?? 'chưa xác định';
      const cur = byKind.get(kind) ?? { count: 0, value: 0 };
      cur.count++;
      cur.value += x.item.amount.total;
      byKind.set(kind, cur);
    }
    for (const [kind, v] of byKind) priceSourceSummary.push({ kind, ...v });
  }
  return { generatedAt: new Date().toISOString(), project: { id: p.id, name: p.name, legalSet: set.label, priceDate: p.priceDate }, counts, checks, priceSourceSummary };
}

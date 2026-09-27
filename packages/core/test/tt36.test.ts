import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  computeProjectCost,
  computeTotalEstimateTt36,
  computeTt36,
  defaultLegalSetFor,
  defaultTt36Settings,
  knc,
  km,
  legalSetDateWarning,
  lookupRate,
  type LegalSet,
} from '@dutoan/core';

const TT36: LegalSet = JSON.parse(fs.readFileSync(new URL('../../../data/legal/tt36-2026.json', import.meta.url), 'utf8'));
const TT11: LegalSet = JSON.parse(fs.readFileSync(new URL('../../../data/legal/tt11-2021.json', import.meta.url), 'utf8'));
const line = (r: { lines: { code: string; value: number }[] }, code: string) => r.lines.find((l) => l.code === code)!.value;

describe('TT 36/2026 – Bảng 3.8, ví dụ tính tay', () => {
  it('công trình dân dụng (không theo tuyến), không làm đêm', () => {
    /*
     * VL = 600.000.000; NC = 250.000.000; M = 150.000.000; Knc = Km = 1
     * T      = 1.000.000.000 (≤ 40 tỷ → Bảng 3.3 dân dụng 7,3%)
     * C      = 1.000.000.000 × 7,3%            = 73.000.000
     * TT     = 1.000.000.000 × 2,5% (Bảng 3.5) = 25.000.000
     * GT     = 73.000.000 + 25.000.000         = 98.000.000
     * TL     = 1.098.000.000 × 5,5% (Bảng 3.6) = 60.390.000
     * GXDTT  = 1.000.000.000 + 98.000.000 + 60.390.000 = 1.158.390.000
     * GTGT   = 1.158.390.000 × 8%              = 92.671.200
     * GXD    = 1.251.061.200
     * GXDNT  = 1.158.390.000 × 1,1% (Bảng 3.7, còn lại, ≤ 15 tỷ) × 1,08 = 12.742.290 × 1,08 = 13.761.673,2
     */
    const s = defaultTt36Settings('dan_dung');
    const r = computeTt36({ vl: 600e6, nc: 250e6, m: 150e6 }, s, TT36, 8);
    expect(r.Knc).toBe(1);
    expect(r.T).toBe(1_000_000_000);
    expect(line(r, 'C')).toBeCloseTo(73_000_000, 4);
    expect(line(r, 'TT')).toBeCloseTo(25_000_000, 4);
    expect(r.GT).toBeCloseTo(98_000_000, 4);
    expect(r.TL).toBeCloseTo(60_390_000, 4);
    expect(r.GXDTT).toBeCloseTo(1_158_390_000, 4);
    expect(r.GTGT).toBeCloseTo(92_671_200, 4);
    expect(r.GXD).toBeCloseTo(1_251_061_200, 4);
    expect(r.GXDNT).toBeCloseTo(13_761_673.2, 3);
    expect(r.total).toBeCloseTo(1_264_822_873.2, 3);
    expect(r.lines.map((l) => l.code)).toEqual(['VL', 'NC', 'M', 'T', 'C', 'TT', 'GT', 'TL', 'GXDTT', 'GTGT', 'GXD', 'GXDNT']);
    // Update 2 (A1/A1b): tables verified; Bảng 3.3 bracket base = chi phí XD trước thuế (here the estimate's own GXDTT)
    expect(r.lines.find((l) => l.code === 'C')!.source).toMatch(/Bảng 3\.3 .*Công trình dân dụng, chi phí XD trước thuế trong TMĐT ≤ 40 tỷ \[đã xác minh\]/);
    expect(r.warnings).toContain('Chưa nhập chi phí XD trong TMĐT được duyệt – đang dùng giá trị dự toán để tra khoảng.');
    expect(r.bracketBase).toEqual({ value: r.GXDTT, from: 'estimate' });
  });

  it('công trình giao thông theo tuyến, có làm đêm (Knc, Km)', () => {
    /*
     * Làm đêm 20% khối lượng, chênh lệch đơn giá đêm 30% → Knc = 1 + 0,2 × 0,3 = 1,06
     * Tỷ trọng tiền lương trong giá ca máy g = 25%        → Km  = 1 + 0,25 × 0,06 = 1,015
     * VL = 30 tỷ; NC = 8 tỷ × 1,06 = 8,48 tỷ; M = 12 tỷ × 1,015 = 12,18 tỷ
     * T      = 50,66 tỷ (40 < T ≤ 60 → Bảng 3.3 giao thông 6,0%)
     * C      = 50,66 × 6,0% = 3,0396 tỷ
     * TT     = 50,66 × 2,0% = 1,0132 tỷ
     * GT     = 4,0528 tỷ
     * TL     = (50,66 + 4,0528) × 6,0% = 54,7128 × 6% = 3,282768 tỷ
     * GXDTT  = 57,995568 tỷ
     * GTGT   = 57,995568 × 8% = 4,63964544 tỷ
     * GXD    = 62,63521344 tỷ
     * GXDNT  = 57,995568 × 2,0% (theo tuyến, 15 < GXDTT ≤ 100 tỷ) × 1,08 = 1,15991136 × 1,08 = 1,2527042688 tỷ
     */
    const s = { ...defaultTt36Settings('giao_thong'), nightShare: 20, nightPremium: 30, machineLaborShare: 25 };
    expect(s.linearWorks).toBe(true);
    expect(knc(s)).toBeCloseTo(1.06, 12);
    expect(km(s)).toBeCloseTo(1.015, 12);
    const r = computeTt36({ vl: 30e9, nc: 8e9, m: 12e9 }, s, TT36, 8);
    expect(line(r, 'NC')).toBeCloseTo(8.48e9, 2);
    expect(line(r, 'M')).toBeCloseTo(12.18e9, 2);
    expect(r.T).toBeCloseTo(50.66e9, 2);
    expect(line(r, 'C')).toBeCloseTo(3.0396e9, 2);
    expect(line(r, 'TT')).toBeCloseTo(1.0132e9, 2);
    expect(r.TL).toBeCloseTo(3.282768e9, 2);
    expect(r.GXDTT).toBeCloseTo(57.995568e9, 2);
    expect(r.GTGT).toBeCloseTo(4.63964544e9, 2);
    expect(r.GXD).toBeCloseTo(62.63521344e9, 2);
    expect(r.GXDNT).toBeCloseTo(1.2527042688e9, 2);
    expect(r.rates).toEqual({ c: 6.0, tt: 2.0, tl: 6.0, nt: 2.0 });
  });

  it('chi phí chung tính trên nhân công (Bảng 3.4) cho lắp đặt thiết bị', () => {
    // NC = 2 tỷ (≤ 15 tỷ → 65%); VL = 5 tỷ; M = 1 tỷ; T = 8 tỷ
    // C = 2 × 65% = 1,3 tỷ; TT (công nghiệp 2,0%) = 0,16 tỷ; GT = 1,46 tỷ
    // TL (lắp đặt 6,0%) = 9,46 × 6% = 0,5676 tỷ; GXDTT = 10,0276 tỷ
    const s = { ...defaultTt36Settings('cong_nghiep'), cMode: 'NC' as const, ncWorkType: 'lap_dat' };
    const r = computeTt36({ vl: 5e9, nc: 2e9, m: 1e9 }, s, TT36, 10);
    expect(line(r, 'C')).toBeCloseTo(1.3e9, 2);
    expect(r.GT).toBeCloseTo(1.46e9, 2);
    expect(r.TL).toBeCloseTo(0.5676e9, 2);
    expect(r.GXDTT).toBeCloseTo(10.0276e9, 2);
    expect(r.GTGT).toBeCloseTo(1.00276e9, 2);
  });

  it('manual rates override the tables', () => {
    const s = { ...defaultTt36Settings(), autoRates: false, cRate: 5, ttRate: 1, tlRate: 4, ntRate: 1 };
    const r = computeTt36({ vl: 100e6, nc: 0, m: 0 }, s, TT36, 10);
    // C 5tr, TT 1tr, GT 6tr, TL 106tr × 4% = 4,24tr, GXDTT 110,24tr, NT 1,1024tr × 1,1
    expect(r.GXDTT).toBeCloseTo(110.24e6, 4);
    expect(r.GXDNT).toBeCloseTo(1.21264e6, 4);
  });
});

describe('tra bảng theo khoảng', () => {
  const t33 = TT36.tables['3.3'];
  it('không nội suy (mặc định): biên khoảng tính "≤"', () => {
    expect(lookupRate(t33, 'dan_dung', 40e9).rate).toBe(7.3);
    expect(lookupRate(t33, 'dan_dung', 40e9 + 1).rate).toBe(7.1);
    expect(lookupRate(t33, 'dan_dung', 2000e9).rate).toBe(5.8);
    expect(lookupRate(t33, 'dan_dung', 50e9).interpolated).toBe(false);
  });
  it('nội suy tuyến tính khi được cấu hình', () => {
    // (40 tỷ; 7,3%) – (60 tỷ; 7,1%) → 50 tỷ = 7,2%
    const l = lookupRate(t33, 'dan_dung', 50e9, 'linear');
    expect(l.rate).toBeCloseTo(7.2, 10);
    expect(l.interpolated).toBe(true);
    expect(lookupRate(t33, 'dan_dung', 30e9, 'linear').rate).toBe(7.3);
    expect(lookupRate(t33, 'dan_dung', 1500e9, 'linear').rate).toBe(5.8);
  });
  it('báo lỗi khi dòng không tồn tại', () => {
    expect(() => lookupRate(t33, 'khong_co', 1)).toThrow();
  });
});

describe('dự phòng (TT 36/2026)', () => {
  it('trượt giá theo chỉ số giá xây dựng và thời gian thực hiện', () => {
    // V = 1.000 tr; Gdp1 = 5% = 50 tr
    // Gdp2 = 500 × (1,04 − 1) + 500 × (1,04² − 1) = 20 + 40,8 = 60,8 tr
    const s = { ...defaultTt36Settings(), contingencyQtyRate: 5, contingencyPriceMode: 'index' as const, priceIndexRate: 4, durationYears: 2 };
    const r = computeTotalEstimateTt36(1000e6, s);
    expect(r.dp1).toBeCloseTo(50e6, 4);
    expect(r.dp2).toBeCloseTo(60.8e6, 4);
    expect(r.total).toBeCloseTo(1110.8e6, 4);
  });
  it('trượt giá theo tỷ lệ cố định', () => {
    const s = { ...defaultTt36Settings(), contingencyQtyRate: 0, contingencyPriceMode: 'percent' as const, contingencyPriceRate: 3 };
    expect(computeTotalEstimateTt36(200e6, s).dp2).toBeCloseTo(6e6, 4);
  });
});

describe('bộ pháp lý', () => {
  it('chọn bộ mặc định theo thời điểm lập giá', () => {
    expect(defaultLegalSetFor('2026-07-01')).toBe('TT36_2026');
    expect(defaultLegalSetFor('2026-06-30')).toBe('TT11_2021');
    expect(defaultLegalSetFor('')).toBe('TT36_2026');
    expect(legalSetDateWarning('TT11_2021', '2026-08-01')).toMatch(/bãi bỏ/);
    expect(legalSetDateWarning('TT36_2026', '2026-08-01')).toBeNull();
  });

  it('bộ lịch sử TT11/2021 cho kết quả như Phase 1', () => {
    // Same numbers as the Phase 1 hand-checked example: T = 100 tr, dân dụng ≤ 15 tỷ → C 7,3%, LT 1,1%, TT 2,5%, TL 5,5%
    const r = computeProjectCost(TT11, { vl: 60e6, nc: 30e6, m: 10e6 }, { autoRates: true }, 'dan_dung', 8);
    const cs = r.costSummary;
    // GT = 7,3 + 1,1 + 2,5 = 10,9 tr; TL = 110,9 × 5,5% = 6,0995 tr; G = 116,9995 tr; Gxd = 126,35946 tr
    expect(cs.GT).toBeCloseTo(10.9e6, 4);
    expect(cs.G).toBeCloseTo(116.9995e6, 4);
    expect(cs.Gxd).toBeCloseTo(126.35946e6, 4);
    expect(cs.nhaTam).toBe(0);
    expect(r.warnings[0]).toMatch(/lịch sử/);
  });
});

describe('Update 2 – cơ sở tra khoảng, dòng cha, ghi đè TT, dự phòng 2.8/2.9', () => {
  it('Bảng 3.3 / 3.7 tra theo chi phí XD trước thuế trong TMĐT (tỷ đồng), tỷ lệ áp vào T / GXDTT', () => {
    /*
     * Như ví dụ dân dụng (T = 1 tỷ) nhưng TMĐT duyệt GXDTT = 50 tỷ → Bảng 3.3 khoảng ≤ 60 tỷ: 7,1%; Bảng 3.7 ≤ 100 tỷ: 1,0%
     * C = 1 tỷ × 7,1% = 71.000.000; TT = 25.000.000; GT = 96.000.000
     * TL = 1.096.000.000 × 5,5% = 60.280.000; GXDTT = 1.156.280.000
     * GXDNT = 1.156.280.000 × 1,0% × 1,08 = 12.487.824
     */
    const s = { ...defaultTt36Settings('dan_dung'), gxdttTmdt: 50 };
    const r = computeTt36({ vl: 600e6, nc: 250e6, m: 150e6 }, s, TT36, 8);
    expect(r.rates.c).toBe(7.1);
    expect(r.rates.nt).toBe(1.0);
    expect(r.GXDTT).toBeCloseTo(1_156_280_000, 3);
    expect(r.GXDNT).toBeCloseTo(12_487_824, 3);
    expect(r.bracketBase).toEqual({ value: 50e9, from: 'tmdt' });
    expect(r.warnings.join(' ')).not.toMatch(/Chưa nhập chi phí XD trong TMĐT/);
  });

  it('không có TMĐT: lặp theo GXDTT của dự toán cho tới khi khoảng ổn định', () => {
    /*
     * VL = 39 tỷ → T = 39 tỷ. Lần 1 (khoảng theo T ≤ 40): C 7,3% → GXDTT = 45,17721 tỷ > 40 tỷ
     * Lần 2 (khoảng ≤ 60): C = 39 × 7,1% = 2,769; TT = 0,975; GT = 3,744; TL = 42,744 × 5,5% = 2,35092
     * GXDTT = 45,09492 tỷ → vẫn ≤ 60 → ổn định. Nhà tạm (còn lại, ≤ 100 tỷ) 1,0%.
     */
    const r = computeTt36({ vl: 39e9, nc: 0, m: 0 }, defaultTt36Settings('dan_dung'), TT36, 8);
    expect(r.rates.c).toBe(7.1);
    expect(r.GXDTT).toBeCloseTo(45.09492e9, 1);
    expect(r.rates.nt).toBe(1.0);
    expect(r.bracketBase.from).toBe('estimate');
  });

  it('Bảng 3.4 tra theo chi phí nhân công, không phụ thuộc TMĐT', () => {
    const s = { ...defaultTt36Settings('cong_nghiep'), cMode: 'NC' as const, ncWorkType: 'lap_dat', gxdttTmdt: 900 };
    const r = computeTt36({ vl: 5e9, nc: 20e9, m: 1e9 }, s, TT36, 8);
    expect(r.rates.c).toBe(62); // NC = 20 tỷ → khoảng ≤ 50 tỷ
  });

  it('tỷ lệ TT riêng cho hạng mục (công tác XD trong đường hầm)', () => {
    // Hạng mục A: T = 600 tr (2,5%); hạng mục B trong hầm: T = 400 tr (6,5%) → TT = 15 + 26 = 41 tr
    const cats = [
      { id: 1, name: 'Cửa hầm', direct: { vl: 600e6, nc: 0, m: 0 } },
      { id: 2, name: 'Thân hầm', direct: { vl: 400e6, nc: 0, m: 0 }, ttRate: 6.5 },
    ];
    const r = computeTt36({ vl: 1000e6, nc: 0, m: 0 }, { ...defaultTt36Settings('dan_dung'), gxdttTmdt: 10 }, TT36, 8, { categories: cats });
    const tt = r.lines.find((l) => l.code === 'TT')!;
    expect(tt.value).toBeCloseTo(41e6, 4);
    expect(tt.formula).toMatch(/"Thân hầm" 6,5%/);
    expect(tt.expr).toMatch(/^\{T\}\*\{rate\}\/100\+/);
  });

  it('dòng cha cho tu bổ di tích (Bảng 3.5, 3.6) là ghi chú, không phải cảnh báo', () => {
    const r = computeTt36({ vl: 1e9, nc: 0, m: 0 }, { ...defaultTt36Settings(), workCategory: 'tu_bo_di_tich', gxdttTmdt: 10 }, TT36, 8);
    expect(r.rates.c).toBe(11.6);
    expect(r.rates.tt).toBe(2.5);
    expect(r.rates.tl).toBe(5.5);
    expect(r.notes).toHaveLength(2);
    expect(r.warnings.join(' ')).not.toMatch(/dòng/);
  });

  it('nội suy chỉ khi bật, kèm cảnh báo không có căn cứ', () => {
    const set: LegalSet = structuredClone(TT36);
    set.tables['3.3'].interpolation = 'linear';
    const r = computeTt36({ vl: 1e9, nc: 0, m: 0 }, { ...defaultTt36Settings(), gxdttTmdt: 50 }, set, 8);
    expect(r.rates.c).toBeCloseTo(7.2, 10);
    expect(r.warnings.join(' ')).toMatch(/không có căn cứ trong TT 36/);
  });

  it('GDP2 theo công thức 2.9 – ví dụ trong UPDATE-2 (10 tỷ, 2 năm 60/40, I_bq = 1,03, ΔI = 0,005)', () => {
    // GDP2 = 6 × (1,035 − 1) + 4 × (1,035² − 1) = 0,21 + 0,2849 = 0,4949 tỷ; GDP1 = 10 × 5% = 0,5 tỷ
    const s = {
      ...defaultTt36Settings(),
      contingencyQtyRate: 5,
      contingencyPriceMode: 'formula' as const,
      contingencyPeriods: 2,
      contingencySchedule: [60, 40],
      priceIndexAvg: 1.03,
      priceIndexDelta: 0.005,
    };
    const r = computeTotalEstimateTt36(10e9, s);
    expect(r.dp1).toBeCloseTo(0.5e9, 2);
    expect(r.dp2).toBeCloseTo(0.4949e9, 2);
    expect(r.total).toBeCloseTo(10.9949e9, 2);
    const l = r.lines.find((x) => x.code === 'Gdp2')!;
    expect(l.source).toMatch(/công thức 2\.9/);
    expect(r.lines.find((x) => x.code === 'Gdp1')!.source).toMatch(/công thức 2\.8/);
  });

  it('phân bổ không hợp lệ → chia đều; kps > 5% bị cảnh báo', () => {
    const s = { ...defaultTt36Settings(), contingencyQtyRate: 6, contingencyPeriods: 4, contingencyPeriodUnit: 'quy' as const, contingencySchedule: [50, 50], priceIndexAvg: 1.01, priceIndexDelta: 0 };
    const r = computeTotalEstimateTt36(4e9, s);
    // 1 tỷ mỗi quý: Σ (1,01^t − 1) = 0,01 + 0,0201 + 0,030301 + 0,04060401 = 0,10100501 tỷ
    expect(r.dp2).toBeCloseTo(0.10100501e9, 1);
    expect(r.warnings.join(' ')).toMatch(/vượt mức tối đa 5%/);
  });
});

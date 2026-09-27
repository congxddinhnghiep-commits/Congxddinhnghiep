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
    expect(r.lines.find((l) => l.code === 'C')!.source).toMatch(/Bảng 3\.3 .*Công trình dân dụng, T ≤ 40 tỷ \[TẠM/);
    expect(r.warnings[0]).toMatch(/TẠM \(provisional\)/);
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
    const s = { ...defaultTt36Settings(), contingencyQtyRate: 0, contingencyPriceRate: 3 };
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

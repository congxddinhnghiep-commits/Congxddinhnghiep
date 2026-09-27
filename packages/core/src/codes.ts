/**
 * Norm code canonicalisation and pricing-method detection.
 * Canonical form of the national norm books (TT 12/2021, TT 38/2026): two letters, a dot, five digits
 * (+ optional suffix): AF11121 ↔ AF.11121. Raw codes are always kept alongside.
 */
export type PricingMethod = 'NORM_BASED' | 'CUSTOM_GTT' | 'MARKET_QUOTE';

export const PRICING_METHOD_LABELS: Record<PricingMethod, string> = {
  NORM_BASED: 'Theo định mức',
  CUSTOM_GTT: 'Giá tạm tính / tự lập (GTT)',
  MARKET_QUOTE: 'Báo giá thị trường',
};

const CUSTOM_CODES = /^(GTT|TT|TAM TINH|TẠM TÍNH|TAMTINH|TT\.?GTT|BG|BAO GIA)$/i;

export interface CanonicalCode {
  raw: string;
  normalized: string;
  kind: 'norm' | 'custom' | 'empty' | 'other';
  pricingMethod: PricingMethod | null;
}

/** Canonicalise a raw code. Only codes matching the norm-book pattern are rewritten. */
export function canonicalNormCode(raw: string | null | undefined): CanonicalCode {
  const r = (raw ?? '').toString();
  const t = r.trim().replace(/\s+/g, '').toUpperCase();
  if (!t) return { raw: r, normalized: '', kind: 'empty', pricingMethod: null };
  if (CUSTOM_CODES.test(t) || /^GTT[.\-_]?\d*$/.test(t)) return { raw: r, normalized: 'GTT', kind: 'custom', pricingMethod: 'CUSTOM_GTT' };
  const m = /^([A-Z]{2})\.?(\d{5})([A-Z]?\d{0,2})$/.exec(t.replace(/[,;:]+$/, ''));
  if (m) return { raw: r, normalized: `${m[1]}.${m[2]}${m[3]}`, kind: 'norm', pricingMethod: 'NORM_BASED' };
  return { raw: r, normalized: t, kind: 'other', pricingMethod: null };
}

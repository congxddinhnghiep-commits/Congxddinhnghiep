import { formatNumber } from '@dutoan/core';

export const money = (n: number | null | undefined) => (n === null || n === undefined ? '' : formatNumber(n, 0));
export const qty = (n: number | null | undefined) => (n === null || n === undefined ? '' : formatNumber(n, 3));
export const rate = (n: number | null | undefined) => (n === null || n === undefined ? '' : formatNumber(n, 2));

/** Parse user-typed Vietnamese number ("1.650.000", "2,5"). */
export function parseInputNumber(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  const n = Number(t.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];

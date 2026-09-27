/** Remove Vietnamese diacritics (đ → d) while keeping string length for NFC input. */
export function removeDiacritics(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/** Lower-case, diacritic-free, whitespace-collapsed form used for searching. */
export function normalizeText(s: string): string {
  return removeDiacritics(s.normalize('NFC')).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Normalise character by character so that index i in the result corresponds to index i
 * in the (NFC) input. Lets the parser match on plain text but cut spans from the original.
 */
export function normalizeKeepIndex(s: string): { original: string; norm: string } {
  const original = s.normalize('NFC');
  let norm = '';
  for (const ch of original) {
    let n = removeDiacritics(ch).toLowerCase();
    if (n.length !== ch.length) n = n.slice(0, ch.length).padEnd(ch.length, ' ');
    norm += n;
  }
  return { original, norm };
}

/** Split into search tokens (letters/digits, keeps dotted codes like AF.11111). */
export function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(/[^a-z0-9.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
}

/** Format a number the Vietnamese way: 1.650.000 or 1.650,5 */
export function formatNumber(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return '';
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = n < 0 && Number(fixed) !== 0 ? '-' : '';
  return sign + grouped + (frac && Number(frac) !== 0 ? ',' + frac.replace(/0+$/, '') : '');
}

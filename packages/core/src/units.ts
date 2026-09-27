import { normalizeUnit } from './numbers.js';

/** Canonical spelling of common Vietnamese units (lower-case, no diacritics). */
const ALIASES: Record<string, string> = {
  md: 'm',
  'm.dai': 'm',
  mdai: 'm',
  'met': 'm',
  m1: 'm',
  'mét': 'm',
  tan: 'tan',
  t: 'tan',
  kg: 'kg',
  cai: 'cai',
  chiec: 'cai',
  bo: 'bo',
  vien: 'vien',
  cay: 'cay',
  cong: 'cong',
  ca: 'ca',
  lit: 'lit',
  ha: 'ha',
  km: 'km',
  'moinoi': 'moinoi',
  'moi noi': 'moinoi',
  coc: 'coc',
  tam: 'tam',
};

/** Units recognised when importing (warn on anything else). */
export const KNOWN_UNITS = new Set([
  'm', 'm2', 'm3', 'km', 'ha', 'tan', 'kg', 'cai', 'bo', 'vien', 'cay', 'cong', 'ca', 'lit', 'moinoi', 'coc', 'tam', 'hop', 'cuon',
  'tb', 'thung', 'bao', 'lo', 'ht', 'goi', 'diem', 'vi tri', 'lan', 'thang', 'nam', 'ngay', 'kw', 'kwh', 'khoan', 'mau', 'bo',
]);

/**
 * A measurement-basis qualifier trailing a base unit doesn't change its dimension (e.g. TT 38/2026
 * "m3 đất nguyên thổ" = natural-ground m3, "m3 đá nguyên khai" = in-situ rock m3) so it's dropped for
 * unit compatibility / conversion – but only when it's plain descriptive text right to the end of the
 * string; a compound rate like ".../1km" or "công/đơn vị vật liệu" is a genuinely different unit and
 * is left untouched (the qualifier regex requires letters only, anchored at the end).
 */
const QUALIFIER_SUFFIX = /^(m2|m3|m|tan|kg)(dat|da|bun)[a-z]*$/;

/** Canonical unit, e.g. "m³" → "m3", "Tấn" → "tan", "100 m3" → "100m3", "md" → "m", "100m3 đất nguyên thổ" → "100m3". */
export function canonicalUnit(u: string | null | undefined): string {
  if (!u) return '';
  let s = normalizeUnit(String(u)).replace(/[()]/g, '').replace(/\.$/, '');
  const m = /^(\d+)(.*)$/.exec(s);
  const prefix = m ? m[1] : '';
  let base = m ? m[2] : s;
  const q = QUALIFIER_SUFFIX.exec(base);
  if (q) base = q[1];
  s = ALIASES[base] ?? base;
  return prefix + s;
}

export function isKnownUnit(u: string): boolean {
  const c = canonicalUnit(u).replace(/^\d+/, '');
  return KNOWN_UNITS.has(c);
}

/**
 * Factor to convert a quantity measured in `from` into the unit `to`, or null if incompatible.
 * "m3" → "100m3" = 0.01; "kg" → "tan" = 0.001; "tan" → "kg" = 1000.
 */
export function unitFactor(from: string, to: string): number | null {
  const f = canonicalUnit(from);
  const t = canonicalUnit(to);
  if (!f || !t) return null;
  if (f === t) return 1;
  const split = (u: string): [number, string] => {
    const m = /^(\d+)(.+)$/.exec(u);
    return m ? [Number(m[1]), m[2]] : [1, u];
  };
  const [fn, fb] = split(f);
  const [tn, tb] = split(t);
  let base: number | null = null;
  if (fb === tb) base = 1;
  else if (fb === 'kg' && tb === 'tan') base = 0.001;
  else if (fb === 'tan' && tb === 'kg') base = 1000;
  else if (fb === 'm' && tb === 'km') base = 0.001;
  else if (fb === 'km' && tb === 'm') base = 1000;
  else {
    // Length-based units: mm, cm, dm, m (and their squares / cubes)
    const len: Record<string, number> = { mm: 0.001, cm: 0.01, dm: 0.1, m: 1 };
    const dim = (u: string): [number, number] | null => {
      const m = /^(mm|cm|dm|m)([23]?)$/.exec(u);
      return m ? [len[m[1]], m[2] ? Number(m[2]) : 1] : null;
    };
    const a = dim(fb);
    const b = dim(tb);
    if (a && b && a[1] === b[1]) base = Math.pow(a[0] / b[0], a[1]);
  }
  if (base === null) return null;
  return (base * fn) / tn;
}

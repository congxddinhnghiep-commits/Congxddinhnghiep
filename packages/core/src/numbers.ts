/**
 * Parse Vietnamese-formatted numbers: "1.650.000" → 1650000, "1,5" → 1.5, "2.5" → 2.5,
 * "1,65 triệu" → 1650000 (multiplier words handled by parseAmount).
 */
export function parseVnNumber(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, '');
  if (!/^-?\d[\d.,]*$/.test(s)) return null;
  let t: string;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) t = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) t = s.replace(/,/g, '');
  else if (/^-?\d+,\d+$/.test(s)) t = s.replace(',', '.');
  else if (/^-?\d+(\.\d+)?$/.test(s)) t = s;
  else return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const MULTIPLIERS: Record<string, number> = {
  ty: 1e9,
  trieu: 1e6,
  tr: 1e6,
  nghin: 1e3,
  ngan: 1e3,
  k: 1e3,
};

/**
 * Parse an amount with optional multiplier word and currency/unit, on normalised
 * (diacritic-free, lower-case) text: "1.650.000 d/tan", "1,65 trieu dong / tan", "18k/kg".
 */
export function parseAmount(norm: string): { value: number; perUnit?: string } | null {
  const m = /(-?\d[\d.,]*)\s*(ty|trieu|tr|nghin|ngan|k)?\b\s*(?:dong|vnd|d)?\s*(?:\/\s*([a-z0-9]+))?/.exec(norm);
  if (!m) return null;
  const n = parseVnNumber(m[1]);
  if (n === null) return null;
  const mult = m[2] ? MULTIPLIERS[m[2]] : 1;
  return { value: n * mult, perUnit: m[3] };
}

/** Unit conversion factors: price per `from` × factor = price per `to`. */
const UNIT_FACTORS: Record<string, Record<string, number>> = {
  tan: { kg: 1 / 1000 },
  kg: { tan: 1000 },
  m3: { lit: 1 / 1000 },
  lit: { m3: 1000 },
};

/** Normalise unit spellings (tấn → tan, m³ → m3). */
export function normalizeUnit(u: string): string {
  return u
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .replace('³', '3')
    .replace('²', '2')
    .replace(/\s+/g, '');
}

/** Convert a price given per `fromUnit` into price per `toUnit`; null if incompatible. */
export function convertPrice(price: number, fromUnit: string, toUnit: string): number | null {
  const f = normalizeUnit(fromUnit);
  const t = normalizeUnit(toUnit);
  if (f === t) return price;
  const factor = UNIT_FACTORS[f]?.[t];
  return factor === undefined ? null : price * factor;
}

/**
 * Parse a number TYPED by the user in a take-off input (dimensions, counts, Ø, …). Both the Vietnamese decimal comma
 * and the dot are accepted: "1,8" = "1.8" = 1.8, ",5" = 0.5. A single separator is ALWAYS a decimal separator here
 * (dimensions in m – "1,800" means 1.8, never 1800); thousands grouping is only recognised when it is unambiguous
 * ("1.650.000", "1.234,5", "1,234.5"). Anything else ("1,8,2", "1.8.", "abc", "") → null, so the UI can flag the
 * input as invalid instead of silently dropping the comma (type="number" turned "1,8" into 18).
 */
export function parseDecimalInput(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/[\s ]/g, '');
  if (!s) return null;
  let t: string | null = null;
  if (/^[-+]?(\d+([.,]\d*)?|[.,]\d+)$/.test(s)) t = s.replace(',', '.');
  else if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) t = s.replace(/\./g, '').replace(',', '.');
  else if (/^[-+]?\d{1,3}(,\d{3})+\.\d+$/.test(s)) t = s.replace(/,/g, '');
  if (t === null) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Show a take-off number the Vietnamese way for editing: 1.8 → "1,8" (no grouping, up to 6 decimals, no float noise). */
export function formatDecimalInput(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const r = Math.round(n * 1e6) / 1e6;
  return String(r).replace('.', ',');
}

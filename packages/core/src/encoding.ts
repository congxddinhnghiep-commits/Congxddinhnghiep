/**
 * Detection and conversion of legacy Vietnamese 8-bit encodings (VNI-Windows, TCVN3/ABC) that appear
 * as Windows-1252 text in old estimate files, e.g. "Ñaøo ñaát" (VNI) or "Bª t«ng" (TCVN3) → Unicode.
 * The raw text must always be kept by the caller.
 */
export type TextEncoding = 'unicode' | 'vni' | 'tcvn3' | 'plain';

// ---------------- VNI ----------------
const TONES_LOWER: Record<string, number> = { 'ù': 1, 'ø': 2, 'û': 3, 'õ': 4, 'ï': 5 };
const TONES_UPPER: Record<string, number> = { 'Ù': 1, 'Ø': 2, 'Û': 3, 'Õ': 4, 'Ï': 5 };
// circumflex (â ê ô) + tone
const CIRC: Record<string, number> = { 'â': 0, 'á': 1, 'à': 2, 'å': 3, 'ã': 4, 'ä': 5, 'Â': 0, 'Á': 1, 'À': 2, 'Å': 3, 'Ã': 4, 'Ä': 5 };
// breve (ă) + tone
const BREVE: Record<string, number> = { 'ê': 0, 'é': 1, 'è': 2, 'ú': 3, 'ü': 4, 'ë': 5, 'Ê': 0, 'É': 1, 'È': 2, 'Ú': 3, 'Ü': 4, 'Ë': 5 };

const TABLE: Record<string, string[]> = {
  a: ['a', 'á', 'à', 'ả', 'ã', 'ạ'],
  â: ['â', 'ấ', 'ầ', 'ẩ', 'ẫ', 'ậ'],
  ă: ['ă', 'ắ', 'ằ', 'ẳ', 'ẵ', 'ặ'],
  e: ['e', 'é', 'è', 'ẻ', 'ẽ', 'ẹ'],
  ê: ['ê', 'ế', 'ề', 'ể', 'ễ', 'ệ'],
  i: ['i', 'í', 'ì', 'ỉ', 'ĩ', 'ị'],
  o: ['o', 'ó', 'ò', 'ỏ', 'õ', 'ọ'],
  ô: ['ô', 'ố', 'ồ', 'ổ', 'ỗ', 'ộ'],
  ơ: ['ơ', 'ớ', 'ờ', 'ở', 'ỡ', 'ợ'],
  u: ['u', 'ú', 'ù', 'ủ', 'ũ', 'ụ'],
  ư: ['ư', 'ứ', 'ừ', 'ử', 'ữ', 'ự'],
  y: ['y', 'ý', 'ỳ', 'ỷ', 'ỹ', 'ỵ'],
};

const withCase = (s: string, upper: boolean) => (upper ? s.toUpperCase() : s);

/** VNI-Windows (read as cp1252) → Unicode NFC. */
export function vniToUnicode(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const n = s[i + 1] ?? '';
    const lower = c.toLowerCase();
    const upper = c !== lower;
    // standalone letters
    if (c === 'Ñ') { out += 'Đ'; continue; }
    if (c === 'ñ') { out += 'đ'; continue; }
    if (c === 'ô' || c === 'Ô' || c === 'ö' || c === 'Ö') {
      const base = c === 'ô' || c === 'Ô' ? 'ơ' : 'ư';
      const bu = c === 'Ô' || c === 'Ö';
      const tone = TONES_LOWER[n] ?? TONES_UPPER[n];
      if (tone !== undefined) { out += withCase(TABLE[base][tone], bu); i++; } else out += withCase(base, bu);
      continue;
    }
    // i with tones are single characters in VNI
    const iMap: Record<string, string> = { 'í': 'í', 'ì': 'ì', 'æ': 'ỉ', 'ó': 'ĩ', 'ò': 'ị', 'Í': 'Í', 'Ì': 'Ì', 'Æ': 'Ỉ', 'Ó': 'Ĩ', 'Ò': 'Ị', 'î': 'ỵ', 'Î': 'Ỵ' };
    if (iMap[c]) { out += iMap[c]; continue; }
    if ('aeouy'.includes(lower)) {
      if ((lower === 'a' || lower === 'e' || lower === 'o') && CIRC[n] !== undefined) {
        const base = lower === 'a' ? 'â' : lower === 'e' ? 'ê' : 'ô';
        out += withCase(TABLE[base][CIRC[n]], upper);
        i++;
        continue;
      }
      if (lower === 'a' && BREVE[n] !== undefined) {
        out += withCase(TABLE['ă'][BREVE[n]], upper);
        i++;
        continue;
      }
      const tone = TONES_LOWER[n] ?? TONES_UPPER[n];
      if (tone !== undefined) {
        out += withCase(TABLE[lower][tone], upper);
        i++;
        continue;
      }
    }
    out += c;
  }
  return out.normalize('NFC');
}

// ---------------- TCVN3 (ABC) ----------------
const TCVN3: Record<string, string> = {
  '¸': 'á', 'µ': 'à', '¶': 'ả', '·': 'ã', '¹': 'ạ',
  '¨': 'ă', '¾': 'ắ', '»': 'ằ', '¼': 'ẳ', '½': 'ẵ', 'Æ': 'ặ',
  '©': 'â', 'Ê': 'ấ', 'Ç': 'ầ', 'È': 'ẩ', 'É': 'ẫ', 'Ë': 'ậ',
  '®': 'đ',
  'Ð': 'é', 'Ì': 'è', 'Î': 'ẻ', 'Ï': 'ẽ', 'Ñ': 'ẹ',
  'ª': 'ê', 'Õ': 'ế', 'Ò': 'ề', 'Ó': 'ể', 'Ô': 'ễ', 'Ö': 'ệ',
  'Ý': 'í', '×': 'ì', 'Ø': 'ỉ', 'Ü': 'ĩ', 'Þ': 'ị',
  'ã': 'ó', 'ß': 'ò', 'á': 'ỏ', 'â': 'õ', 'ä': 'ọ',
  '«': 'ô', 'è': 'ố', 'å': 'ồ', 'æ': 'ổ', 'ç': 'ỗ', 'é': 'ộ',
  '¬': 'ơ', 'í': 'ớ', 'ê': 'ờ', 'ë': 'ở', 'ì': 'ỡ', 'î': 'ợ',
  'ó': 'ú', 'ï': 'ù', 'ñ': 'ủ', 'ò': 'ũ', 'ô': 'ụ',
  '­': 'ư', 'ø': 'ứ', 'õ': 'ừ', 'ö': 'ử', '÷': 'ữ', 'ù': 'ự',
  'ý': 'ý', 'ú': 'ỳ', 'û': 'ỷ', 'ü': 'ỹ', 'þ': 'ỵ',
  '¡': 'Ă', '¢': 'Â', '§': 'Đ', '£': 'Ê', '¤': 'Ô', '¥': 'Ơ', '¦': 'Ư',
};

export function tcvn3ToUnicode(s: string): string {
  let out = '';
  for (const c of s) out += TCVN3[c] ?? c;
  return out.normalize('NFC');
}

const UNICODE_VI = /[ăĂđĐơƠưƯẠ-ỹ]/;
const VNI_SEQ = /[aeouyAEOUYôöÔÖ][ùøûõïÙØÛÕÏ]|[aeoAEO][âáàåãäÂÁÀÅÃÄ]|[aA][êéèúüëÊÉÈÚÜË]|[Ññ][aeiouyAEIOUYöôÖÔ]/g;
const TCVN_ONLY = /[¡¢£¤¥¦§¨©ª«¬­®µ¶·¸¹»¾]/g;

/** Guess the encoding of one text value. */
export function detectEncoding(s: string): TextEncoding {
  if (!s || !/[^\x00-\x7F]/.test(s)) return 'plain';
  if (UNICODE_VI.test(s)) return 'unicode';
  // TCVN3 lower-case toned letters sit at 0xC0–0xDE: a capital Latin-1 letter inside a lower-case word ("tÊn") is a TCVN3 tell.
  if (/[a-z][ÇÈÉÊËÌÎÏÐÑÒÓÔÕÖØÜÝÞ×]/.test(s) && !VNI_SEQ.test(s)) return 'tcvn3';
  VNI_SEQ.lastIndex = 0;
  const vni = (s.match(VNI_SEQ) ?? []).length;
  const tcvn = (s.match(TCVN_ONLY) ?? []).length;
  if (vni >= 1 && vni >= tcvn) return 'vni';
  if (tcvn >= 1) return 'tcvn3';
  return 'unicode';
}

/** Convert a legacy-encoded value to Unicode; returns the input unchanged for Unicode/plain text. */
export function toUnicode(s: string, enc: TextEncoding = detectEncoding(s)): string {
  if (enc === 'vni') return vniToUnicode(s);
  if (enc === 'tcvn3') return tcvn3ToUnicode(s);
  return s;
}

/**
 * Detect the dominant legacy encoding of a set of texts (a whole sheet): many short cells like
 * "M3" carry no signal, so decide once per sheet and convert all its non-ASCII cells consistently.
 */
export function detectDominantEncoding(texts: string[]): { encoding: TextEncoding; votes: Record<TextEncoding, number> } {
  const votes: Record<TextEncoding, number> = { unicode: 0, vni: 0, tcvn3: 0, plain: 0 };
  for (const t of texts) votes[detectEncoding(t)]++;
  const legacy = votes.vni + votes.tcvn3;
  const encoding: TextEncoding = legacy > votes.unicode ? (votes.vni >= votes.tcvn3 ? 'vni' : 'tcvn3') : votes.unicode ? 'unicode' : 'plain';
  return { encoding, votes };
}

// ---------------- mixed / bilingual cells ----------------
/**
 * Strict VNI tells (reference: docs/update4/vni.py): tone marks after a vowel, "ñ/Ñ", horn letters + tone,
 * circumflex/breve + tone. A lone "ô" or "Ô" is NOT a tell – it is a normal Unicode letter ("CÔNG TÁC BÊ TÔNG").
 */
export const VNI_MARKERS = /[øùûõïåäëüÑñöÖ]|[aeoAEO][âàáåãä]|[aA][êèéúüë]|[ôö][øùûõï]/;
const UNI_ONLY = /[ăĂđĐơƠưƯẠ-ỹ]/;

/** True when the text carries a VNI tell (and is not TCVN3 ABC text, whose letters overlap). */
export function hasVniMarkers(s: string): boolean {
  return VNI_MARKERS.test(s);
}

/**
 * Convert a cell that may mix VNI and Unicode ("Eùp coïc thử tĩnh Φ400"): a cell without Unicode-only Vietnamese letters is converted as a whole,
 * otherwise only the space-separated tokens that carry a VNI tell.
 */
export function fixVniCell(s: string): string {
  if (!hasVniMarkers(s)) return s;
  if (!UNI_ONLY.test(s)) return vniToUnicode(s);
  return s
    .split(' ')
    .map((t) => (hasVniMarkers(t) ? vniToUnicode(t) : t))
    .join(' ');
}

const CJK_START = /[⺀-鿿豈-﫿＀-￯　-〿]/;
/** Split "Đào đất móng挖土基础" into the Vietnamese text and the trailing Chinese text. */
export function splitChinese(s: string): { vi: string; zh: string } {
  const i = s.search(CJK_START);
  if (i < 0) return { vi: s.trim(), zh: '' };
  if (i === 0) {
    // Chinese first ("混凝土垫层 / Bê tông lót móng"): the Vietnamese text is what follows the Chinese run
    const m = /^[^A-Za-zÀ-ỹ]*?(?=[A-Za-zÀ-ỹ])/u.exec(s);
    if (m && m[0].length > 0) return { vi: s.slice(m[0].length).trim(), zh: m[0].replace(/[\s,;:/\-–]+$/, '').trim() };
    return { vi: '', zh: s.trim() };
  }
  return { vi: s.slice(0, i).replace(/[\s,;:/\-–]+$/, '').trim(), zh: s.slice(i).trim() };
}
export const hasChinese = (s: string): boolean => CJK_START.test(s);

import { normalizeText } from './text.js';
import { isKnownUnit } from './units.js';
import { parseFlexibleNumber, type Cell } from './sheetdetect.js';

/** Norm-code shapes: AF.11111, AF11111, SA.12345, TT12-era "TT12.AF.11111", placeholders TT / VD / GTT. */
export const CODE_RE = /^(?:TT\d{0,2}[.\-_]?[A-Z]{2}[.\-_]?\d{3,6}[A-Z]?\d{0,2}|[A-Z]{1,3}[.\-_]?\d{4,6}[A-Z]?\d{0,2}|TT|VD|GTT[.\-_]?\d*|BG)$/i;

const WORDS = [
  'dao', 'dap', 'be tong', 'btct', 'xay', 'lap', 'cot thep', 'thep', 'van khuon', 'trat', 'son', 'lat', 'op', 'ong', 'cung cap', 'thi cong', 'san xuat',
  'van chuyen', 'coc', 'tuong', 'mong', 'cot', 'dam', 'san', 'mai', 'cua', 'day dien', 'gach', 'ba ', 'xi mang', 'cat', 'da ', 'gia cong', 'thao do',
  've sinh', 'hoan thien', 'nen', 'may', 'bom', 'den', 'cap ', 'van', 'ket cau', 'cong tac', 'mat bang', 'ranh', 'cong ', 'tram', 'nha',
];
const HEADER_NAME = ['noi dung', 'ten cong viec', 'ten cong tac', 'hang muc', 'dien giai', 'mo ta', 'cong viec'];

export interface ColumnProfile {
  index: number;
  nonEmpty: number;
  /** Share of non-empty cells that are numbers (also numbers stored as text: "1.382.500", "15 000 000"). */
  numericShare: number;
  textShare: number;
  avgTextLen: number;
  /** Share of cells containing a Vietnamese construction word. */
  wordShare: number;
  /** Share of cells that look like a norm code. */
  codeShare: number;
  /** Share of cells that are a known measurement unit. */
  unitShare: number;
  headerHint: boolean;
  /** Content score of the column as the "Tên công tác" column (-1 = can never be the name). */
  nameScore: number;
}

const str = (v: Cell | undefined): string => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());

/** Profile every column of the data rows [first, last] (0-based, inclusive). */
export function profileColumns(rows: Cell[][], first: number, last: number, headerLabels: string[] = []): ColumnProfile[] {
  const width = Math.max(0, ...rows.slice(first, last + 1).map((r) => r?.length ?? 0), headerLabels.length);
  const out: ColumnProfile[] = [];
  for (let c = 0; c < width; c++) {
    let nonEmpty = 0;
    let numeric = 0;
    let text = 0;
    let textLen = 0;
    let words = 0;
    let codes = 0;
    let units = 0;
    for (let r = first; r <= Math.min(last, rows.length - 1); r++) {
      const v = rows[r]?.[c];
      const s = str(v);
      if (!s) continue;
      nonEmpty++;
      const isNum = typeof v === 'number' || parseFlexibleNumber(s) !== null;
      if (isNum) numeric++;
      else {
        text++;
        textLen += s.length;
        const n = ` ${normalizeText(s)} `;
        if (WORDS.some((w) => n.includes(` ${w.trim()}`) || n.includes(w))) words++;
        if (CODE_RE.test(s.replace(/\s+/g, ''))) codes++;
        if (s.length <= 8 && isKnownUnit(s)) units++;
      }
    }
    const label = normalizeText(headerLabels[c] ?? '');
    const headerHint = HEADER_NAME.some((h) => label === h || label.startsWith(h + ' ') || label.endsWith(' ' + h) || label.includes(' ' + h + ' '));
    const numericShare = nonEmpty ? numeric / nonEmpty : 0;
    const textShare = nonEmpty ? text / nonEmpty : 0;
    const avgTextLen = text ? textLen / text : 0;
    const wordShare = nonEmpty ? words / nonEmpty : 0;
    const codeShare = nonEmpty ? codes / nonEmpty : 0;
    const unitShare = nonEmpty ? units / nonEmpty : 0;
    // a column of mostly numbers, codes or units can never be the description column
    const never = nonEmpty === 0 || numericShare >= 0.6 || codeShare >= 0.5 || unitShare >= 0.6;
    const nameScore = never ? -1 : 0.35 * textShare + 0.2 * Math.min(avgTextLen / 40, 1) + 0.3 * wordShare + (headerHint ? 0.25 : 0) + 0.1 * Math.min(nonEmpty / Math.max(1, last - first + 1), 1);
    out.push({ index: c, nonEmpty, numericShare, textShare, avgTextLen, wordShare, codeShare, unitShare, headerHint, nameScore });
  }
  return out;
}

export interface RefineOptions {
  /** Columns that must never be auto-selected (hidden, or continuation of a merged cell). */
  exclude?: ReadonlySet<number>;
  first: number;
  last: number;
  headerLabels: string[];
}

export interface Refined {
  mapping: Partial<Record<string, number>>;
  profiles: ColumnProfile[];
  /** Human readable notes of what content-based detection changed. */
  notes: string[];
}

/**
 * Content-based correction of a header-based column mapping: the name column can never be a numeric
 * column (picked by the best-scoring text column instead); the code column falls back to the column
 * with the highest norm-code hit rate; the unit column to the column of known units.
 */
export function refineMapping(rows: Cell[][], mapping: Partial<Record<string, number>>, o: RefineOptions): Refined {
  const profiles = profileColumns(rows, o.first, o.last, o.headerLabels);
  const ex = o.exclude ?? new Set<number>();
  const notes: string[] = [];
  const out: Partial<Record<string, number>> = { ...mapping };
  const letter = (c: number) => (c < 26 ? String.fromCharCode(65 + c) : `C${c + 1}`);
  const taken = (c: number, except: string) => Object.entries(out).some(([k, v]) => k !== except && v === c);
  // hidden / duplicate columns are never auto-selected
  for (const [k, v] of Object.entries(out)) if (v !== undefined && ex.has(v)) {
    delete out[k];
    notes.push(`Bỏ cột ${letter(v)} (cột ẩn hoặc phần nối của ô gộp) khỏi trường ${k}`);
  }

  // name
  const cur = out.name !== undefined ? profiles[out.name] : undefined;
  const cands = profiles.filter((p) => p.nameScore >= 0 && !ex.has(p.index) && !taken(p.index, 'name') && !['stt', 'code', 'unit', 'quantity'].some((f) => out[f] === p.index));
  const best = [...cands].sort((a, b) => b.nameScore - a.nameScore || a.index - b.index)[0];
  if (!cur || cur.nameScore < 0) {
    if (out.name !== undefined) notes.push(`Cột ${letter(out.name)} chủ yếu là số/mã – không dùng làm tên công việc`);
    if (best) {
      out.name = best.index;
      notes.push(`Tên công việc: chọn cột ${letter(best.index)} theo nội dung (chữ, có từ khóa xây dựng)`);
    } else delete out.name;
  } else if (best && best.index !== cur.index && best.nameScore > cur.nameScore + 0.2 && !cur.headerHint) {
    out.name = best.index;
    notes.push(`Tên công việc: cột ${letter(best.index)} có nội dung phù hợp hơn cột ${letter(cur.index)}`);
  }

  // code: header first; otherwise the column with the best code hit rate
  if (out.code === undefined || (profiles[out.code]?.codeShare ?? 0) === 0) {
    const cc = profiles.filter((p) => p.codeShare >= 0.3 && !ex.has(p.index) && !taken(p.index, 'code')).sort((a, b) => b.codeShare - a.codeShare || a.index - b.index)[0];
    if (cc) {
      out.code = cc.index;
      notes.push(`Mã hiệu: chọn cột ${letter(cc.index)} theo tỷ lệ khớp mẫu mã định mức (${Math.round(cc.codeShare * 100)}%)`);
    }
  }
  // unit
  if (out.unit === undefined) {
    const uc = profiles.filter((p) => p.unitShare >= 0.5 && !ex.has(p.index) && !taken(p.index, 'unit')).sort((a, b) => b.unitShare - a.unitShare || a.index - b.index)[0];
    if (uc) {
      out.unit = uc.index;
      notes.push(`Đơn vị: chọn cột ${letter(uc.index)} theo nội dung (đơn vị đo)`);
    }
  }
  return { mapping: out, profiles, notes };
}

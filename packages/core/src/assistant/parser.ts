import { isFormula } from '../formula.js';
import { normalizeKeepIndex } from '../text.js';
import { parseAmount, parseVnNumber } from '../numbers.js';
import type { Intent, IntentProvider } from './intents.js';

const NUM = String.raw`\d[\d.,]*\d|\d`;
const UNIT = String.raw`100m3|100m2|100m|1000m3|m3|m2|md|m|tan|kg|cai|bo|cau|coc|lit|vien|cay|con|tam|km|ha`;
const CODE_RE = /\b([a-z]{2}\.\d{4,5}[a-z0-9]*)\b/;
const POLITE = String.raw`(?:(?:hay|giup toi|giup|vui long|lam on|xin|toi muon|toi can|cho toi)\s+)*`;

/** Match `re` against the normalised text and return spans cut from the original text. */
class Text {
  constructor(
    readonly original: string,
    readonly norm: string,
  ) {}
  static of(s: string): Text {
    const cleaned = s.replace(/³/g, '3').replace(/²/g, '2').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
    const { original, norm } = normalizeKeepIndex(cleaned);
    return new Text(original, norm);
  }
  slice(start: number, end?: number): Text {
    return new Text(this.original.slice(start, end), this.norm.slice(start, end));
  }
  /** Returns the i-th capture group as a Text (using the `d` flag indices). */
  group(m: RegExpExecArray, i: number): Text | undefined {
    const idx = m.indices?.[i];
    if (!idx) return undefined;
    return this.slice(idx[0], idx[1]);
  }
  trim(): Text {
    const start = this.norm.length - this.norm.trimStart().length;
    const end = this.norm.trimEnd().length;
    return this.slice(start, Math.max(start, end));
  }
  get empty(): boolean {
    return this.norm.trim() === '';
  }
}

function withIndices(re: RegExp): RegExp {
  return re.flags.includes('d') ? re : new RegExp(re.source, re.flags + 'd');
}

function exec(t: Text, re: RegExp): RegExpExecArray | null {
  return withIndices(re).exec(t.norm);
}

/** Remove a matched span from the text (keeps original/norm aligned). */
function cut(t: Text, start: number, end: number): Text {
  return new Text(
    (t.original.slice(0, start) + ' ' + t.original.slice(end)).replace(/\s+/g, ' '),
    (t.norm.slice(0, start) + ' ' + t.norm.slice(end)).replace(/\s+/g, ' '),
  ).trim();
}

function stripQuotes(s: string): string {
  return s.replace(/^["'“”‘’«»\s]+|["'“”‘’«»\s,.:;]+$/g, '').trim();
}

/** Strip leading filler such as "công tác", "định mức", "mã". */
function stripLeading(t: Text): Text {
  let cur = t.trim();
  for (;;) {
    const m = exec(cur, /^(cong tac|dinh muc|ma dinh muc|ma hieu|ma|dm|hang muc|khoi luong|kl|cua|la)\s+/);
    if (!m) return cur;
    cur = cur.slice(m[0].length).trim();
  }
}

function parseQuantityValue(raw: string): { quantity?: number; quantityFormula?: string } {
  const v = raw.trim().replace(new RegExp(String.raw`\s*(${UNIT})$`), '').trim();
  const n = parseVnNumber(v);
  if (n !== null) return { quantity: n };
  if (isFormula(v)) return { quantityFormula: v.replace(/\s+/g, '') };
  return {};
}

function parseAdd(body: Text): Intent {
  const intent: Extract<Intent, { kind: 'addItem' }> = { kind: 'addItem' };
  let rest = body.trim();

  // Category: "... vào (hạng mục) Phần thân" / "... ở hạng mục X" / "... trong hạng mục X"
  const cat = exec(rest, /\s(?:vao|o|trong|thuoc)\s+(?:hang muc|hm)\s+(.+)$|\svao\s+(?!hang muc)(.+)$/);
  if (cat) {
    const g = rest.group(cat, 1) ?? rest.group(cat, 2);
    if (g && !g.empty) intent.categoryName = stripQuotes(g.original);
    rest = rest.slice(0, cat.index).trim();
  }

  const code = exec(rest, CODE_RE);
  if (code) {
    intent.normCode = code[1].toUpperCase();
    rest = cut(rest, code.index, code.index + code[0].length);
  }

  // Quantity: leading number, "khối lượng 50", or "<num> <unit>" anywhere (not after "mác").
  const patterns = [
    new RegExp(String.raw`^(${NUM})\s*(${UNIT})?(?![a-z0-9])`),
    new RegExp(String.raw`(?:khoi luong|kl)\s*(?:=|la|:)?\s*(${NUM})\s*(${UNIT})?(?![a-z0-9])`),
    new RegExp(String.raw`(?<!mac |mac|m|da |cap )(?<![\d.,])(${NUM})\s*(${UNIT})(?![a-z0-9])`),
  ];
  for (const re of patterns) {
    const m = exec(rest, re);
    if (!m) continue;
    const n = parseVnNumber(m[1]);
    if (n === null) continue;
    intent.quantity = n;
    if (m[2]) intent.unit = m[2];
    rest = cut(rest, m.index, m.index + m[0].length);
    break;
  }

  const query = stripLeading(rest);
  if (!query.empty) intent.normQuery = stripQuotes(query.original);
  return intent;
}

/** Parse one Vietnamese command (with or without diacritics) into an Intent. */
export function parseCommand(input: string): Intent {
  const t = Text.of(input);
  const n = t.norm;
  if (!n) return { kind: 'unknown', text: input };

  if (/^(hoan tac|undo|quay lai|huy thao tac( vua roi)?|huy buoc)\b/.test(n)) return { kind: 'undo' };
  if (/^(huong dan|tro giup|giup do|help|\?)$|lam (duoc )?(nhung )?gi\b|co the lam gi/.test(n)) return { kind: 'help' };
  if (/\b(xuat|export|in)\s+(ra\s+)?(file\s+|tep\s+)?(excel|xlsx|bao cao|file|tep)\b/.test(n)) return { kind: 'exportExcel' };
  if (/\b(cap nhat|doi|chuyen)\b.*\b(don gia|gia|dinh muc)\b.*\b(khu vuc|tinh|thanh pho|tp|dia phuong)\b|\b(don gia|gia|dinh muc)\b.*\btheo (khu vuc|tinh|dia phuong)\b/.test(n)) return { kind: 'regionalUpdate' };
  if (new RegExp(String.raw`^${POLITE}(nhap|import|tai len|mo|doc)\s+(du lieu|file|tep|tu|excel|csv)\b`).test(n)) {
    return { kind: 'importFile' };
  }

  if (/\b(gan|dat|tu dong gan|goi y)\s+ma\b|\bgan ma tu dong\b/.test(n)) {
    const th = /\bnguong\s*(\d+(?:[.,]\d+)?)\s*%?/.exec(n);
    let threshold: number | undefined;
    if (th) {
      threshold = Number(th[1].replace(',', '.'));
      if (threshold > 1) threshold /= 100;
    }
    return threshold !== undefined ? { kind: 'autoAssign', threshold } : { kind: 'autoAssign' };
  }

  let m: RegExpExecArray | null;

  m = exec(t, new RegExp(String.raw`^${POLITE}(?:tao|them|lap|tao moi|them moi)\s+(?:moi\s+)?(?:hang muc|hm)\s*(?:moi\s*)?(?:(?:ten|co ten)\s+(?:la\s+)?)?(.*)$`));
  if (m) {
    const name = stripQuotes(t.group(m, 1)?.original ?? '');
    return { kind: 'createCategory', name: name || undefined };
  }

  m = exec(
    t,
    new RegExp(
      String.raw`^${POLITE}(?:(?:doi|sua|cap nhat|dat|chinh|thay doi|nhap|dieu chinh)\s+(?:lai\s+)?)?(?:don\s+)?gia\s+(.+?)\s*(?:\s(?:thanh|la|bang|len|xuong con|xuong|con)\s|=|:)\s*(.+)$`,
    ),
  );
  if (m) {
    const target = stripLeading(t.group(m, 1)!);
    const amount = parseAmount(t.group(m, 2)!.norm);
    const intent: Intent = { kind: 'setPrice' };
    // A single token such as "V00123" or "N1.3507" is treated as a resource code.
    if (/^[a-z]{1,3}\.?\d[a-z0-9.]*$/.test(target.norm)) {
      intent.resourceCode = target.original.toUpperCase();
    } else {
      intent.resourceQuery = stripQuotes(target.original);
    }
    if (amount) {
      intent.price = amount.value;
      if (amount.perUnit) intent.priceUnit = amount.perUnit;
    }
    return intent;
  }

  m = exec(
    t,
    new RegExp(
      String.raw`^${POLITE}(?:doi|sua|cap nhat|dat|chinh|thay doi|nhap|dieu chinh)\s+(?:lai\s+)?(?:khoi luong|kl)\s+(?:cua\s+)?(.+?)\s*(?:\s(?:thanh|la|bang)\s|=|:)\s*(.+)$`,
    ),
  );
  if (m) {
    const target = stripLeading(t.group(m, 1)!);
    const value = parseQuantityValue(t.group(m, 2)!.norm);
    const intent: Extract<Intent, { kind: 'updateQuantity' }> = { kind: 'updateQuantity', ...value };
    const line = /^(?:dong|stt|so|muc)\s*(\d+)$/.exec(target.norm);
    const code = CODE_RE.exec(target.norm);
    if (line) intent.line = Number(line[1]);
    else if (code) intent.normCode = code[1].toUpperCase();
    else intent.query = stripQuotes(target.original);
    return intent;
  }

  m = exec(t, new RegExp(String.raw`^${POLITE}(?:tim kiem|tim|tra cuu|tra|search|loc)\s+(.*)$`));
  if (m) {
    const q = stripLeading(t.group(m, 1)!);
    return { kind: 'searchNorm', query: stripQuotes(q.original) };
  }

  m = exec(t, new RegExp(String.raw`^${POLITE}(?:them|bo sung|chen|nhap them|nhap|add)\s+(?:cong tac\s+|dinh muc\s+)?(.+)$`));
  if (m) return parseAdd(t.group(m, 1)!);

  if (/^(tinh lai|tinh toan lai|tinh toan|cap nhat lai|cap nhat|lam moi|recalc|tinh)\b/.test(n) && n.length <= 50) {
    return { kind: 'recalc' };
  }

  return { kind: 'unknown', text: input };
}

/** Offline, default provider. */
export class RuleBasedProvider implements IntentProvider {
  readonly name = 'rule-based';
  async parse(text: string): Promise<Intent> {
    return parseCommand(text);
  }
}

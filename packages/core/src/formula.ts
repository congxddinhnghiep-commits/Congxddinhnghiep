/**
 * Safe evaluator for quantity formulas ("diễn giải khối lượng"), e.g. "2*3.5*0.3 + 4x1,2".
 * Supports + - * / ^, parentheses, "x"/"×" as multiply, comma as decimal separator.
 * Text in [brackets] or "quotes" is treated as a comment and ignored.
 */
export class FormulaError extends Error {}

export function evaluateFormula(input: string): number {
  const src = input
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/[×xX]/g, '*')
    .replace(/÷/g, '/')
    .replace(/(\d),(\d)/g, '$1.$2')
    .trim();
  if (!src) throw new FormulaError('Công thức rỗng');
  let pos = 0;

  const peek = () => {
    while (src[pos] === ' ') pos++;
    return src[pos];
  };
  const expect = (ch: string) => {
    if (peek() !== ch) throw new FormulaError(`Thiếu "${ch}" tại vị trí ${pos + 1}`);
    pos++;
  };

  function parseExpr(): number {
    let v = parseTerm();
    for (;;) {
      const c = peek();
      if (c === '+') { pos++; v += parseTerm(); }
      else if (c === '-') { pos++; v -= parseTerm(); }
      else return v;
    }
  }
  function parseTerm(): number {
    let v = parsePower();
    for (;;) {
      const c = peek();
      if (c === '*') { pos++; v *= parsePower(); }
      else if (c === '/') {
        pos++;
        const d = parsePower();
        if (d === 0) throw new FormulaError('Chia cho 0');
        v /= d;
      } else return v;
    }
  }
  function parsePower(): number {
    const b = parseUnary();
    if (peek() === '^') { pos++; return Math.pow(b, parsePower()); }
    return b;
  }
  function parseUnary(): number {
    const c = peek();
    if (c === '-') { pos++; return -parseUnary(); }
    if (c === '+') { pos++; return parseUnary(); }
    return parsePrimary();
  }
  function parsePrimary(): number {
    const c = peek();
    if (c === '(') {
      pos++;
      const v = parseExpr();
      expect(')');
      return v;
    }
    const m = /^\d+(\.\d+)?|^\.\d+/.exec(src.slice(pos));
    if (!m) throw new FormulaError(`Ký tự không hợp lệ "${c ?? ''}" tại vị trí ${pos + 1}`);
    pos += m[0].length;
    return parseFloat(m[0]);
  }

  const result = parseExpr();
  if (peek() !== undefined) throw new FormulaError(`Ký tự không hợp lệ "${src[pos]}" tại vị trí ${pos + 1}`);
  if (!Number.isFinite(result)) throw new FormulaError('Kết quả không hợp lệ');
  return result;
}

/** True when the string looks like a formula rather than a plain number. */
export function isFormula(s: string): boolean {
  return /[-+*/()^×xX]/.test(s.trim().replace(/^-/, ''));
}

const colIndex = (col: string) => [...col.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const REF = '\\$?([A-Za-z]{1,3})\\$?(\\d{1,7})';

/** True if the spreadsheet formula (without "=") is a SUM(...) over cells. */
export const isSumFormula = (f: string) => /^\s*=?\s*SUM\s*\(/i.test(f);

/**
 * Evaluate a spreadsheet formula written with cell references in the same sheet, e.g.
 * "E6*(F6+G6)" or "SUM(H6:H8)". `resolve(row, col)` returns the numeric value of a 0-based cell,
 * or null when it is unknown – then the formula is NOT evaluated (never silently 0).
 */
export function evaluateSheetFormula(formula: string, resolve: (row: number, col: number) => number | null): number {
  let src = formula.trim().replace(/^=/, '');
  if (/[A-Za-z_]+\s*\(/.test(src.replace(/\bSUM\s*\(/gi, ''))) throw new FormulaError('Hàm chưa hỗ trợ (chỉ hỗ trợ SUM)');
  if (/!|\[/.test(src)) throw new FormulaError('Công thức tham chiếu sheet/workbook khác');
  const at = (row0: number, col0: number, label: string) => {
    const v = resolve(row0, col0);
    if (v === null) throw new FormulaError(`Không xác định được ô ${label}`);
    return v;
  };
  const cell = (col: string, row: string) => at(Number(row) - 1, colIndex(col), `${col.toUpperCase()}${row}`);
  const range = new RegExp(`^${REF}:${REF}$`);
  const single = new RegExp(`^${REF}$`);
  src = src.replace(/\bSUM\s*\(([^)]*)\)/gi, (_m, args: string) => {
    let total = 0;
    for (const part of args.split(',').map((p) => p.trim()).filter(Boolean)) {
      const r = range.exec(part);
      if (r) {
        const [r1, r2] = [Number(r[2]), Number(r[4])].sort((a, b) => a - b);
        const [c1, c2] = [colIndex(r[1]), colIndex(r[3])].sort((a, b) => a - b);
        for (let row = r1; row <= r2; row++) for (let c = c1; c <= c2; c++) total += at(row - 1, c, `R${row}C${c + 1}`);
      } else if (single.exec(part)) {
        const s = single.exec(part)!;
        total += cell(s[1], s[2]);
      } else total += evaluateFormula(part);
    }
    return `(${total})`;
  });
  src = src.replace(new RegExp(REF, 'g'), (_m, col: string, row: string) => `(${cell(col, row)})`);
  return evaluateFormula(src);
}

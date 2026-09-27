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

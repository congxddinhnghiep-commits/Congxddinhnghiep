/**
 * Safe quantity expression engine (no eval): tokenizer → AST with a whitelist of node types
 * (number, variable, unary minus/plus, + − × ÷, parentheses, percent) → evaluation.
 * Limits on length, depth and node count protect against pathological input.
 */
import { unitFactor } from './units.js';

export type QNode =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'neg'; x: QNode }
  | { t: 'bin'; op: '+' | '-' | '*' | '/'; a: QNode; b: QNode }
  | { t: 'call'; name: string; args: QNode[] };

export class QuantityError extends Error {}

export const QTY_LIMITS = { maxLength: 500, maxDepth: 40, maxNodes: 400 };

/**
 * Whitelisted functions for "Bảng tính tay" / manual formulas (Update 5 section E):
 * tron = round(x, n decimals); chuvi_cn/dt_cn = chu vi/diện tích chữ nhật; dt_tron = diện tích hình tròn (d = đường kính);
 * tt_hop/tt_tru/tt_chop_cut = thể tích hộp/trụ/chóp cụt (chóp cụt = same shape as the sloped-pit excavation formula).
 */
const FUNCTIONS: Record<string, (args: number[]) => number> = {
  tron: (a) => {
    const n = a[1] ?? 0;
    const f = Math.pow(10, n);
    return Math.round(a[0] * f) / f;
  },
  sqrt: (a) => {
    if (a[0] < 0) throw new QuantityError('sqrt của số âm');
    return Math.sqrt(a[0]);
  },
  min: (a) => Math.min(...a),
  max: (a) => Math.max(...a),
  abs: (a) => Math.abs(a[0]),
  chuvi_cn: (a) => 2 * (a[0] + a[1]),
  dt_cn: (a) => a[0] * a[1],
  dt_tron: (a) => (Math.PI * a[0] * a[0]) / 4,
  tt_hop: (a) => a[0] * a[1] * a[2],
  tt_tru: (a) => (Math.PI * a[0] * a[0] * a[1]) / 4,
  tt_chop_cut: ([a, b, a2, b2, h]) => (h / 6) * (a * b + (a + a2) * (b + b2) + a2 * b2),
};

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string };

/**
 * Numbers: "6.6", "0,3" (VN decimal comma), "1,000,000,000" / "1.000.000.000" (thousand groups),
 * "1e9", "12%" (= 0,12). Multiplication may be written "*", "x", "×"; division "/" or ":".
 */
function tokenize(src: string): Tok[] {
  // "x" / "×" means multiplication only between numbers or parentheses (a variable may be named X).
  const s = src.replace(/(?<=[\d)%]\s*)[×xX](?=\s*[\d(.])/g, '*').replace(/×/g, '*').replace(/÷|:/g, '/');
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if ('+-*/(),'.includes(c)) {
      out.push({ k: 'op', v: c });
      i++;
      continue;
    }
    if (/[\d.]/.test(c)) {
      const m = /^(\d{1,3}(?:,\d{3}){2,}|\d{1,3}(?:\.\d{3}){2,}|\d+(?:[.,]\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
      if (!m) throw new QuantityError(`Số không hợp lệ tại vị trí ${i + 1}`);
      let raw = m[0];
      let mant = m[1];
      if (/^\d{1,3}(,\d{3}){2,}$/.test(mant)) mant = mant.replace(/,/g, '');
      else if (/^\d{1,3}(\.\d{3}){2,}$/.test(mant)) mant = mant.replace(/\./g, '');
      else mant = mant.replace(',', '.');
      const exp = raw.slice(m[1].length);
      let v = Number(mant + exp);
      i += raw.length;
      if (s[i] === '%') {
        v /= 100;
        i++;
      }
      if (!Number.isFinite(v)) throw new QuantityError('Số quá lớn');
      out.push({ k: 'num', v });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i))!;
      out.push({ k: 'id', v: m[0] });
      i += m[0].length;
      continue;
    }
    throw new QuantityError(`Ký tự không được phép "${c}" tại vị trí ${i + 1}`);
  }
  return out;
}

/** Parse an expression into a whitelisted AST. */
export function parseQuantity(src: string): QNode {
  if (src.length > QTY_LIMITS.maxLength) throw new QuantityError(`Biểu thức quá dài (> ${QTY_LIMITS.maxLength} ký tự)`);
  const toks = tokenize(src);
  if (!toks.length) throw new QuantityError('Biểu thức rỗng');
  let p = 0;
  let nodes = 0;
  const node = <T extends QNode>(n: T): T => {
    if (++nodes > QTY_LIMITS.maxNodes) throw new QuantityError('Biểu thức quá phức tạp');
    return n;
  };
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.k === 'op' && peek()!.v === v;

  function expr(d: number): QNode {
    if (d > QTY_LIMITS.maxDepth) throw new QuantityError('Biểu thức lồng quá sâu');
    let a = term(d);
    while (isOp('+') || isOp('-')) {
      const op = toks[p++].v as '+' | '-';
      a = node({ t: 'bin', op, a, b: term(d) });
    }
    return a;
  }
  function term(d: number): QNode {
    let a = unary(d);
    while (isOp('*') || isOp('/')) {
      const op = toks[p++].v as '*' | '/';
      a = node({ t: 'bin', op, a, b: unary(d) });
    }
    return a;
  }
  function unary(d: number): QNode {
    if (isOp('-')) {
      p++;
      return node({ t: 'neg', x: unary(d + 1) });
    }
    if (isOp('+')) {
      p++;
      return unary(d + 1);
    }
    return primary(d);
  }
  function primary(d: number): QNode {
    const t = peek();
    if (!t) throw new QuantityError('Biểu thức thiếu toán hạng');
    if (t.k === 'op' && t.v === '(') {
      p++;
      const e = expr(d + 1);
      if (!isOp(')')) throw new QuantityError('Thiếu dấu ")"');
      p++;
      return e;
    }
    if (t.k === 'num') {
      p++;
      return node({ t: 'num', v: t.v });
    }
    if (t.k === 'id') {
      p++;
      if (isOp('(')) {
        p++;
        const args: QNode[] = [];
        if (!isOp(')')) {
          args.push(expr(d + 1));
          while (isOp(',')) {
            p++;
            args.push(expr(d + 1));
          }
        }
        if (!isOp(')')) throw new QuantityError('Thiếu dấu ")"');
        p++;
        return node({ t: 'call', name: t.v, args });
      }
      return node({ t: 'var', name: t.v });
    }
    throw new QuantityError(`Không mong đợi "${t.v}"`);
  }
  const ast = expr(0);
  if (p < toks.length) throw new QuantityError(`Không mong đợi "${toks[p].v}"`);
  return ast;
}

export function evalQuantity(ast: QNode, vars: Record<string, number> = {}): number {
  switch (ast.t) {
    case 'num':
      return ast.v;
    case 'var': {
      const key = Object.keys(vars).find((k) => k.toLowerCase() === ast.name.toLowerCase());
      if (key === undefined) {
        if (ast.name.toLowerCase() === 'pi') return Math.PI;
        throw new QuantityError(`Biến "${ast.name}" chưa có giá trị`);
      }
      const v = vars[key];
      if (!Number.isFinite(v)) throw new QuantityError(`Biến "${ast.name}" không hợp lệ`);
      return v;
    }
    case 'neg':
      return -evalQuantity(ast.x, vars);
    case 'bin': {
      const a = evalQuantity(ast.a, vars);
      const b = evalQuantity(ast.b, vars);
      if (ast.op === '+') return a + b;
      if (ast.op === '-') return a - b;
      if (ast.op === '*') return a * b;
      if (b === 0) throw new QuantityError('Chia cho 0');
      return a / b;
    }
    case 'call': {
      const fn = FUNCTIONS[ast.name.toLowerCase()];
      if (!fn) throw new QuantityError(`Hàm "${ast.name}" không được hỗ trợ`);
      return fn(ast.args.map((a) => evalQuantity(a, vars)));
    }
  }
}

export function variablesOf(ast: QNode, acc = new Set<string>()): Set<string> {
  if (ast.t === 'var') acc.add(ast.name);
  else if (ast.t === 'neg') variablesOf(ast.x, acc);
  else if (ast.t === 'bin') {
    variablesOf(ast.a, acc);
    variablesOf(ast.b, acc);
  } else if (ast.t === 'call') {
    for (const a of ast.args) variablesOf(a, acc);
  }
  return acc;
}

/** Evaluate an expression string with variables; result rounded to 1e-9 to remove float noise. */
export function evaluateQuantity(expression: string, vars: Record<string, number> = {}): number {
  const v = evalQuantity(parseQuantity(expression), vars);
  return Math.round(v * 1e9) / 1e9;
}

export interface ManualFormulaResult {
  value: number;
  variables: Record<string, number>;
}

/**
 * Evaluate a "Bảng tính tay" manual formula (Update 5 section E.1): named variables separated by
 * ";" or newline, a trailing result expression, and "// ..." end-of-line comments, e.g.
 * "a=3,5; b=4,2; 2*(a+b)*0,2*3 // tường bao" → { value: 9.24, variables: { a: 3.5, b: 4.2 } }.
 */
export function evaluateManualFormula(input: string): ManualFormulaResult {
  const noComments = input
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  const parts = noComments
    .split(/[;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) throw new QuantityError('Công thức rỗng');
  const vars: Record<string, number> = {};
  let value: number | null = null;
  for (const part of parts) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(part);
    if (m) vars[m[1]] = evaluateQuantity(m[2], vars);
    else value = evaluateQuantity(part, vars);
  }
  if (value === null) throw new QuantityError('Thiếu biểu thức kết quả');
  return { value, variables: vars };
}

/** Parse "L=6,6; W=14.2 H=3,8" into a variable map. */
export function parseVariables(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (!text.trim()) return out;
  for (const part of text.split(/[;\n]+|\s+(?=[A-Za-z_][A-Za-z0-9_]*\s*=)/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/.exec(part);
    if (!m) {
      if (part.trim()) throw new QuantityError(`Không hiểu biến "${part.trim()}" (dạng L=6,6)`);
      continue;
    }
    out[m[1]] = evaluateQuantity(m[2]);
  }
  return out;
}

export interface QuantityLineInput {
  description?: string;
  expression: string;
  /** Variable values, e.g. { L: 6.6, W: 14.2 } */
  variables?: Record<string, number>;
  /** +1 normal, −1 documented deduction (lỗ mở, phần trừ). */
  sign?: 1 | -1;
  /** Unit the expression result is measured in (e.g. "mm3"); empty = item unit. */
  unit?: string | null;
}

export interface QuantityLineResult extends QuantityLineInput {
  /** Raw expression value (in the line unit). */
  raw: number | null;
  /** Conversion factor line unit → item unit. */
  factor: number | null;
  /** Signed contribution in the item unit. */
  result: number | null;
  error: string | null;
  warnings: string[];
}

/**
 * Evaluate the quantity lines of one item: quantity = Σ sign × value × unit factor.
 * Negative values are allowed only on lines marked as deductions (sign −1).
 */
export function computeQuantityLines(lines: QuantityLineInput[], itemUnit: string): { total: number; lines: QuantityLineResult[]; errors: number } {
  let total = 0;
  let errors = 0;
  const out = lines.map((l): QuantityLineResult => {
    const sign = l.sign === -1 ? -1 : 1;
    const r: QuantityLineResult = { ...l, sign, raw: null, factor: null, result: null, error: null, warnings: [] };
    try {
      r.raw = evaluateQuantity(l.expression, l.variables ?? {});
      const f = l.unit && itemUnit ? unitFactor(l.unit, itemUnit) : 1;
      if (f === null) throw new QuantityError(`Đơn vị "${l.unit}" không quy đổi được sang "${itemUnit}"`);
      r.factor = f;
      r.result = Math.round(sign * r.raw * f * 1e9) / 1e9;
      if (r.raw < 0 && sign === 1) r.warnings.push('Giá trị âm nhưng dòng không được đánh dấu là phần trừ');
      total += r.result;
    } catch (e) {
      r.error = (e as Error).message;
      errors++;
    }
    return r;
  });
  return { total: Math.round(total * 1e9) / 1e9, lines: out, errors };
}

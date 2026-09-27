import { evaluateFormula, isFormula } from '../formula.js';
import { convertPrice, normalizeUnit, parseAmount, parseVnNumber } from '../numbers.js';
import { formatNumber, normalizeText } from '../text.js';
import type { Norm, Resource } from '../types.js';
import type { Intent, IntentProvider, Reply, ReplyOption } from './intents.js';

export interface ContextItem {
  id: number;
  /** 1-based line number (STT) across the whole estimate */
  line: number;
  normCode: string;
  name: string;
  unit: string;
  quantity: number;
  categoryName: string;
}

/** Read-only lookups the engine needs. Implemented by the server on top of the database. */
export interface AssistantContext {
  searchNorms(query: string, limit?: number): Norm[];
  getNorm(code: string): Norm | undefined;
  listCategories(): { id: number; name: string }[];
  searchResources(query: string, limit?: number): (Resource & { price: number })[];
  getResource(code: string): (Resource & { price: number }) | undefined;
  listItems(): ContextItem[];
}

export type PendingField = NonNullable<Extract<Reply, { type: 'question' }>['pending']>;

const MAX_OPTIONS = 8;
const fmt = (n: number) => formatNumber(n, n % 1 === 0 ? 0 : 3);

export const HELP_TEXT = [
  'Tôi có thể giúp bạn các thao tác sau (gõ có dấu hoặc không dấu đều được):',
  '• Thêm công tác: "thêm 50 m3 bê tông cột mác 300 vào hạng mục phần thân"',
  '• Tìm định mức: "tìm mã định mức đào đất móng"',
  '• Đổi giá: "đổi giá xi măng PCB40 thành 1.650.000 đ/tấn"',
  '• Sửa khối lượng: "sửa khối lượng dòng 3 thành 2*3,5*0,3"',
  '• Tạo hạng mục: "tạo hạng mục phần móng"',
  '• "tính lại", "xuất excel", "nhập file", "hoàn tác"',
].join('\n');

function unitCompatible(queryUnit: string, normUnit: string): boolean {
  const q = normalizeUnit(queryUnit);
  const n = normalizeUnit(normUnit);
  return n === q || n === '100' + q || n === '1000' + q || n === '10' + q;
}

/** Quantity typed in base unit (m3) but norm measured in 100m3 → divide. */
function unitScale(queryUnit: string | undefined, normUnit: string): number {
  if (!queryUnit) return 1;
  const q = normalizeUnit(queryUnit);
  const m = /^(\d+)(.*)$/.exec(normalizeUnit(normUnit));
  if (m && m[2] === q) return 1 / Number(m[1]);
  return 1;
}

function matchCategories(cats: { id: number; name: string }[], name: string) {
  const n = normalizeText(name).replace(/^(hang muc|hm)\s+/, '');
  const exact = cats.filter((c) => normalizeText(c.name) === n);
  if (exact.length) return exact;
  return cats.filter((c) => {
    const cn = normalizeText(c.name);
    return cn.includes(n) || n.includes(cn);
  });
}

export class AssistantEngine {
  constructor(readonly provider: IntentProvider) {}

  /** Handle a user message; `pending` is the question the user is answering, if any. */
  async handle(text: string, ctx: AssistantContext, pending?: PendingField): Promise<Reply> {
    if (pending) {
      const merged = this.answerPending(pending, text);
      if (merged) return this.resolve(merged, ctx);
    }
    const intent = await this.provider.parse(text);
    return this.resolve(intent, ctx);
  }

  /** Fill the missing field of a pending intent from a free-text answer; null if it doesn't fit. */
  answerPending(p: PendingField, text: string): Intent | null {
    const t = text.trim();
    if (!t) return null;
    const intent = { ...p.intent } as Record<string, unknown>;
    switch (p.field) {
      case 'quantity': {
        const n = parseVnNumber(t.replace(/\s*(100m3|100m2|m3|m2|m³|m²|md|m|tấn|tan|kg|cái|cai)$/i, ''));
        if (n !== null) intent.quantity = n;
        else if (isFormula(t)) {
          try {
            intent.quantity = evaluateFormula(t);
            intent.quantityFormula = t.replace(/\s+/g, '');
          } catch {
            return null;
          }
        } else return null;
        return intent as Intent;
      }
      case 'price': {
        const a = parseAmount(normalizeText(t));
        if (!a) return null;
        intent.price = a.value;
        if (a.perUnit) intent.priceUnit = a.perUnit;
        return intent as Intent;
      }
      case 'categoryName':
        intent.categoryName = t;
        return intent as Intent;
      case 'name':
        intent.name = t;
        return intent as Intent;
      case 'normQuery':
        intent.normQuery = t;
        delete intent.normCode;
        return intent as Intent;
    }
    return null;
  }

  resolve(intent: Intent, ctx: AssistantContext): Reply {
    switch (intent.kind) {
      case 'addItem':
        return this.resolveAdd(intent, ctx);
      case 'searchNorm':
        return this.resolveSearch(intent.query, ctx);
      case 'setPrice':
        return this.resolveSetPrice(intent, ctx);
      case 'updateQuantity':
        return this.resolveUpdateQuantity(intent, ctx);
      case 'createCategory':
        return this.resolveCreateCategory(intent, ctx);
      case 'recalc':
        return { type: 'command', command: 'recalc', text: 'Đã tính lại toàn bộ dự toán.' };
      case 'exportExcel':
        return { type: 'command', command: 'exportExcel', text: 'Đang xuất file Excel dự toán…' };
      case 'importFile':
        return { type: 'command', command: 'importFile', text: 'Mở bảng nhập dữ liệu (từ máy tính hoặc Google Drive).' };
      case 'undo':
        return { type: 'command', command: 'undo', text: 'Hoàn tác thao tác gần nhất.' };
      case 'help':
        return { type: 'message', text: HELP_TEXT };
      case 'unknown':
        return {
          type: 'message',
          text: `Tôi chưa hiểu yêu cầu "${intent.text}".\n\n${HELP_TEXT}`,
        };
    }
  }

  private resolveSearch(query: string, ctx: AssistantContext): Reply {
    if (!query) {
      return {
        type: 'question',
        text: 'Bạn muốn tìm định mức nào? Nhập mã hoặc tên công tác.',
        options: [],
        pending: { intent: { kind: 'addItem' }, field: 'normQuery' },
      };
    }
    const norms = ctx.searchNorms(query, 15);
    if (!norms.length) return { type: 'message', text: `Không tìm thấy định mức phù hợp với "${query}".` };
    return {
      type: 'message',
      text: `Tìm thấy ${norms.length} định mức phù hợp với "${query}". Bấm để thêm vào dự toán:`,
      table: { columns: ['Mã hiệu', 'Tên công tác', 'Đơn vị'], rows: norms.map((n) => [n.code, n.name, n.unit]) },
      options: norms.slice(0, MAX_OPTIONS).map((n) => ({
        label: `Thêm ${n.code}`,
        intent: { kind: 'addItem', normCode: n.code },
      })),
    };
  }

  private resolveAdd(intent: Extract<Intent, { kind: 'addItem' }>, ctx: AssistantContext): Reply {
    // 1. Norm
    let norm: Norm | undefined;
    if (intent.normCode) {
      norm = ctx.getNorm(intent.normCode);
      if (!norm) {
        const alt = ctx.searchNorms(intent.normCode, MAX_OPTIONS);
        return {
          type: 'question',
          text: `Không tìm thấy mã định mức ${intent.normCode}. Bạn chọn mã khác hoặc nhập tên công tác:`,
          options: alt.map((n) => ({ label: `${n.code} – ${n.name} (${n.unit})`, intent: { ...intent, normCode: n.code } })),
          pending: { intent: { ...intent, normCode: undefined }, field: 'normQuery' },
        };
      }
    } else if (intent.normQuery) {
      let found = ctx.searchNorms(intent.normQuery, 30);
      if (intent.unit) {
        const byUnit = found.filter((n) => unitCompatible(intent.unit!, n.unit));
        if (byUnit.length) found = byUnit;
      }
      if (found.length === 0) {
        return {
          type: 'question',
          text: `Không tìm thấy định mức phù hợp với "${intent.normQuery}". Bạn nhập lại mã hoặc tên công tác:`,
          options: [],
          pending: { intent, field: 'normQuery' },
        };
      }
      if (found.length > 1) {
        return {
          type: 'question',
          text: `Có ${found.length} định mức phù hợp với "${intent.normQuery}". Bạn chọn mã nào?`,
          options: found.slice(0, MAX_OPTIONS).map((n) => ({
            label: `${n.code} – ${n.name} (${n.unit})`,
            intent: { ...intent, normCode: n.code, normQuery: undefined },
          })),
        };
      }
      norm = found[0];
    } else {
      return {
        type: 'question',
        text: 'Bạn muốn thêm công tác nào? Nhập mã định mức hoặc tên công tác.',
        options: [],
        pending: { intent, field: 'normQuery' },
      };
    }
    const withNorm = { ...intent, normCode: norm.code, normQuery: undefined };

    // 2. Quantity
    if (withNorm.quantity === undefined) {
      return {
        type: 'question',
        text: `Khối lượng công tác ${norm.code} – ${norm.name} là bao nhiêu (${norm.unit})? Có thể nhập số hoặc công thức, ví dụ 2*3,5*0,3.`,
        options: [],
        pending: { intent: withNorm, field: 'quantity' },
      };
    }
    const scale = unitScale(withNorm.unit, norm.unit);
    const quantity = withNorm.quantity * scale;

    // 3. Category
    const cats = ctx.listCategories();
    let categoryId = withNorm.categoryId;
    let newCategoryName: string | undefined;
    if (!categoryId) {
      if (withNorm.categoryName) {
        const matches = matchCategories(cats, withNorm.categoryName);
        if (matches.length === 1) categoryId = matches[0].id;
        else if (matches.length > 1) {
          return {
            type: 'question',
            text: `Có nhiều hạng mục khớp với "${withNorm.categoryName}". Bạn chọn hạng mục nào?`,
            options: matches.map((c) => ({ label: c.name, intent: { ...withNorm, categoryId: c.id } })),
          };
        } else if (withNorm.createCategory) {
          newCategoryName = withNorm.categoryName;
        } else {
          return {
            type: 'question',
            text: `Chưa có hạng mục "${withNorm.categoryName}". Tạo hạng mục mới hay chọn hạng mục có sẵn?`,
            options: [
              { label: `Tạo hạng mục mới «${withNorm.categoryName}»`, intent: { ...withNorm, createCategory: true } },
              ...cats.slice(0, MAX_OPTIONS - 1).map((c) => ({ label: c.name, intent: { ...withNorm, categoryId: c.id } })),
            ],
          };
        }
      } else if (cats.length === 1) {
        categoryId = cats[0].id;
      } else if (cats.length === 0) {
        return {
          type: 'question',
          text: 'Công trình chưa có hạng mục nào. Nhập tên hạng mục mới (hoặc chọn):',
          options: [
            { label: 'Tạo hạng mục «Hạng mục chung»', intent: { ...withNorm, categoryName: 'Hạng mục chung', createCategory: true } },
          ],
          pending: { intent: { ...withNorm, createCategory: true }, field: 'categoryName' },
        };
      } else {
        return {
          type: 'question',
          text: 'Thêm vào hạng mục nào?',
          options: cats.slice(0, MAX_OPTIONS).map((c) => ({ label: c.name, intent: { ...withNorm, categoryId: c.id } })),
        };
      }
    }
    const catLabel = newCategoryName ? `hạng mục mới «${newCategoryName}»` : `«${cats.find((c) => c.id === categoryId)?.name ?? ''}»`;
    const scaleNote =
      scale !== 1 ? ` (quy đổi từ ${fmt(withNorm.quantity)} ${withNorm.unit} theo đơn vị định mức ${norm.unit})` : '';
    return {
      type: 'preview',
      text: `Tôi sẽ thêm: ${norm.code} – ${norm.name} — ${fmt(quantity)} ${norm.unit}${scaleNote} vào ${catLabel}. Xác nhận?`,
      action: {
        tool: 'addItem',
        params: {
          normCode: norm.code,
          quantity,
          quantityFormula: withNorm.quantityFormula,
          ...(categoryId ? { categoryId } : { newCategoryName }),
        },
      },
    };
  }

  private resolveSetPrice(intent: Extract<Intent, { kind: 'setPrice' }>, ctx: AssistantContext): Reply {
    let res = intent.resourceCode ? ctx.getResource(intent.resourceCode) : undefined;
    if (!res) {
      const q = intent.resourceQuery ?? intent.resourceCode;
      if (!q) {
        return { type: 'message', text: 'Bạn muốn đổi giá vật tư nào? Ví dụ: "đổi giá xi măng PCB40 thành 1.650.000 đ/tấn".' };
      }
      const found = ctx.searchResources(q, 20);
      if (!found.length) return { type: 'message', text: `Không tìm thấy vật tư/nhân công/máy phù hợp với "${q}".` };
      if (found.length > 1) {
        return {
          type: 'question',
          text: `Có ${found.length} tài nguyên phù hợp với "${q}". Bạn muốn đổi giá loại nào?`,
          options: found.slice(0, MAX_OPTIONS).map((r) => ({
            label: `${r.code} – ${r.name} (${r.unit}) – giá hiện tại ${fmt(r.price)} đ`,
            intent: { ...intent, resourceCode: r.code, resourceQuery: undefined },
          })),
        };
      }
      res = found[0];
    }
    const withRes = { ...intent, resourceCode: res.code, resourceQuery: undefined };
    if (withRes.price === undefined) {
      return {
        type: 'question',
        text: `Giá mới của ${res.name} là bao nhiêu (đ/${res.unit})?`,
        options: [],
        pending: { intent: withRes, field: 'price' },
      };
    }
    let price = withRes.price;
    let note = '';
    if (withRes.priceUnit && normalizeUnit(withRes.priceUnit) !== normalizeUnit(res.unit)) {
      const converted = convertPrice(price, withRes.priceUnit, res.unit);
      if (converted === null) {
        return {
          type: 'question',
          text: `Đơn vị giá bạn nhập (đ/${withRes.priceUnit}) khác đơn vị của ${res.name} (${res.unit}) và không quy đổi được. Áp dụng ${fmt(price)} đ/${res.unit}?`,
          options: [
            { label: `Có, ${fmt(price)} đ/${res.unit}`, intent: { ...withRes, priceUnit: undefined } },
          ],
          pending: { intent: { ...withRes, priceUnit: undefined }, field: 'price' },
        };
      }
      note = ` (quy đổi từ ${fmt(price)} đ/${withRes.priceUnit})`;
      price = converted;
    }
    return {
      type: 'preview',
      text: `Đổi giá ${res.code} – ${res.name}: ${fmt(res.price)} → ${fmt(price)} đ/${res.unit}${note}. Xác nhận?`,
      action: { tool: 'setPrice', params: { resourceCode: res.code, price } },
    };
  }

  private resolveUpdateQuantity(intent: Extract<Intent, { kind: 'updateQuantity' }>, ctx: AssistantContext): Reply {
    const items = ctx.listItems();
    let matches: ContextItem[];
    if (intent.itemId) matches = items.filter((i) => i.id === intent.itemId);
    else if (intent.line) matches = items.filter((i) => i.line === intent.line);
    else if (intent.normCode) matches = items.filter((i) => i.normCode.toUpperCase() === intent.normCode);
    else if (intent.query) {
      const q = normalizeText(intent.query);
      const words = q.split(' ');
      matches = items.filter((i) => {
        const name = normalizeText(i.name + ' ' + i.normCode);
        return words.every((w) => name.includes(w));
      });
    } else matches = [];

    if (!matches.length) return { type: 'message', text: 'Không tìm thấy công tác cần sửa khối lượng trong dự toán.' };
    if (matches.length > 1) {
      return {
        type: 'question',
        text: 'Có nhiều công tác phù hợp. Bạn muốn sửa dòng nào?',
        options: matches.slice(0, MAX_OPTIONS).map((i) => ({
          label: `Dòng ${i.line}: ${i.normCode} – ${i.name} (${i.categoryName}) – KL ${fmt(i.quantity)} ${i.unit}`,
          intent: { ...intent, itemId: i.id },
        })),
      };
    }
    const item = matches[0];
    let quantity = intent.quantity;
    if (quantity === undefined && intent.quantityFormula) {
      try {
        quantity = evaluateFormula(intent.quantityFormula);
      } catch (e) {
        return { type: 'message', text: `Công thức khối lượng không hợp lệ: ${(e as Error).message}` };
      }
    }
    if (quantity === undefined) {
      return {
        type: 'question',
        text: `Khối lượng mới của dòng ${item.line} (${item.normCode} – ${item.name}) là bao nhiêu (${item.unit})?`,
        options: [],
        pending: { intent: { ...intent, itemId: item.id }, field: 'quantity' },
      };
    }
    const formulaNote = intent.quantityFormula ? ` (= ${intent.quantityFormula})` : '';
    return {
      type: 'preview',
      text: `Sửa khối lượng dòng ${item.line}: ${item.normCode} – ${item.name}: ${fmt(item.quantity)} → ${fmt(quantity)} ${item.unit}${formulaNote}. Xác nhận?`,
      action: { tool: 'updateQuantity', params: { itemId: item.id, quantity, quantityFormula: intent.quantityFormula } },
    };
  }

  private resolveCreateCategory(intent: Extract<Intent, { kind: 'createCategory' }>, ctx: AssistantContext): Reply {
    const name = intent.name?.trim();
    if (!name) {
      return { type: 'question', text: 'Tên hạng mục mới là gì?', options: [], pending: { intent, field: 'name' } };
    }
    const existing = ctx.listCategories().find((c) => normalizeText(c.name) === normalizeText(name));
    if (existing) return { type: 'message', text: `Hạng mục «${existing.name}» đã tồn tại.` };
    return {
      type: 'preview',
      text: `Tôi sẽ tạo hạng mục mới «${name}». Xác nhận?`,
      action: { tool: 'createCategory', params: { name } },
    };
  }
}

export type { ReplyOption };

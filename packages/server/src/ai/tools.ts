import { convertPrice, evaluateFormula, formatNumber, isFormula, normalizeText, unitFactor, type Action, type AssistantContext } from '@dutoan/core';
import type { LegalService } from '../legal.js';
import type { PriceBookService } from '../pricebooks.js';
import type { RegionalUpdateService, RegionalUpdateRequest } from '../regional-update.js';
import type { Repo } from '../repo.js';
import type { ToolSpec } from './types.js';

export interface ToolEnv {
  repo: Repo;
  projectId: number;
  ctx: AssistantContext;
  regional: RegionalUpdateService;
  priceBooks: PriceBookService;
  legal: LegalService;
  /** Best code assignments for items without a code (server implementation of the auto-assign plan). */
  autoAssign: (threshold: number) => { assign: { itemId: number; line: number; name: string; normCode: string; normName: string; confidence: number }[]; below: number };
  /** Analysis summary of an uploaded workbook (import mapping help). */
  analyzeFile?: (fileId: string) => unknown;
}

export interface ToolResult {
  /** JSON-serialisable result fed back to the model. */
  data: unknown;
  /** Write tools: the PREVIEW shown to the user (nothing is applied until they confirm). */
  preview?: { text: string; action: Action };
  /** UI command to run (open a dialog). */
  command?: 'importFile' | 'regionalUpdate';
}

const fmt = (n: number) => formatNumber(n, n % 1 === 0 ? 0 : 3);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim());
const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec['parameters'] => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const S = { type: 'string' };
const N = { type: 'number' };

export const TOOL_SPECS: ToolSpec[] = [
  // ------------------------------------------------------------------ read-only
  { name: 'search_norms', readOnly: true, description: 'Tìm định mức TT 38/2026 theo mã (AF.11110, AF.1) hoặc theo tên công tác tiếng Việt.', parameters: obj({ query: S, limit: N }, ['query']) },
  {
    name: 'suggest_codes',
    readOnly: true,
    description: 'Gợi ý mã định mức cho một mô tả công việc (và đơn vị): trả về tối đa 5 mã kèm độ tin cậy và lý do. Dùng khi người dùng chưa có mã.',
    parameters: obj({ description: S, unit: S }, ['description']),
  },
  { name: 'get_norm', readOnly: true, description: 'Chi tiết một định mức: tên, đơn vị, trang nguồn, trạng thái đối chiếu và các thành phần hao phí (VL/NC/M).', parameters: obj({ code: S }, ['code']) },
  { name: 'list_items', readOnly: true, description: 'Danh sách công việc hiện có của dự toán (STT/line, mã, tên, đơn vị, khối lượng, hạng mục).', parameters: obj({}) },
  { name: 'get_cost_summary', readOnly: true, description: 'Bảng tổng hợp chi phí xây dựng của công trình (trực tiếp, chi phí chung, thu nhập chịu thuế, GXD…), bộ pháp lý đang áp dụng và cảnh báo.', parameters: obj({}) },
  { name: 'search_resources', readOnly: true, description: 'Tìm vật liệu / nhân công / máy trong thư viện kèm đơn giá hiện dùng của công trình.', parameters: obj({ query: S }, ['query']) },
  { name: 'list_price_books', readOnly: true, description: 'Danh sách bộ đơn giá đã có (tỉnh/thành, kỳ giá, loại, số dòng giá, trạng thái xác minh), có thể lọc theo tỉnh/thành.', parameters: obj({ region: S }) },
  {
    name: 'explain_rules',
    readOnly: true,
    description: 'Giải thích bộ căn cứ pháp lý của công trình (TT 36/2026, TT 38/2026, TT 11/2021…): văn bản, hiệu lực và các bảng tỷ lệ; có thể hỏi một bảng theo số (vd "3.3") hoặc từ khóa (vd "chi phí chung").',
    parameters: obj({ topic: S }),
  },
  { name: 'import_mapping_help', readOnly: true, description: 'Hướng dẫn nhập file Excel (chọn cột, loại dòng, đơn giá, mã hiệu). Nếu có fileId của file đã tải lên thì tóm tắt kết quả nhận diện cột và cảnh báo.', parameters: obj({ fileId: S }) },
  // ------------------------------------------------------------------ write tools (preview only)
  {
    name: 'add_item',
    readOnly: false,
    description:
      'Chuẩn bị BẢN XEM TRƯỚC thêm một công tác vào dự toán. Cho normCode nếu người dùng đưa mã, nếu không cho normQuery (mô tả công tác). quantity theo đơn vị người dùng nói (unit); categoryName là tên hạng mục.',
    parameters: obj({ normCode: S, normQuery: S, quantity: N, quantityFormula: S, unit: S, categoryName: S }),
  },
  { name: 'update_quantity', readOnly: false, description: 'Chuẩn bị BẢN XEM TRƯỚC sửa khối lượng một dòng (theo line/STT, itemId, mã hoặc tên).', parameters: obj({ line: N, itemId: N, normCode: S, query: S, quantity: N, quantityFormula: S }) },
  { name: 'set_price', readOnly: false, description: 'Chuẩn bị BẢN XEM TRƯỚC đặt đơn giá nhập tay của một tài nguyên cho công trình. priceUnit là đơn vị của giá (vd "tấn" cho đ/tấn).', parameters: obj({ resourceCode: S, resourceQuery: S, price: N, priceUnit: S }, ['price']) },
  { name: 'create_category', readOnly: false, description: 'Chuẩn bị BẢN XEM TRƯỚC tạo hạng mục mới.', parameters: obj({ name: S }, ['name']) },
  { name: 'auto_assign_codes', readOnly: false, description: 'Chuẩn bị BẢN XEM TRƯỚC gắn mã định mức tự động cho các công việc chưa có mã (ngưỡng tin cậy 0–1, mặc định 0,8).', parameters: obj({ threshold: N }) },
  {
    name: 'regional_update',
    readOnly: false,
    description:
      'Xem trước "Cập nhật định mức & đơn giá theo khu vực": chọn bộ giá mới nhất của tỉnh/thành, so sánh giá cũ/mới và chênh lệch GXD. Trả về tóm tắt để bạn giải thích; nếu có thay đổi sẽ tạo bản xem trước để người dùng bấm Áp dụng (phiên bản hoàn tác được).',
    parameters: obj({ region: S, subArea: S, types: { type: 'array', items: { type: 'string', enum: ['VL', 'NC', 'M'] } }, remapCodes: { type: 'boolean' } }, ['region']),
  },
  { name: 'apply_price_book', readOnly: false, description: 'Chuẩn bị BẢN XEM TRƯỚC dùng một bộ đơn giá cụ thể (theo bookId từ list_price_books) cho công trình.', parameters: obj({ bookId: N }, ['bookId']) },
  { name: 'open_import_panel', readOnly: false, description: 'Mở hộp thoại nhập dữ liệu / file Excel để người dùng chọn file và cột.', parameters: obj({}) },
  { name: 'open_regional_update_dialog', readOnly: false, description: 'Mở hộp thoại "Cập nhật định mức & đơn giá theo khu vực".', parameters: obj({}) },
];

const IMPORT_GUIDE = [
  '1. Mở công trình → “⤓ Nhập dữ liệu” → chọn “Dự toán / BOQ có sẵn” → chọn file Excel → “Đọc file”.',
  '2. Kiểm tra vùng dữ liệu (dòng tiêu đề, số dòng tiêu đề 1–2, dòng dữ liệu đầu/cuối).',
  '3. Mỗi trường (Mã hiệu, Hạng mục công việc, Đơn vị, Khối lượng, Đơn giá VL/NC/M, Thành tiền, Ghi chú…) có ô “Lấy cột này” và danh sách các cột – có thể đổi hoặc bỏ. Cột chủ yếu là số không được dùng làm tên công việc.',
  '4. Chọn đơn giá: giữ nguyên đơn giá trong file, hoặc tính lại theo định mức & bộ giá của công trình.',
  '5. Xem “15 dòng đầu như sẽ hiện trong lưới”, bảng đối chiếu độ khớp (✔/⚠) và mã đề xuất; sai thì dùng “Sửa lại cột đã nhập” (⚙ ở hạng mục) – hoàn tác được.',
].join('\n');

/** Tools bound to one project. `run` never throws: a failure is returned to the model as `{ error }`. */
export function buildTools(env: ToolEnv) {
  const { repo, projectId, ctx } = env;
  const dataset = repo.datasetOf(projectId);
  const index = repo.normIndex(dataset);

  const items = () => ctx.listItems();
  const findItem = (a: Record<string, unknown>) => {
    const list = items();
    const id = num(a.itemId);
    if (id !== undefined) return list.find((i) => i.id === id);
    const line = num(a.line);
    if (line !== undefined) return list.find((i) => i.line === line);
    const code = str(a.normCode).toUpperCase();
    if (code) return list.filter((i) => i.normCode.toUpperCase() === code).length === 1 ? list.find((i) => i.normCode.toUpperCase() === code) : undefined;
    const q = normalizeText(str(a.query));
    if (q) {
      const hits = list.filter((i) => normalizeText(i.name).includes(q));
      return hits.length === 1 ? hits[0] : undefined;
    }
    return undefined;
  };

  const regionalPreview = (req: RegionalUpdateRequest): ToolResult => {
    const pv = env.regional.preview(projectId, req);
    const d = pv.totals.delta;
    const summary = {
      region: pv.region,
      subArea: pv.subArea,
      canApply: pv.canApply,
      books: pv.books.map((b) => ({ id: b.id, title: b.title, type: b.type, status: b.verificationStatus })),
      resourcesChanged: pv.resources.length,
      topResourceChanges: pv.resources.slice(0, 8).map((r) => ({ name: r.name, unit: r.unit, oldPrice: r.oldPrice, newPrice: r.newPrice, source: r.newSource })),
      unpricedResources: pv.unpriced.length,
      itemsAffected: pv.items.length,
      totalDelta: { direct: d.direct, gxdtt: d.gxdtt, gxd: d.gxd },
      totals: pv.totals.after,
      remapProposals: pv.remap.length,
      warnings: pv.warnings,
    };
    if (!pv.canApply || (pv.resources.length === 0 && pv.remap.length === 0)) return { data: { ...summary, note: 'Không có thay đổi nào để áp dụng.' } };
    const action: Action = { tool: 'regionalUpdate', params: { region: req.region, subArea: req.subArea ?? null, auto: req.auto !== false, types: req.types, bookIds: req.bookIds, remapCodes: req.remapCodes } };
    const sign = d.gxd > 0 ? '+' : '';
    const text = `Cập nhật đơn giá theo khu vực ${req.region}${req.subArea ? ` – ${req.subArea}` : ''}: ${pv.resources.length} tài nguyên đổi giá, GXD ${sign}${fmt(Math.round(d.gxd))} đ (từ ${fmt(Math.round(pv.totals.before.gxd))} → ${fmt(Math.round(pv.totals.after.gxd))}). Áp dụng sẽ tạo phiên bản mới, hoàn tác được.`;
    return { data: summary, preview: { text, action } };
  };

  const handlers: Record<string, (a: Record<string, unknown>) => ToolResult> = {
    search_norms: (a) => {
      const q = str(a.query);
      if (!q) return { data: { error: 'Thiếu từ khóa tìm kiếm' } };
      return { data: repo.searchNorms(q, dataset, Math.min(num(a.limit) ?? 10, 20)).map((n) => ({ code: n.code, name: n.name, unit: n.unit })) };
    },
    suggest_codes: (a) => {
      const d = str(a.description);
      if (!d) return { data: { error: 'Thiếu mô tả công việc' } };
      const list = index.suggest(d, str(a.unit) || null, 5);
      return { data: { dataset, suggestions: list.map((s) => ({ code: s.norm.code, name: s.norm.name, unit: s.norm.unit, confidence: s.confidence, why: s.why, unitFactor: s.unitFactor })) } };
    },
    get_norm: (a) => {
      const code = str(a.code).toUpperCase();
      const n = repo.getNorm(code, dataset);
      if (!n) return { data: { error: `Không có mã ${code} trong bộ ${dataset}` } };
      return {
        data: {
          code: n.code,
          name: n.name,
          unit: n.unit,
          appendix: n.appendix,
          page: n.page,
          status: n.status,
          resources: repo.getNormResources(n.code, dataset).map((r) => ({ type: r.type, name: r.name, unit: r.unit, consumption: r.consumption, percentOf: r.pctBase ?? undefined })),
        },
      };
    },
    list_items: () => ({ data: items().slice(0, 300) }),
    get_cost_summary: () => {
      const c = repo.calculate(projectId);
      return {
        data: {
          project: { name: c.project.name, region: c.project.region, priceDate: c.project.priceDate, status: c.project.status },
          legalSet: c.legalSet.label,
          direct: c.total,
          lines: c.costSummary.lines.map((l) => ({ code: l.code, name: l.name, formula: l.formula, value: Math.round(l.value) })),
          totalEstimate: Math.round(c.totalEstimate.total),
          warnings: c.warnings,
        },
      };
    },
    search_resources: (a) => ({ data: ctx.searchResources(str(a.query), 10).map((r) => ({ code: r.code, name: r.name, unit: r.unit, type: r.type, price: r.price })) }),
    list_price_books: (a) => {
      const region = normalizeText(str(a.region));
      return {
        data: env.priceBooks
          .list()
          .filter((b) => !region || normalizeText(b.region) === region)
          .map((b) => ({ id: b.id, title: b.title, region: b.region, subArea: b.subArea, type: b.bookType, periodStart: b.periodStart, rows: b.rowCount, verification: b.verificationStatus })),
      };
    },
    explain_rules: (a) => {
      const set = env.legal.get(repo.getProject(projectId)!.legalSet);
      const topic = normalizeText(str(a.topic));
      const tables = Object.values(set.tables);
      const hit = topic ? tables.filter((t) => t.id === str(a.topic) || normalizeText(`${t.title} ${t.source}`).includes(topic)) : [];
      return {
        data: {
          legalSet: set.label,
          status: set.status,
          effectiveFrom: set.effectiveFrom,
          effectiveTo: set.effectiveTo,
          normDataset: set.normDataset,
          documents: set.documents,
          note: set.note.slice(0, 1200),
          tables: tables.map((t) => ({ id: t.id, title: t.title, status: t.status, basis: t.basis })),
          detail: hit.slice(0, 2).map((t) => ({ id: t.id, title: t.title, source: t.source, basis: t.basis, brackets: t.bracketLabels, rows: t.rows.slice(0, 12).map((r) => ({ key: r.label, values: r.values })) })),
        },
      };
    },
    import_mapping_help: (a) => {
      const fileId = str(a.fileId);
      let analysis: unknown;
      if (fileId && env.analyzeFile) {
        try {
          analysis = env.analyzeFile(fileId);
        } catch (e) {
          analysis = { error: (e as Error).message };
        }
      }
      return { data: { guide: IMPORT_GUIDE, analysis } };
    },
    add_item: (a) => {
      let norm = str(a.normCode) ? repo.getNorm(str(a.normCode).toUpperCase(), dataset) : undefined;
      if (str(a.normCode) && !norm) return { data: { error: `Mã ${str(a.normCode)} không có trong bộ ${dataset}. Hãy dùng suggest_codes để tìm mã đúng.` } };
      if (!norm) {
        const q = str(a.normQuery);
        if (!q) return { data: { error: 'Cần normCode hoặc normQuery' } };
        const cands = index.suggest(q, str(a.unit) || null, 4);
        if (!cands.length) return { data: { error: 'Không tìm thấy định mức phù hợp' } };
        if (cands[0].confidence < 0.7) {
          return { data: { needChoice: true, message: 'Chưa đủ chắc chắn – hãy hỏi người dùng chọn một mã (hoặc bổ sung thông số).', candidates: cands.map((s) => ({ code: s.norm.code, name: s.norm.name, unit: s.norm.unit, confidence: s.confidence })) } };
        }
        norm = cands[0].norm;
      }
      let quantity = num(a.quantity);
      let formula: string | undefined;
      if (quantity === undefined && str(a.quantityFormula) && isFormula(str(a.quantityFormula))) {
        try {
          quantity = evaluateFormula(str(a.quantityFormula));
          formula = str(a.quantityFormula).replace(/\s+/g, '');
        } catch {
          return { data: { error: 'Công thức khối lượng không hợp lệ' } };
        }
      }
      if (quantity === undefined) return { data: { error: 'Thiếu khối lượng' } };
      const unit = str(a.unit);
      if (unit) {
        const f = unitFactor(unit, norm.unit);
        if (f === null) return { data: { error: `Đơn vị ${unit} không tương thích với đơn vị định mức ${norm.unit}` } };
        quantity = quantity * f;
        formula = undefined;
      }
      const cats = ctx.listCategories();
      const wanted = normalizeText(str(a.categoryName)).replace(/^(hang muc|hm)\s+/, '');
      let categoryId: number | undefined;
      let newCategoryName: string | undefined;
      let catLabel = '';
      if (wanted) {
        const c = cats.find((x) => normalizeText(x.name) === wanted) ?? cats.find((x) => normalizeText(x.name).includes(wanted) || wanted.includes(normalizeText(x.name)));
        if (c) {
          categoryId = c.id;
          catLabel = c.name;
        } else {
          newCategoryName = str(a.categoryName);
          catLabel = `${newCategoryName} (tạo mới)`;
        }
      } else if (cats.length === 1) {
        categoryId = cats[0].id;
        catLabel = cats[0].name;
      } else if (cats.length > 1) return { data: { needChoice: true, message: 'Có nhiều hạng mục – hỏi người dùng thêm vào hạng mục nào.', categories: cats.map((c) => c.name) } };
      else {
        newCategoryName = 'Hạng mục chung';
        catLabel = 'Hạng mục chung (tạo mới)';
      }
      const action: Action = { tool: 'addItem', params: { categoryId, newCategoryName, normCode: norm.code, quantity, quantityFormula: formula } };
      return { data: { ok: true, prepared: `${norm.code} – ${norm.name}`, quantity, unit: norm.unit, category: catLabel }, preview: { text: `Thêm vào «${catLabel}»: ${norm.code} – ${norm.name}, khối lượng ${fmt(quantity)} ${norm.unit}.`, action } };
    },
    update_quantity: (a) => {
      const it = findItem(a);
      if (!it) return { data: { error: 'Không xác định được đúng một dòng – dùng list_items rồi chỉ rõ line hoặc itemId.' } };
      let quantity = num(a.quantity);
      let formula: string | undefined;
      if (quantity === undefined && str(a.quantityFormula)) {
        try {
          quantity = evaluateFormula(str(a.quantityFormula));
          formula = str(a.quantityFormula).replace(/\s+/g, '');
        } catch {
          return { data: { error: 'Công thức khối lượng không hợp lệ' } };
        }
      }
      if (quantity === undefined) return { data: { error: 'Thiếu khối lượng mới' } };
      return {
        data: { ok: true, line: it.line, name: it.name, from: it.quantity, to: quantity },
        preview: { text: `Sửa khối lượng dòng ${it.line} «${it.name}» từ ${fmt(it.quantity)} thành ${fmt(quantity)} ${it.unit}.`, action: { tool: 'updateQuantity', params: { itemId: it.id, quantity, quantityFormula: formula } } },
      };
    },
    set_price: (a) => {
      const price = num(a.price);
      if (price === undefined || price < 0) return { data: { error: 'Giá không hợp lệ' } };
      const res = str(a.resourceCode) ? ctx.getResource(str(a.resourceCode).toUpperCase()) : ctx.searchResources(str(a.resourceQuery), 3)[0];
      if (!res) return { data: { error: 'Không tìm thấy tài nguyên – dùng search_resources' } };
      let p = price;
      if (str(a.priceUnit)) {
        const c = convertPrice(price, str(a.priceUnit), res.unit);
        if (c === null) return { data: { error: `Không quy đổi được giá từ đơn vị ${str(a.priceUnit)} sang ${res.unit}` } };
        p = c;
      }
      return {
        data: { ok: true, resource: res.name, unit: res.unit, from: res.price, to: p },
        preview: { text: `Đặt giá «${res.name}» của công trình từ ${fmt(res.price)} thành ${fmt(p)} đ/${res.unit}.`, action: { tool: 'setPrice', params: { resourceCode: res.code, price: p } } },
      };
    },
    create_category: (a) => {
      const name = str(a.name);
      if (!name) return { data: { error: 'Thiếu tên hạng mục' } };
      return { data: { ok: true, name }, preview: { text: `Tạo hạng mục «${name}».`, action: { tool: 'createCategory', params: { name } } } };
    },
    auto_assign_codes: (a) => {
      const t = num(a.threshold) ?? 0.8;
      const plan = env.autoAssign(Math.min(Math.max(t, 0), 1));
      if (!plan.assign.length) return { data: { ok: true, message: 'Không có công việc nào đạt ngưỡng.', below: plan.below } };
      return {
        data: { ok: true, count: plan.assign.length, below: plan.below, sample: plan.assign.slice(0, 8).map((x) => ({ line: x.line, name: x.name, normCode: x.normCode, confidence: x.confidence })) },
        preview: {
          text: `Gắn mã tự động cho ${plan.assign.length} công việc (ngưỡng ${Math.round(t * 100)}%; ${plan.below} công việc dưới ngưỡng giữ nguyên). Mã gắn tự động phải được xác nhận trước khi duyệt dự toán.`,
          action: { tool: 'autoAssignCodes', params: { assignments: plan.assign.map((x) => ({ itemId: x.itemId, normCode: x.normCode, confidence: x.confidence })) } },
        },
      };
    },
    regional_update: (a) => {
      const region = str(a.region);
      if (!region) return { data: { error: 'Thiếu tỉnh/thành' } };
      const types = Array.isArray(a.types) ? (a.types.filter((t) => ['VL', 'NC', 'M'].includes(String(t))) as ('VL' | 'NC' | 'M')[]) : undefined;
      return regionalPreview({ region, subArea: str(a.subArea) || null, auto: true, types, remapCodes: a.remapCodes === true });
    },
    apply_price_book: (a) => {
      const id = num(a.bookId);
      const b = id === undefined ? undefined : env.priceBooks.list().find((x) => x.id === id);
      if (!b) return { data: { error: 'Không tìm thấy bộ giá – dùng list_price_books' } };
      if (b.rowCount === 0) return { data: { error: `Bộ "${b.title}" chưa có dòng giá nào (chỉ có thông tin văn bản) nên không dùng được.` } };
      return regionalPreview({ region: b.region, subArea: b.subArea ?? null, auto: false, bookIds: [b.id], types: b.bookType === 'TH' ? undefined : [b.bookType] });
    },
    open_import_panel: () => ({ data: { ok: true, message: 'Đã mở hộp thoại nhập dữ liệu.' }, command: 'importFile' }),
    open_regional_update_dialog: () => ({ data: { ok: true, message: 'Đã mở hộp thoại cập nhật theo khu vực.' }, command: 'regionalUpdate' }),
  };

  return {
    specs: TOOL_SPECS,
    run(name: string, args: Record<string, unknown>): ToolResult {
      const h = handlers[name];
      if (!h) return { data: { error: `Không có công cụ "${name}"` } };
      if ('__invalidJson' in args) return { data: { error: 'Tham số công cụ không phải JSON hợp lệ' } };
      try {
        return h(args);
      } catch (e) {
        return { data: { error: (e as Error).message } };
      }
    },
  };
}

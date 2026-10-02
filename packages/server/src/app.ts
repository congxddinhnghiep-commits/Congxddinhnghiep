import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import {
  computeQuantityLines,
  parseVariables,
  QuantityError,
  BUILDING_TYPE_LABELS,
  ELEMENT_DEFAULTS,
  ELEMENT_TYPE_LABELS,
  evaluateFormula,
  FormulaError,
  isFormula,
  TT36_WORK_CATEGORIES,
  type BuildingType,
  type ElementType,
  type ProjectCostSettings,
  type RowType,
} from '@dutoan/core';
import { TakeoffService } from './takeoff.js';
import { AiRegistry, type AiConfig, type ProviderFactory } from './ai/registry.js';
import { AssistantService, autoAssignPlan } from './assistant.js';
import { AuthService, requireAdmin, requirePasswordChanged } from './auth.js';
import { config, WEB_DIST } from './config.js';
import type { DB } from './db.js';
import { buildWorkbook } from './excel.js';
import { downloadDriveFile } from './gdrive.js';
import { applyImport, getParsed, parseAndStore, previewOf, type ImportTarget } from './importer.js';
import { analyze, importEstimate, listTemplates } from './estimate-import.js';
import { importInfoForCategory, reopenImport } from './import-sources.js';
import { analyzeSheets, importSheets, sheetOverview } from './import-multi.js';
import { RegionalUpdateService } from './regional-update.js';
import { PriceBookService, provinceMergers, regions, seedHcmJune2026PriceBook, seedPriceBookExample, seedTt38PriceBookAugust2026 } from './pricebooks.js';
import { validateProject } from './validation.js';
import { LegalService, legalDocuments } from './legal.js';
import { HttpError, Repo } from './repo.js';

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
/** Wrap a handler: JSON-serialise the return value and forward errors. */
const h =
  (fn: Handler) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (e) {
      next(e);
    }
  };

const id = (v: string | undefined) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Mã không hợp lệ');
  return n;
};

const BUILDING_TYPES = Object.keys(BUILDING_TYPE_LABELS) as BuildingType[];

/** Parse quantity input: either a number or a "diễn giải" formula. */
function quantityFromBody(body: { quantity?: unknown; quantityFormula?: unknown }): { quantity?: number; quantityFormula?: string | null } {
  const out: { quantity?: number; quantityFormula?: string | null } = {};
  if (typeof body.quantityFormula === 'string') {
    const f = body.quantityFormula.trim();
    if (!f) out.quantityFormula = null;
    else {
      try {
        out.quantity = evaluateFormula(f);
        out.quantityFormula = isFormula(f) ? f : null;
      } catch (e) {
        throw new HttpError(400, `Diễn giải khối lượng không hợp lệ: ${(e as FormulaError).message}`);
      }
    }
  }
  if (body.quantity !== undefined && out.quantity === undefined) {
    const q = Number(body.quantity);
    if (!Number.isFinite(q)) throw new HttpError(400, 'Khối lượng không hợp lệ');
    out.quantity = q;
    if (body.quantityFormula === undefined) out.quantityFormula = null;
  }
  return out;
}

export function createApp(db: DB, opts: { serveWeb?: boolean; ai?: { cfg?: AiConfig; factory?: ProviderFactory } } = {}) {
  const legal = new LegalService(db);
  const repo = new Repo(db, legal);
  const auth = new AuthService(db, config.jwtSecret, config.jwtExpiresIn);
  const priceBooks = new PriceBookService(db, repo);
  repo.priceResolver = (pid) => priceBooks.resolve(pid);
  const regional = new RegionalUpdateService(db, repo, priceBooks);
  const takeoff = new TakeoffService(db, repo);
  const aiRegistry = new AiRegistry(db, opts.ai?.cfg, opts.ai?.factory);
  const assistant = new AssistantService(repo, aiRegistry, {
    regional,
    priceBooks,
    legal,
    analyzeFile: (fileId, userId, projectId) => {
      const a = analyze(db, repo, getParsed(fileId, userId), { kind: 'estimate', projectId, pricingOption: 'file' });
      return {
        fileName: a.fileName,
        sheets: a.sheets.map((x) => ({ name: x.name, kind: x.kindLabel, rows: x.rowCount })),
        header: a.header ? { headerRow: a.header.headerRow + 1, headerRows: a.header.headerRows, mapping: a.header.mapping } : null,
        counts: 'counts' in a ? a.counts : {},
        columnWarnings: 'columnWarnings' in a ? a.columnWarnings : [],
        detectionNotes: 'detectionNotes' in a ? a.detectionNotes : [],
        warnings: a.warnings,
      };
    },
  });
  seedPriceBookExample(db);
  seedTt38PriceBookAugust2026(db);
  seedHcmJune2026PriceBook(db);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' }));

  const api = express.Router();

  // ---------------------------------------------------------------- public
  api.post(
    '/auth/login',
    h((req) => {
      const { username, password } = req.body ?? {};
      if (!username || !password) throw new HttpError(400, 'Nhập tên đăng nhập và mật khẩu');
      return auth.login(String(username), String(password));
    }),
  );
  api.get('/health', h(() => ({ ok: true })));

  // ---------------------------------------------------------------- authenticated
  api.use(auth.middleware);
  api.get('/auth/me', h((req) => req.user));
  api.post(
    '/auth/change-password',
    h((req) => {
      const user = auth.changePassword(req.user!.id, String(req.body?.oldPassword ?? ''), String(req.body?.newPassword ?? ''));
      return { user, token: auth.sign(user) };
    }),
  );
  api.use(requirePasswordChanged);

  api.get(
    '/config',
    h(() => ({
      localMode: config.localMode,
      assistantProvider: assistant.providerName,
      assistantLabel: aiRegistry.status().activeLabel,
      assistantModel: aiRegistry.status().activeModel,
      sampleData: repo.hasSampleData(),
      googleDrive: {
        configured: !!(config.google.clientId && config.google.apiKey),
        clientId: config.google.clientId,
        apiKey: config.google.apiKey,
        appId: config.google.appId,
      },
      buildingTypes: BUILDING_TYPE_LABELS,
      legalSets: legal.all(),
      tt36WorkCategories: TT36_WORK_CATEGORIES,
      regions: regions(),
    })),
  );

  // AI assistant settings – provider / model only; API keys live in the server environment and are never returned
  api.get('/ai/status', h(() => aiRegistry.status()));
  api.put(
    '/ai/settings',
    requireAdmin,
    h((req) => {
      try {
        aiRegistry.save({ provider: req.body?.provider, models: req.body?.models });
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      return aiRegistry.status();
    }),
  );
  api.post(
    '/ai/test',
    requireAdmin,
    h(async (req) => {
      const id = req.body?.provider;
      if (id !== 'openai' && id !== 'anthropic') throw new HttpError(400, 'Chọn ChatGPT hoặc Claude để kiểm tra kết nối');
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      try {
        return { ...(await aiRegistry.test(id, ctrl.signal)), status: aiRegistry.status() };
      } finally {
        clearTimeout(t);
      }
    }),
  );

  // legal-basis register
  api.get('/legal', h(() => ({ ...legalDocuments(), sets: legal.all() })));
  api.put(
    '/legal/:setId/tables/:tableId',
    requireAdmin,
    h((req) => {
      const setId = req.params.setId;
      if (!legal.isLegalSet(setId)) throw new HttpError(404, 'Không có bộ pháp lý này');
      const b = req.body ?? {};
      if (b.status !== undefined && b.status !== 'verified' && b.status !== 'provisional') throw new HttpError(400, 'Trạng thái không hợp lệ');
      if (b.interpolation !== undefined && b.interpolation !== 'none' && b.interpolation !== 'linear') throw new HttpError(400, 'Kiểu nội suy không hợp lệ');
      legal.setTableStatus(setId, String(req.params.tableId), { status: b.status, interpolation: b.interpolation }, req.user!.username);
      return legal.get(setId).tables[String(req.params.tableId)];
    }),
  );

  // users (admin)
  api.get('/users', requireAdmin, h(() => auth.listUsers()));
  api.post(
    '/users',
    requireAdmin,
    h((req) => {
      const b = req.body ?? {};
      return auth.createUser(String(b.username ?? '').trim(), String(b.password ?? ''), String(b.fullName ?? ''), b.role === 'admin' ? 'admin' : 'user');
    }),
  );

  // projects
  const proj = (req: Request) => repo.requireProject(id(req.params.id), req.user!.id, req.user!.role === 'admin');
  api.get('/projects', h((req) => repo.listProjects(req.user!.id, req.user!.role === 'admin')));
  const tmdt = (v: unknown): number | null => {
    if (v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'Chi phí XD trong TMĐT không hợp lệ (tỷ đồng)');
    return n || null;
  };
  const region = (v: unknown): string | null => {
    if (v === null || v === '') return null;
    const r = String(v);
    if (!regions().includes(r)) throw new HttpError(400, 'Tỉnh/thành không có trong danh sách');
    return r;
  };
  const checkDate = (d: unknown) => {
    if (d !== undefined && d !== null && d !== '' && !(typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))) {
      throw new HttpError(400, 'Ngày lập giá không hợp lệ (yyyy-mm-dd)');
    }
  };
  api.post(
    '/projects',
    h((req) => {
      const b = req.body ?? {};
      if (b.buildingType && !BUILDING_TYPES.includes(b.buildingType)) throw new HttpError(400, 'Loại công trình không hợp lệ');
      if (b.legalSet !== undefined && !legal.isLegalSet(b.legalSet)) throw new HttpError(400, 'Bộ pháp lý không hợp lệ');
      checkDate(b.priceDate);
      if (b.gxdttTmdt !== undefined) b.gxdttTmdt = tmdt(b.gxdttTmdt);
      if (b.region !== undefined) b.region = region(b.region);
      const p = repo.createProject(req.user!.id, b);
      repo.createCategory(p.id, 'Hạng mục chung');
      return p;
    }),
  );
  api.get('/projects/:id', h((req) => proj(req)));
  api.put(
    '/projects/:id',
    h((req) => {
      const p = proj(req);
      const b = req.body ?? {};
      if (b.buildingType && !BUILDING_TYPES.includes(b.buildingType)) throw new HttpError(400, 'Loại công trình không hợp lệ');
      if (b.vatRate !== undefined && !(Number(b.vatRate) >= 0 && Number(b.vatRate) <= 100)) throw new HttpError(400, 'Thuế suất không hợp lệ');
      checkDate(b.priceDate);
      // Changing the legal set changes results, so it must be requested explicitly.
      if (b.legalSet !== undefined && b.legalSet !== p.legalSet) {
        if (!legal.isLegalSet(b.legalSet)) throw new HttpError(400, 'Bộ pháp lý không hợp lệ');
        if (b.confirmLegalSetChange !== true) throw new HttpError(409, 'Đổi bộ pháp lý sẽ tính lại toàn bộ dự toán – cần xác nhận.');
      }
      return repo.updateProject(p.id, {
        legalSet: b.legalSet ?? p.legalSet,
        priceDate: b.priceDate !== undefined ? b.priceDate || null : p.priceDate,
        gxdttTmdt: b.gxdttTmdt !== undefined ? tmdt(b.gxdttTmdt) : p.gxdttTmdt,
        region: b.region !== undefined ? region(b.region) : p.region,
        subArea: b.subArea !== undefined ? String(b.subArea ?? '').trim() || null : p.subArea,
        name: b.name ?? p.name,
        ownerName: b.ownerName ?? p.ownerName,
        location: b.location ?? p.location,
        buildingType: b.buildingType ?? p.buildingType,
        priceBaseDate: b.priceBaseDate ?? p.priceBaseDate,
        vatRate: b.vatRate !== undefined ? Number(b.vatRate) : p.vatRate,
      });
    }),
  );
  api.delete(
    '/projects/:id',
    h((req) => {
      repo.deleteProject(proj(req).id);
    }),
  );
  api.post('/projects/:id/copy', h((req) => repo.copyProject(proj(req).id, req.user!.id)));
  api.put(
    '/projects/:id/settings',
    h((req) => {
      const p = proj(req);
      const b = (req.body?.costSettings ?? {}) as ProjectCostSettings;
      const numeric: (keyof ProjectCostSettings)[] = [
        'cRate', 'ltRate', 'ttRate', 'gtkRate', 'tlRate', 'ntRate', 'equipment', 'qlda', 'tuVan', 'other',
        'contingencyQtyRate', 'contingencyPriceRate', 'nightShare', 'nightPremium', 'machineLaborShare', 'priceIndexRate', 'durationYears',
        'contingencyPeriods', 'priceIndexAvg', 'priceIndexDelta',
      ];
      const clean: ProjectCostSettings = { autoRates: !!b.autoRates, cBase: b.cBase === 'NC' ? 'NC' : 'T' };
      // TT 36/2026 options
      const set = legal.get(p.legalSet);
      if (set.method === 'TT36_2026') {
        if (b.workCategory !== undefined) {
          if (!(b.workCategory in TT36_WORK_CATEGORIES)) throw new HttpError(400, 'Loại công việc không hợp lệ');
          clean.workCategory = b.workCategory;
        }
        if (b.cMode !== undefined) clean.cMode = b.cMode === 'NC' ? 'NC' : 'T';
        if (b.ncWorkType !== undefined) {
          if (!set.tables['3.4'].rows.some((r) => r.key === b.ncWorkType)) throw new HttpError(400, 'Loại công tác (Bảng 3.4) không hợp lệ');
          clean.ncWorkType = b.ncWorkType;
        }
        if (b.tlCategory) {
          if (!set.tables['3.6'].rows.some((r) => r.key === b.tlCategory)) throw new HttpError(400, 'Dòng Bảng 3.6 không hợp lệ');
          clean.tlCategory = b.tlCategory;
        }
        if (b.linearWorks !== undefined) clean.linearWorks = !!b.linearWorks;
        if (b.contingencyPriceMode !== undefined) {
          if (!['formula', 'percent', 'index'].includes(b.contingencyPriceMode)) throw new HttpError(400, 'Cách tính dự phòng trượt giá không hợp lệ');
          clean.contingencyPriceMode = b.contingencyPriceMode;
        }
        if (b.contingencyPeriodUnit !== undefined) clean.contingencyPeriodUnit = b.contingencyPeriodUnit === 'quy' ? 'quy' : 'nam';
        if (b.contingencySchedule !== undefined) {
          if (!Array.isArray(b.contingencySchedule) || b.contingencySchedule.some((x) => !Number.isFinite(Number(x)) || Number(x) < 0)) {
            throw new HttpError(400, 'Phân bổ giá trị theo thời gian không hợp lệ');
          }
          const sched = b.contingencySchedule.map(Number);
          if (sched.length && Math.abs(sched.reduce((a, x) => a + x, 0) - 100) > 0.01) throw new HttpError(400, 'Tổng phân bổ theo thời gian phải bằng 100%');
          clean.contingencySchedule = sched;
        }
        if (b.contingencyQtyRate !== undefined && Number(b.contingencyQtyRate) > 5) {
          throw new HttpError(400, 'Tỷ lệ dự phòng khối lượng phát sinh kps không vượt quá 5% (TT 36/2026, công thức 2.8)');
        }
        if (b.contingencyPeriods !== undefined && !(Number(b.contingencyPeriods) >= 1 && Number(b.contingencyPeriods) <= 200)) {
          throw new HttpError(400, 'Thời gian xây dựng (số kỳ) không hợp lệ');
        }
      }
      for (const k of numeric) {
        if (b[k] === undefined) continue;
        const v = Number(b[k]);
        if (!Number.isFinite(v) || v < 0) throw new HttpError(400, `Giá trị không hợp lệ: ${k}`);
        if (['nightShare', 'nightPremium', 'machineLaborShare'].includes(k) && v > 100) throw new HttpError(400, `Tỷ lệ phải ≤ 100%: ${k}`);
        (clean as Record<string, number>)[k] = v;
      }
      const vat = req.body?.vatRate !== undefined ? Number(req.body.vatRate) : p.vatRate;
      return repo.updateProject(p.id, { costSettings: clean, vatRate: vat });
    }),
  );
  api.get('/projects/:id/estimate', h((req) => repo.calculate(proj(req).id)));
  api.get('/projects/:id/validation', h((req) => validateProject(repo, legal, priceBooks, proj(req).id)));

  // categories
  api.post('/projects/:id/categories', h((req) => repo.createCategory(proj(req).id, String(req.body?.name ?? ''))));
  api.put(
    '/projects/:id/categories/:catId',
    h((req) => {
      const b = req.body ?? {};
      let ttRate: number | null | undefined;
      if (b.ttRate !== undefined) {
        ttRate = b.ttRate === null || b.ttRate === '' ? null : Number(b.ttRate);
        if (ttRate !== null && !(Number.isFinite(ttRate) && ttRate >= 0 && ttRate <= 100)) throw new HttpError(400, 'Tỷ lệ TT không hợp lệ');
      }
      repo.updateCategory(proj(req).id, id(req.params.catId), { name: b.name, order: b.order, ttRate });
    }),
  );
  api.delete(
    '/projects/:id/categories/:catId',
    h((req) => {
      repo.deleteCategory(proj(req).id, id(req.params.catId));
    }),
  );

  // items
  api.post(
    '/projects/:id/items',
    h((req) => {
      const p = proj(req);
      const b = req.body ?? {};
      return repo.createItem(p.id, {
        categoryId: id(String(b.categoryId)),
        normCode: b.normCode,
        name: b.name,
        unit: b.unit,
        note: b.note,
        ...quantityFromBody(b),
      });
    }),
  );
  api.put(
    '/projects/:id/items/:itemId',
    h((req) => {
      const p = proj(req);
      const b = req.body ?? {};
      const data: Record<string, unknown> = { ...quantityFromBody(b) };
      for (const k of ['normCode', 'name', 'unit', 'note', 'order', 'categoryId'] as const) if (b[k] !== undefined) data[k] = b[k];
      return repo.updateItem(p.id, id(req.params.itemId), data);
    }),
  );
  api.delete(
    '/projects/:id/items/:itemId',
    h((req) => {
      repo.deleteItem(proj(req).id, id(req.params.itemId));
    }),
  );

  // pricing method and quantity lines (Section F)
  api.put(
    '/projects/:id/items/:itemId/pricing',
    h((req) => {
      const p = proj(req);
      const b = req.body ?? {};
      const method = b.pricingMethod;
      if (!['NORM_BASED', 'CUSTOM_GTT', 'MARKET_QUOTE'].includes(method)) throw new HttpError(400, 'Phương thức tính giá không hợp lệ');
      const num = (v: unknown) => {
        if (v === undefined || v === null || v === '') return 0;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'Đơn giá không hợp lệ');
        return n;
      };
      const custom = b.custom ? { vl: num(b.custom.vl), nc: num(b.custom.nc), m: num(b.custom.m) } : null;
      const q = b.quote ?? null;
      if (method === 'MARKET_QUOTE') {
        if (!q?.supplier) throw new HttpError(400, 'Báo giá cần tên nhà cung cấp');
        if (q.vatStatus && !['before_vat', 'including_vat', 'not_stated'].includes(q.vatStatus)) throw new HttpError(400, 'Trạng thái VAT không hợp lệ');
        checkDate(q.date);
        checkDate(q.validUntil);
      }
      return repo.setPricing(p.id, id(req.params.itemId), {
        pricingMethod: method,
        custom,
        priceSource: b.priceSource ? String(b.priceSource).trim() || null : null,
        quote: q ? { supplier: q.supplier ?? null, number: q.number ?? null, date: q.date || null, validUntil: q.validUntil || null, vatStatus: q.vatStatus ?? 'not_stated', vatRate: q.vatRate !== undefined && q.vatRate !== null && q.vatRate !== '' ? Number(q.vatRate) : null } : null,
      });
    }),
  );
  // Update 4 fidelity: toggle an imported item between "Thành tiền theo file" and "Tính lại theo KL×đơn giá"
  api.put(
    '/projects/:id/items/:itemId/amount-mode',
    h((req) => {
      const mode = req.body?.mode;
      if (mode !== 'file' && mode !== 'calc') throw new HttpError(400, 'Chế độ áp dụng Thành tiền không hợp lệ');
      return repo.setAmountMode(proj(req).id, id(req.params.itemId), mode);
    }),
  );
  const linesOf = (v: unknown) => {
    if (!Array.isArray(v)) throw new HttpError(400, 'Danh sách dòng khối lượng không hợp lệ');
    if (v.length > 500) throw new HttpError(400, 'Tối đa 500 dòng khối lượng');
    return v.map((l: { description?: unknown; expression?: unknown; variables?: unknown; variablesText?: unknown; sign?: unknown; unit?: unknown }) => {
      let variables: Record<string, number> = {};
      try {
        variables =
          typeof l.variablesText === 'string'
            ? parseVariables(l.variablesText)
            : l.variables && typeof l.variables === 'object'
              ? Object.fromEntries(Object.entries(l.variables as Record<string, unknown>).map(([k, x]) => [k, Number(x)]))
              : {};
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      return {
        description: String(l.description ?? ''),
        expression: String(l.expression ?? ''),
        variables,
        sign: (Number(l.sign) === -1 ? -1 : 1) as 1 | -1,
        unit: l.unit ? String(l.unit) : null,
      };
    });
  };
  api.get('/projects/:id/items/:itemId/quantity-lines', h((req) => repo.quantityLines(repo.getItem(proj(req).id, id(req.params.itemId)).id)));
  api.put('/projects/:id/items/:itemId/quantity-lines', h((req) => repo.saveQuantityLines(proj(req).id, id(req.params.itemId), linesOf(req.body?.lines))));
  api.post(
    '/quantity/evaluate',
    h((req) => {
      const lines = linesOf(req.body?.lines ?? [req.body]);
      try {
        return computeQuantityLines(lines, String(req.body?.itemUnit ?? ''));
      } catch (e) {
        if (e instanceof QuantityError) throw new HttpError(400, e.message);
        throw e;
      }
    }),
  );

  // code suggestions / auto-assignment (Update 2 – C)
  api.get(
    '/projects/:id/suggestions',
    h((req) => {
      const p = proj(req);
      return repo.unassignedItems(p.id).map((item) => ({
        itemId: item.id,
        candidates: repo.suggestFor(p.id, item, 5).map((s) => ({
          code: s.norm.code,
          name: s.norm.name,
          unit: s.norm.unit,
          confidence: s.confidence,
          why: s.why,
          unitFactor: s.unitFactor,
        })),
      }));
    }),
  );
  const threshold = (v: unknown) => {
    const t = v === undefined ? 0.8 : Number(v);
    if (!(t > 0 && t <= 1)) throw new HttpError(400, 'Ngưỡng độ tin cậy phải trong khoảng (0; 1]');
    return t;
  };
  api.post(
    '/projects/:id/auto-assign/preview',
    h((req) => autoAssignPlan(repo, proj(req).id, threshold(req.body?.threshold))),
  );
  api.post(
    '/projects/:id/auto-assign',
    h((req) => {
      const p = proj(req);
      const list = req.body?.assignments;
      if (!Array.isArray(list) || !list.length) throw new HttpError(400, 'Không có công việc nào để gắn mã');
      const action = {
        tool: 'autoAssignCodes' as const,
        params: { assignments: list.map((a: { itemId: unknown; normCode: unknown; confidence: unknown }) => ({ itemId: id(String(a.itemId)), normCode: String(a.normCode), confidence: Number(a.confidence) || 0 })) },
      };
      return assistant.confirm(p.id, req.user!.id, action, `Gắn mã tự động cho ${list.length} công việc`);
    }),
  );
  api.post(
    '/projects/:id/items/:itemId/assign-code',
    h((req) => repo.assignCode(proj(req).id, id(req.params.itemId), String(req.body?.normCode ?? ''), 'confirmed')),
  );
  api.post(
    '/projects/:id/items/:itemId/confirm-code',
    h((req) => {
      const p = proj(req);
      const item = repo.getItem(p.id, id(req.params.itemId));
      if (!item.normCode) throw new HttpError(400, 'Công việc chưa có mã');
      return repo.updateItem(p.id, item.id, { codeStatus: 'confirmed' });
    }),
  );
  api.post(
    '/projects/:id/confirm-codes',
    h((req) => {
      const p = proj(req);
      const ids: number[] = Array.isArray(req.body?.itemIds) ? req.body.itemIds.map((x: unknown) => id(String(x))) : [];
      let n = 0;
      db.transaction(() => {
        for (const i of ids) {
          const item = repo.getItem(p.id, i);
          if (item.codeStatus === 'auto') {
            repo.updateItem(p.id, i, { codeStatus: 'confirmed' });
            n++;
          }
        }
      })();
      return { confirmed: n };
    }),
  );
  api.post(
    '/projects/:id/approve',
    h((req) => {
      const p = proj(req);
      repo.approveProject(p.id, req.user!.username);
      return repo.getProject(p.id);
    }),
  );
  api.post(
    '/projects/:id/unapprove',
    h((req) => {
      const p = proj(req);
      repo.unapproveProject(p.id);
      return repo.getProject(p.id);
    }),
  );

  // prices
  api.get(
    '/projects/:id/prices',
    h((req) => {
      const p = proj(req);
      const prices = repo.projectPrices(p.id);
      const used = new Set(repo.calculate(p.id).resourceSummary.map((r) => r.code));
      const resolved = priceBooks.resolve(p.id);
      return repo
        .listResources()
        .map((r) => ({
          ...r,
          projectPrice: prices[r.code] ?? null,
          effectivePrice: resolved[r.code]?.price ?? r.basePrice,
          source: resolved[r.code]?.source ?? null,
          used: used.has(r.code),
        }))
        .filter((r) => req.query.all === '1' || r.used || r.projectPrice !== null);
    }),
  );
  api.put(
    '/projects/:id/prices/:code',
    h((req) => {
      const p = proj(req);
      const code = String(req.params.code);
      if (!repo.getResource(code)) throw new HttpError(404, 'Không tìm thấy tài nguyên');
      const raw = req.body?.price;
      const price = raw === null || raw === '' || raw === undefined ? null : Number(raw);
      if (price !== null && (!Number.isFinite(price) || price < 0)) throw new HttpError(400, 'Giá không hợp lệ');
      repo.setProjectPrice(p.id, code, price);
    }),
  );

  // norms & resources library
  const datasets = () => new Set(legal.all().map((s) => s.normDataset));
  const dataset = (v: unknown) => {
    const d = typeof v === 'string' && v ? v : legal.get('TT36_2026').normDataset;
    if (!datasets().has(d)) throw new HttpError(400, 'Bộ định mức không hợp lệ');
    return d;
  };
  api.get('/norms', h((req) => repo.searchNorms(String(req.query.q ?? ''), dataset(req.query.dataset), Math.min(Number(req.query.limit) || 50, 200))));
  api.get(
    '/norms/:code',
    h((req) => {
      const ds = dataset(req.query.dataset);
      const n = repo.getNorm(String(req.params.code), ds);
      if (!n) throw new HttpError(404, 'Không tìm thấy định mức');
      return { ...n, dataset: ds, resources: repo.getNormResources(n.code, ds) };
    }),
  );
  api.get('/resources', h((req) => (req.query.q ? repo.searchResources(String(req.query.q), 50) : repo.listResources())));

  // mix designs (TT 38/2026 Phụ lục VII – cấp phối vật liệu)
  api.get(
    '/mix-designs',
    h((req) => {
      const kind = req.query.kind;
      if (kind !== undefined && !['concrete', 'mortar', 'other'].includes(String(kind))) throw new HttpError(400, 'Loại cấp phối không hợp lệ');
      return repo.listMixDesigns({
        kind: kind as 'concrete' | 'mortar' | 'other' | undefined,
        grade: req.query.grade ? String(req.query.grade) : undefined,
        q: req.query.q ? String(req.query.q) : undefined,
      });
    }),
  );
  api.get(
    '/mix-designs/:code',
    h((req) => {
      const m = repo.getMixDesign(String(req.params.code));
      if (!m) throw new HttpError(404, 'Không tìm thấy mã cấp phối');
      return m;
    }),
  );
  api.put(
    '/projects/:id/items/:itemId/mix',
    h((req) => {
      const p = proj(req);
      const mixCode = req.body?.mixCode;
      if (mixCode !== null && typeof mixCode !== 'string') throw new HttpError(400, 'Mã cấp phối không hợp lệ');
      return repo.setMixCode(p.id, id(req.params.itemId), mixCode ? mixCode.trim() : null);
    }),
  );

  // export
  api.get(
    '/projects/:id/export.xlsx',
    h(async (req, res) => {
      const calc = repo.calculate(proj(req).id);
      const wb = await buildWorkbook(calc, req.user!.fullName || req.user!.username, legalDocuments().documents);
      const safe = calc.project.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^\w-]+/g, '_');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="DuToan_${safe || 'CongTrinh'}.xlsx"`);
      await wb.xlsx.write(res);
      res.end();
    }),
  );

  // import
  const target = (v: unknown): ImportTarget => (v === 'prices' || v === 'items' ? v : 'norms');
  api.post(
    '/import/upload',
    upload.single('file'),
    h(async (req) => {
      let buffer: Buffer;
      let fileName: string;
      if (req.file) {
        buffer = req.file.buffer;
        fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      } else if (req.body?.path) {
        if (!config.localMode) throw new HttpError(403, 'Nhập theo đường dẫn chỉ dùng khi chạy trên máy cá nhân (LOCAL_MODE=true).');
        const p = String(req.body.path);
        if (!path.isAbsolute(p)) throw new HttpError(400, 'Cần đường dẫn tuyệt đối, ví dụ C:\\DuLieu\\dinhmuc.xlsx');
        if (!/\.(xlsx|csv|txt)$/i.test(p)) throw new HttpError(400, 'Chỉ hỗ trợ file .xlsx hoặc .csv');
        try {
          buffer = fs.readFileSync(p);
        } catch {
          throw new HttpError(404, 'Không đọc được file theo đường dẫn đã nhập');
        }
        fileName = path.basename(p);
      } else throw new HttpError(400, 'Chưa chọn file');
      const parsed = await parseAndStore(req.user!.id, fileName, buffer);
      return previewOf(parsed, 0, target(req.body?.target));
    }),
  );
  api.post(
    '/import/gdrive',
    h(async (req) => {
      if (!config.google.clientId) throw new HttpError(400, 'Google Drive chưa được cấu hình (xem docs/google-drive-setup.md)');
      const b = req.body ?? {};
      const { buffer, fileName } = await downloadDriveFile(String(b.fileId), String(b.accessToken), String(b.mimeType ?? ''), String(b.name ?? ''));
      const parsed = await parseAndStore(req.user!.id, fileName, buffer);
      return previewOf(parsed, 0, target(b.target));
    }),
  );
  api.post(
    '/import/preview',
    h((req) => previewOf(getParsed(String(req.body?.fileId), req.user!.id), Number(req.body?.sheetIndex) || 0, target(req.body?.target))),
  );
  api.post(
    '/import/apply',
    h((req) => {
      const b = req.body ?? {};
      const f = getParsed(String(b.fileId), req.user!.id);
      const projectId = b.projectId ? repo.requireProject(id(String(b.projectId)), req.user!.id, req.user!.role === 'admin').id : undefined;
      const t = target(b.target);
      if ((t === 'norms' || (t === 'prices' && b.priceScope !== 'project')) && req.user!.role !== 'admin') {
        throw new HttpError(403, 'Chỉ quản trị viên được cập nhật thư viện định mức/giá gốc');
      }
      return applyImport(repo, f, {
        fileId: f.id,
        sheetIndex: Number(b.sheetIndex) || 0,
        headerRow: Number(b.headerRow) || 0,
        target: t,
        mapping: b.mapping ?? {},
        projectId,
        categoryId: b.categoryId ? Number(b.categoryId) : undefined,
        priceScope: b.priceScope === 'project' ? 'project' : 'base',
        dataset: t === 'norms' ? dataset(b.dataset) : undefined,
      });
    }),
  );

  // price books by region and period – Update 2, D
  api.get('/regions', h(() => regions()));
  const bid = (req: Request) => id(req.params.bid);
  api.get('/price-books', h((req) => priceBooks.list({ region: req.query.region ? String(req.query.region) : undefined, type: req.query.type ? String(req.query.type) : undefined })));
  api.get('/price-books/:bid', h((req) => ({ ...priceBooks.get(bid(req)), rows: priceBooks.rows(bid(req)), suppliers: priceBooks.suppliers(bid(req)) })));
  api.post(
    '/price-books',
    requireAdmin,
    h((req) => {
      const b = req.body ?? {};
      if (b.region) region(b.region);
      return priceBooks.create(b, req.user!.username);
    }),
  );
  api.put(
    '/price-books/:bid',
    requireAdmin,
    h((req) => {
      const b = req.body ?? {};
      if (b.region) region(b.region);
      return priceBooks.update(bid(req), b);
    }),
  );
  api.delete(
    '/price-books/:bid',
    requireAdmin,
    h((req) => {
      priceBooks.delete(bid(req));
    }),
  );
  api.post(
    '/price-books/:bid/status',
    requireAdmin,
    h((req) => {
      const st = req.body?.status;
      if (!['draft', 'verified', 'needs_review', 'not_verified', 'superseded'].includes(st)) throw new HttpError(400, 'Trạng thái không hợp lệ');
      return priceBooks.setStatus(bid(req), st, req.user!.username);
    }),
  );
  api.get('/price-books/:bid/records', h((req) => priceBooks.records(bid(req))));
  api.get('/province-mergers', h(() => provinceMergers()));
  api.get('/projects/:id/transport', h((req) => priceBooks.transportLegs(proj(req).id)));
  api.put(
    '/projects/:id/transport/:code',
    h((req) => {
      const p = proj(req);
      const legs = Array.isArray(req.body?.legs) ? req.body.legs : null;
      if (!legs) throw new HttpError(400, 'Danh sách chặng vận chuyển không hợp lệ');
      const n = (v: unknown, d = 0) => (v === undefined || v === null || v === '' ? d : Number(v));
      return priceBooks.saveTransportLegs(
        p.id,
        String(req.params.code),
        legs.map((l: Record<string, unknown>) => ({
          fromLocation: String(l.fromLocation ?? ''),
          toLocation: String(l.toLocation ?? ''),
          roadClass: l.roadClass ? String(l.roadClass) : null,
          distance: n(l.distance),
          freightRate: n(l.freightRate),
          loadFactor: n(l.loadFactor, 1),
          weightFactor: n(l.weightFactor, 1),
          handling: n(l.handling),
          toll: n(l.toll),
          note: l.note ? String(l.note) : null,
        })),
      );
    }),
  );
  api.post(
    '/price-books/:bid/import',
    requireAdmin,
    h((req) => {
      const b = req.body ?? {};
      const f = getParsed(String(b.fileId), req.user!.id);
      return priceBooks.importRows(bid(req), f, { ...headerOpts(b), replace: !!b.replace, saveTemplate: b.saveTemplate ?? null }, req.user!.username);
    }),
  );
  api.put(
    '/price-books/:bid/rows/:rid',
    requireAdmin,
    h((req) => priceBooks.matchRow(bid(req), id(req.params.rid), req.body?.resourceCode ? String(req.body.resourceCode) : null, !!req.body?.ignore)),
  );
  api.get('/resources/:code/price-history', h((req) => priceBooks.history(String(req.params.code))));
  const selectionOf = (v: unknown) => {
    if (!Array.isArray(v)) throw new HttpError(400, 'Danh sách bộ đơn giá không hợp lệ');
    return v.map((x: { bookId: unknown; resourceType: unknown; priority: unknown }) => ({
      bookId: id(String(x.bookId)),
      resourceType: String(x.resourceType) as 'VL' | 'NC' | 'M',
      priority: Number(x.priority) || 1,
    }));
  };
  api.get(
    '/projects/:id/price-books',
    h((req) => {
      const p = proj(req);
      return { selection: priceBooks.selection(p.id), proposals: priceBooks.proposals(p.id), books: priceBooks.list() };
    }),
  );
  api.put(
    '/projects/:id/price-books',
    h((req) => {
      const p = proj(req);
      priceBooks.saveSelection(p.id, selectionOf(req.body?.selection));
      return { selection: priceBooks.selection(p.id) };
    }),
  );
  api.post('/projects/:id/price-books/preview', h((req) => priceBooks.preview(proj(req).id, selectionOf(req.body?.selection))));

  // import existing estimate files (any layout) – Update 2, B
  const mappingOf = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, number>) : undefined);
  const headerOpts = (b: Record<string, unknown>) => ({
    sheetIndex: b.sheetIndex !== undefined && b.sheetIndex !== null ? Number(b.sheetIndex) : undefined,
    headerRow: b.headerRow !== undefined && b.headerRow !== null ? Number(b.headerRow) : undefined,
    headerRows: (Number(b.headerRows) === 2 ? 2 : 1) as 1 | 2,
    mapping: mappingOf(b.mapping),
    firstRow: b.firstRow !== undefined && b.firstRow !== null && b.firstRow !== '' ? Number(b.firstRow) : undefined,
    lastRow: b.lastRow !== undefined && b.lastRow !== null && b.lastRow !== '' ? Number(b.lastRow) : undefined,
    rowTypes: b.rowTypes && typeof b.rowTypes === 'object' ? (b.rowTypes as Record<string, RowType | 'skip'>) : undefined,
    allowNumericName: b.allowNumericName === true,
    pricingOption: (b.pricingOption === 'norm' ? 'norm' : b.pricingOption === 'file' ? 'file' : undefined) as 'file' | 'norm' | undefined,
    blockIndex: b.blockIndex !== undefined && b.blockIndex !== null ? Number(b.blockIndex) : undefined,
    equipmentAsQuote: b.equipmentAsQuote === false ? false : undefined,
    amountFidelity: (b.amountFidelity === 'calc' ? 'calc' : b.amountFidelity === 'file' ? 'file' : undefined) as 'file' | 'calc' | undefined,
    amountModeOverrides:
      b.amountModeOverrides && typeof b.amountModeOverrides === 'object'
        ? (Object.fromEntries(Object.entries(b.amountModeOverrides as Record<string, unknown>).filter(([, v]) => v === 'file' || v === 'calc')) as Record<string, 'file' | 'calc'>)
        : undefined,
  });
  const sheetIndexesOf = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n >= 0) : undefined);
  api.post(
    '/import/analyze-multi',
    h((req) => {
      const b = req.body ?? {};
      const f = getParsed(String(b.fileId), req.user!.id);
      const projectId = b.projectId ? repo.requireProject(id(String(b.projectId)), req.user!.id, req.user!.role === 'admin').id : undefined;
      return analyzeSheets(db, repo, f, { projectId, sheetIndexes: sheetIndexesOf(b.sheetIndexes), pricingOption: b.pricingOption === 'norm' ? 'norm' : 'file', equipmentAsQuote: b.equipmentAsQuote !== false, amountFidelity: headerOpts(b).amountFidelity, amountModeOverrides: headerOpts(b).amountModeOverrides });
    }),
  );
  api.post(
    '/projects/:id/import-sheets',
    h((req) => {
      const p = proj(req);
      const b = req.body ?? {};
      const f = getParsed(String(b.fileId), req.user!.id);
      const r = importSheets(db, repo, f, p.id, { sheetIndexes: sheetIndexesOf(b.sheetIndexes), pricingOption: b.pricingOption === 'norm' ? 'norm' : 'file', equipmentAsQuote: b.equipmentAsQuote !== false, saveSummary: b.saveSummary !== false, amountFidelity: headerOpts(b).amountFidelity, amountModeOverrides: headerOpts(b).amountModeOverrides }, req.user!.username);
      if (r.created) assistant.record(p.id, req.user!.id, `Nhập ${r.created} công việc từ ${f.fileName} (${r.blocks.length} bảng)`, { tool: 'importEstimate', file: f.fileName }, r.undo);
      let autoText = '';
      const t = b.autoAssignThreshold;
      if (t !== undefined && t !== null && r.created) {
        const plan = autoAssignPlan(repo, p.id, threshold(t));
        const mine = plan.assign.filter((a) => r.itemIds.includes(a.itemId));
        if (mine.length) autoText = ` ${assistant.confirm(p.id, req.user!.id, { tool: 'autoAssignCodes', params: { assignments: mine } }, `Gắn mã tự động sau khi nhập ${f.fileName}`).text}`;
      }
      const { undo: _u, ...rest } = r;
      return { ...rest, message: r.message + autoText };
    }),
  );
  api.post(
    '/import/analyze',
    h((req) => {
      const b = req.body ?? {};
      const f = getParsed(String(b.fileId), req.user!.id);
      const projectId = b.projectId ? repo.requireProject(id(String(b.projectId)), req.user!.id, req.user!.role === 'admin').id : undefined;
      return analyze(db, repo, f, { ...headerOpts(b), kind: b.kind === 'pricebook' ? 'pricebook' : 'estimate', projectId });
    }),
  );
  api.post(
    '/projects/:id/import-estimate',
    h((req) => {
      const p = proj(req);
      const b = req.body ?? {};
      const f = getParsed(String(b.fileId), req.user!.id);
      const r = importEstimate(db, repo, f, p.id, { ...headerOpts(b), saveTemplate: b.saveTemplate ?? null, codeChoices: b.codeChoices && typeof b.codeChoices === 'object' ? (b.codeChoices as Record<string, string | null>) : undefined, replaceImportId: b.replaceImportId ? Number(b.replaceImportId) : undefined, replaceCategoryIds: Array.isArray(b.replaceCategoryIds) ? b.replaceCategoryIds.map(Number).filter(Number.isFinite) : undefined }, req.user!.username);
      if (r.created && !r.revisionId) assistant.record(p.id, req.user!.id, `Nhập ${r.created} công việc từ ${f.fileName}`, { tool: 'importEstimate', file: f.fileName }, r.undo);
      let autoText = '';
      const t = b.autoAssignThreshold;
      if (t !== undefined && t !== null && r.created) {
        const plan = autoAssignPlan(repo, p.id, threshold(t));
        const mine = plan.assign.filter((a) => r.itemIds.includes(a.itemId));
        if (mine.length) {
          const res = assistant.confirm(p.id, req.user!.id, { tool: 'autoAssignCodes', params: { assignments: mine } }, `Gắn mã tự động sau khi nhập ${f.fileName}`);
          autoText = ` ${res.text}`;
        }
      }
      const { undo: _u, ...rest } = r;
      return { ...rest, message: r.message + autoText };
    }),
  );
  // Update 3 C – "Cập nhật định mức & đơn giá theo khu vực": preview, apply as an undoable revision, audit log
  const regionalReq = (b: Record<string, unknown>) => ({
    region: String(b.region ?? ''),
    subArea: b.subArea ? String(b.subArea) : null,
    auto: b.auto !== false,
    period: b.period && typeof b.period === 'object' ? (b.period as { type: 'month' | 'quarter' | 'year'; year: number; value: number | null }) : null,
    types: Array.isArray(b.types) ? (b.types.filter((t) => ['VL', 'NC', 'M'].includes(String(t))) as ('VL' | 'NC' | 'M')[]) : undefined,
    priceDate: b.priceDate ? String(b.priceDate) : null,
    remapCodes: b.remapCodes === true,
    codeChoices: b.codeChoices && typeof b.codeChoices === 'object' ? (b.codeChoices as Record<string, string | null>) : undefined,
  });
  api.post('/projects/:id/regional-update/preview', h((req) => regional.preview(proj(req).id, regionalReq(req.body ?? {}))));
  api.post('/projects/:id/regional-update/apply', h((req) => regional.apply(proj(req).id, regionalReq(req.body ?? {}), req.user!.username)));
  api.get('/projects/:id/revisions', h((req) => regional.revisions(proj(req).id)));
  api.post(
    '/projects/:id/revisions/:rid/undo',
    h((req) => {
      regional.undo(proj(req).id, id(req.params.rid));
    }),
  );
  api.get('/projects/:id/price-update-status', h((req) => regional.status(proj(req).id)));
  api.put(
    '/projects/:id/auto-price-update',
    h((req) => repo.setAutoPriceUpdate(proj(req).id, req.body?.enabled === true)),
  );

  // Update 4 A8 – "Sửa lại cột đã nhập": re-open the stored sheet of an import with its mapping
  api.get('/projects/:id/categories/:cid/import-info', h((req) => importInfoForCategory(db, proj(req).id, id(req.params.cid))));
  api.post(
    '/projects/:id/imports/:iid/reopen',
    h((req) => {
      const p = proj(req);
      const { file, header, mapping, options } = reopenImport(db, p.id, id(req.params.iid), req.user!.id);
      return analyze(db, repo, file, { sheetIndex: 0, headerRow: header.headerRow, headerRows: header.headerRows, mapping, firstRow: options.firstRow, lastRow: options.lastRow, rowTypes: options.rowTypes as Record<string, RowType | 'skip'> | undefined, pricingOption: options.pricingOption, kind: 'estimate', projectId: p.id });
    }),
  );
  api.get('/import/templates', h((req) => listTemplates(db, req.query.kind === 'pricebook' ? 'pricebook' : req.query.kind === 'estimate' ? 'estimate' : undefined)));
  api.delete(
    '/import/templates/:tid',
    requireAdmin,
    h((req) => {
      db.prepare('DELETE FROM import_templates WHERE id = ?').run(id(req.params.tid));
    }),
  );

  // Update 5 — Bóc khối lượng theo cấu kiện
  api.get('/takeoff/element-types', h(() => ({ labels: ELEMENT_TYPE_LABELS, defaults: ELEMENT_DEFAULTS })));

  api.get('/projects/:id/stories', h((req) => takeoff.listStories(proj(req).id)));
  api.post('/projects/:id/stories', h((req) => takeoff.createStory(proj(req).id, req.body ?? {})));
  api.put('/projects/:id/stories/:sid', h((req) => takeoff.updateStory(proj(req).id, id(req.params.sid), req.body ?? {})));
  api.delete(
    '/projects/:id/stories/:sid',
    h((req) => {
      takeoff.deleteStory(proj(req).id, id(req.params.sid));
    }),
  );

  const elementType = (v: unknown): ElementType => {
    if (typeof v !== 'string' || !(v in ELEMENT_TYPE_LABELS)) throw new HttpError(400, 'Loại cấu kiện không hợp lệ');
    return v as ElementType;
  };
  api.get('/projects/:id/takeoff/elements', h((req) => takeoff.elementsWithTasks(proj(req).id)));
  api.post(
    '/projects/:id/takeoff/elements',
    h((req) => {
      const b = req.body ?? {};
      const el = takeoff.createElement(proj(req).id, { ...b, type: elementType(b.type) });
      return { element: el, tasks: takeoff.tasksFor(proj(req).id, el) };
    }),
  );
  api.put(
    '/projects/:id/takeoff/elements/:eid',
    h((req) => {
      const el = takeoff.updateElement(proj(req).id, id(req.params.eid), req.body ?? {});
      return { element: el, tasks: takeoff.tasksFor(proj(req).id, el) };
    }),
  );
  api.delete(
    '/projects/:id/takeoff/elements/:eid',
    h((req) => {
      takeoff.deleteElement(proj(req).id, id(req.params.eid));
    }),
  );
  api.get(
    '/projects/:id/takeoff/elements/:eid/tasks',
    h((req) => takeoff.tasksFor(proj(req).id, takeoff.getElement(proj(req).id, id(req.params.eid)))),
  );

  api.get('/projects/:id/takeoff/manual', h((req) => takeoff.listManualRows(proj(req).id)));
  api.post('/projects/:id/takeoff/manual/eval', h((req) => takeoff.evalManualRow(proj(req).id, req.body ?? {}, false)));
  api.post('/projects/:id/takeoff/manual', h((req) => takeoff.evalManualRow(proj(req).id, req.body ?? {}, true)));
  api.delete(
    '/projects/:id/takeoff/manual/:rid',
    h((req) => {
      takeoff.deleteManualRow(proj(req).id, id(req.params.rid));
    }),
  );
  api.post(
    '/projects/:id/takeoff/manual/:rid/send',
    h((req) => {
      takeoff.sendManualRowToItem(proj(req).id, id(req.params.rid), id(String(req.body?.itemId)));
    }),
  );

  api.get('/projects/:id/takeoff/rebar', h((req) => takeoff.listRebarRows(proj(req).id)));
  api.get('/projects/:id/takeoff/rebar/summary', h((req) => takeoff.rebarSummary(proj(req).id)));
  api.put('/projects/:id/takeoff/rebar', h((req) => takeoff.saveRebarRow(proj(req).id, req.body ?? {})));
  api.delete(
    '/projects/:id/takeoff/rebar/:rid',
    h((req) => {
      takeoff.deleteRebarRow(proj(req).id, id(req.params.rid));
    }),
  );

  api.post('/projects/:id/takeoff/push/preview', h((req) => takeoff.pushPreview(proj(req).id, req.body ?? {})));
  api.post('/projects/:id/takeoff/push/apply', h((req) => takeoff.pushApply(proj(req).id, req.body ?? {}, req.user!.username)));
  api.post(
    '/projects/:id/takeoff/push/:revisionId/undo',
    h((req) => {
      takeoff.undoPush(proj(req).id, id(req.params.revisionId));
    }),
  );

  // assistant
  api.post('/projects/:id/assistant', h((req) => assistant.message(proj(req).id, req.body ?? {}, req.user!.id)));
  api.post(
    '/projects/:id/assistant/confirm',
    h((req) => {
      if (!req.body?.action?.tool) throw new HttpError(400, 'Thiếu thao tác');
      return assistant.confirm(proj(req).id, req.user!.id, req.body.action, String(req.body.description ?? ''));
    }),
  );
  api.post('/projects/:id/assistant/undo', h((req) => assistant.undo(proj(req).id)));
  api.get('/projects/:id/assistant/history', h((req) => assistant.history(proj(req).id)));

  app.use('/api', api);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Không tìm thấy API')));

  if (opts.serveWeb !== false && fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: `Lỗi tải file: ${err.message}` });
    console.error(err);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  });

  return app;
}

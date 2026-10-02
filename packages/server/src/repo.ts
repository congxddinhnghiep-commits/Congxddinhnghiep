import {
  computeEstimate,
  computeUnitCost,
  computeProjectCost,
  defaultLegalSetFor,
  legalSetDateWarning,
  computeQuantityLines,
  expandMixDesign,
  isMixResourceName,
  NormIndex,
  normalizeText,
  type QuantityLineInput,
  unitFactor,
  searchByCodeOrName,
  type BuildingType,
  type Category,
  type EstimateItem,
  type LegalSetId,
  type MixDesign,
  type MixKind,
  type Norm,
  type NormResource,
  type ProjectCostSettings,
  type Resource,
  type ResolvedPrice,
  type ResourceType,
} from '@dutoan/core';
import type { DB } from './db.js';
import type { LegalService } from './legal.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}


export interface ProjectRow {
  id: number;
  owner_id: number;
  name: string;
  owner_name: string;
  location: string;
  building_type: BuildingType;
  price_base_date: string;
  vat_rate: number;
  cost_settings: string | null;
  legal_set: LegalSetId | null;
  price_date: string | null;
  gxdtt_tmdt: number | null;
  status: 'draft' | 'approved' | null;
  approved_by: string | null;
  approved_at: string | null;
  region: string | null;
  sub_area: string | null;
  auto_price_update: number | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: number;
  ownerId: number;
  name: string;
  ownerName: string;
  location: string;
  buildingType: BuildingType;
  priceBaseDate: string;
  vatRate: number;
  costSettings: ProjectCostSettings | null;
  /** Legal set pinned to the project (never changed automatically). */
  legalSet: LegalSetId;
  /** ISO price date used to pick the default legal set. */
  priceDate: string | null;
  /** Chi phí XD trước thuế của công trình trong TMĐT được duyệt (tỷ đồng) – bracket base for Bảng 3.3/3.7. */
  gxdttTmdt: number | null;
  status: 'draft' | 'approved';
  approvedBy: string | null;
  approvedAt: string | null;
  /** Tỉnh/thành (after the 2025 merger) and optional sub-area used to pick price books. */
  region: string | null;
  subArea: string | null;
  /** Show a notification when a newer verified price book of the region is available (never applied silently). */
  autoPriceUpdate: boolean;
  createdAt: string;
  updatedAt: string;
}

export const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  ownerId: r.owner_id,
  name: r.name,
  ownerName: r.owner_name,
  location: r.location,
  buildingType: r.building_type,
  priceBaseDate: r.price_base_date,
  vatRate: r.vat_rate,
  costSettings: r.cost_settings ? JSON.parse(r.cost_settings) : null,
  legalSet: r.legal_set ?? 'TT11_2021',
  priceDate: r.price_date,
  gxdttTmdt: r.gxdtt_tmdt,
  status: r.status ?? 'draft',
  approvedBy: r.approved_by,
  approvedAt: r.approved_at,
  region: r.region,
  subArea: r.sub_area,
  autoPriceUpdate: !!r.auto_price_update,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

interface ItemRow {
  id: number;
  category_id: number;
  sort_order: number;
  norm_code: string;
  name: string;
  unit: string;
  quantity: number;
  quantity_formula: string | null;
  note: string | null;
  code_status: EstimateItem['codeStatus'] | null;
  code_confidence: number | null;
  source_file: string | null;
  source_sheet: string | null;
  source_row: number | null;
  source_description: string | null;
  source_quantity: number | null;
  source_unit: string | null;
  source_code: string | null;
  source_raw_text: string | null;
  source_flags: string | null;
  name_zh: string | null;
  pricing_method: EstimateItem['pricingMethod'] | null;
  custom_vl: number | null;
  custom_nc: number | null;
  custom_m: number | null;
  price_source: string | null;
  quote_supplier: string | null;
  quote_no: string | null;
  quote_date: string | null;
  quote_valid_until: string | null;
  quote_vat: 'before_vat' | 'including_vat' | 'not_stated' | null;
  quote_vat_rate: number | null;
  quantity_source: string | null;
  mix_code: string | null;
  norm_code_raw: string | null;
  code_check: EstimateItem['codeCheck'];
  code_check_note: string | null;
  source_cells: string | null;
}
const toItem = (r: ItemRow): EstimateItem & { sourceRawText: string | null; sourceFlags: string[] } => ({
  id: r.id,
  categoryId: r.category_id,
  order: r.sort_order,
  normCode: r.norm_code,
  name: r.name,
  unit: r.unit,
  quantity: r.quantity,
  quantityFormula: r.quantity_formula,
  note: r.note,
  codeStatus: r.code_status ?? '',
  codeConfidence: r.code_confidence,
  source:
    r.source_description !== null || r.source_file !== null
      ? {
          file: r.source_file,
          sheet: r.source_sheet,
          row: r.source_row,
          description: r.source_description,
          quantity: r.source_quantity,
          unit: r.source_unit,
          code: r.source_code,
          cells: r.source_cells ? JSON.parse(r.source_cells) : null,
        }
      : null,
  sourceRawText: r.source_raw_text,
  sourceFlags: r.source_flags ? JSON.parse(r.source_flags) : [],
  nameZh: r.name_zh ?? null,
  pricingMethod: r.pricing_method ?? 'NORM_BASED',
  custom: r.pricing_method && r.pricing_method !== 'NORM_BASED' ? { vl: r.custom_vl ?? 0, nc: r.custom_nc ?? 0, m: r.custom_m ?? 0 } : null,
  priceSource: r.price_source,
  quote:
    r.pricing_method === 'MARKET_QUOTE'
      ? { supplier: r.quote_supplier, number: r.quote_no, date: r.quote_date, validUntil: r.quote_valid_until, vatStatus: r.quote_vat, vatRate: r.quote_vat_rate }
      : null,
  quantitySource: r.quantity_source ?? 'MANUAL',
  mixCode: r.mix_code,
  normCodeRaw: r.norm_code_raw,
  codeCheck: r.code_check,
  codeCheckNote: r.code_check_note,
});

export interface PricingInput {
  pricingMethod: 'NORM_BASED' | 'CUSTOM_GTT' | 'MARKET_QUOTE';
  custom?: { vl?: number; nc?: number; m?: number } | null;
  priceSource?: string | null;
  quote?: EstimateItem['quote'];
}

export interface QuantityLineRow {
  id: number;
  description: string;
  expression: string;
  variables: Record<string, number>;
  sign: 1 | -1;
  unit: string | null;
  result: number | null;
  factor: number | null;
  sourceReference: string | null;
}

export type ItemSnapshot = Pick<EstimateItem, 'normCode' | 'name' | 'unit' | 'quantity' | 'quantityFormula' | 'codeStatus' | 'codeConfidence'> & {
  source: EstimateItem['source'];
};

interface ResourceRow {
  code: string;
  name: string;
  unit: string;
  type: ResourceType;
  base_price: number;
  is_sample: number;
}
const toResource = (r: ResourceRow): Resource & { isSample: boolean } => ({
  code: r.code,
  name: r.name,
  unit: r.unit,
  type: r.type,
  basePrice: r.base_price,
  isSample: !!r.is_sample,
});

export class Repo {
  constructor(
    readonly db: DB,
    readonly legal: LegalService,
  ) {}

  /** Effective price + source per resource (price books); set by the app. */
  priceResolver?: (projectId: number) => Record<string, ResolvedPrice>;

  /** Norm dataset of the project's legal set (TT38_2026 or TT12_2021). */
  datasetOf(projectId: number): string {
    return this.legal.get(this.getProject(projectId)!.legalSet).normDataset;
  }

  // ---------------- projects ----------------
  listProjects(userId: number, isAdmin: boolean): Project[] {
    const rows = isAdmin
      ? this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC, id DESC').all()
      : this.db.prepare('SELECT * FROM projects WHERE owner_id = ? ORDER BY updated_at DESC, id DESC').all(userId);
    return (rows as ProjectRow[]).map(toProject);
  }

  getProject(id: number): Project | undefined {
    const r = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    return r && toProject(r);
  }

  /** Load a project the user may access or throw 404. */
  requireProject(id: number, userId: number, isAdmin: boolean): Project {
    const p = this.getProject(id);
    if (!p || (!isAdmin && p.ownerId !== userId)) throw new HttpError(404, 'Không tìm thấy công trình');
    return p;
  }

  createProject(ownerId: number, data: Partial<Project>): Project {
    const info = this.db
      .prepare(
        `INSERT INTO projects (owner_id, name, owner_name, location, building_type, price_base_date, vat_rate, legal_set, price_date, gxdtt_tmdt, region, sub_area)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ownerId,
        data.name?.trim() || 'Công trình mới',
        data.ownerName ?? '',
        data.location ?? '',
        data.buildingType ?? 'dan_dung',
        data.priceBaseDate ?? '',
        data.vatRate ?? 8,
        data.legalSet ?? defaultLegalSetFor(data.priceDate),
        data.priceDate || null,
        data.gxdttTmdt ?? null,
        data.region || null,
        data.subArea || null,
      );
    return this.getProject(Number(info.lastInsertRowid))!;
  }

  updateProject(id: number, data: Partial<Project>): Project {
    const p = this.getProject(id)!;
    const next = { ...p, ...data };
    this.db
      .prepare(
        `UPDATE projects SET name = ?, owner_name = ?, location = ?, building_type = ?, price_base_date = ?,
         vat_rate = ?, cost_settings = ?, legal_set = ?, price_date = ?, gxdtt_tmdt = ?, region = ?, sub_area = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(
        next.name,
        next.ownerName,
        next.location,
        next.buildingType,
        next.priceBaseDate,
        next.vatRate,
        next.costSettings ? JSON.stringify(next.costSettings) : null,
        next.legalSet,
        next.priceDate || null,
        next.gxdttTmdt ?? null,
        next.region || null,
        next.subArea || null,
        id,
      );
    return this.getProject(id)!;
  }

  /** Any change invalidates an approval: the estimate goes back to draft and must be approved again. */
  setAutoPriceUpdate(id: number, on: boolean): Project {
    this.db.prepare('UPDATE projects SET auto_price_update = ? WHERE id = ?').run(on ? 1 : 0, id);
    return this.getProject(id)!;
  }

  touchProject(id: number): void {
    this.db.prepare(`UPDATE projects SET updated_at = datetime('now'), status = 'draft', approved_by = NULL, approved_at = NULL WHERE id = ?`).run(id);
  }

  approveProject(id: number, user: string): void {
    const auto = (
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM estimate_items i JOIN categories c ON c.id = i.category_id WHERE c.project_id = ? AND i.code_status = 'auto'`)
        .get(id) as { n: number }
    ).n;
    if (auto > 0) throw new HttpError(409, `Còn ${auto} công việc gắn mã tự động chưa được xác nhận – không thể duyệt dự toán.`);
    this.db.prepare(`UPDATE projects SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ?`).run(user, id);
  }

  unapproveProject(id: number): void {
    this.db.prepare(`UPDATE projects SET status = 'draft', approved_by = NULL, approved_at = NULL WHERE id = ?`).run(id);
  }

  deleteProject(id: number): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  copyProject(id: number, ownerId: number): Project {
    return this.db.transaction(() => {
      const src = this.getProject(id)!;
      const copy = this.createProject(ownerId, { ...src, name: `${src.name} (bản sao)` });
      this.updateProject(copy.id, { costSettings: src.costSettings });
      for (const cat of this.listCategories(id)) {
        const newCat = this.createCategory(copy.id, cat.name, cat.order);
        this.db
          .prepare(
            `INSERT INTO estimate_items (category_id, sort_order, norm_code, name, unit, quantity, quantity_formula, note)
             SELECT ?, sort_order, norm_code, name, unit, quantity, quantity_formula, note FROM estimate_items WHERE category_id = ?`,
          )
          .run(newCat.id, cat.id);
      }
      this.db
        .prepare(`INSERT INTO project_prices (project_id, resource_code, price) SELECT ?, resource_code, price FROM project_prices WHERE project_id = ?`)
        .run(copy.id, id);
      this.db
        .prepare(
          `INSERT INTO project_price_books (project_id, book_id, resource_type, priority) SELECT ?, book_id, resource_type, priority FROM project_price_books WHERE project_id = ?`,
        )
        .run(copy.id, id);
      this.updateProject(copy.id, { region: src.region, subArea: src.subArea, gxdttTmdt: src.gxdttTmdt, priceDate: src.priceDate, legalSet: src.legalSet });
      return this.getProject(copy.id)!;
    })();
  }

  // ---------------- categories ----------------
  listCategories(projectId: number): Category[] {
    return (
      this.db.prepare('SELECT id, name, sort_order, tt_rate FROM categories WHERE project_id = ? ORDER BY sort_order, id').all(projectId) as {
        id: number;
        name: string;
        sort_order: number;
        tt_rate: number | null;
      }[]
    ).map((r) => ({ id: r.id, name: r.name, order: r.sort_order, ttRate: r.tt_rate }));
  }

  getCategory(projectId: number, id: number): Category {
    const c = this.listCategories(projectId).find((x) => x.id === id);
    if (!c) throw new HttpError(404, 'Không tìm thấy hạng mục');
    return c;
  }

  createCategory(projectId: number, name: string, order?: number): Category {
    const max = (this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories WHERE project_id = ?').get(projectId) as { m: number }).m;
    const info = this.db
      .prepare('INSERT INTO categories (project_id, name, sort_order) VALUES (?, ?, ?)')
      .run(projectId, name.trim() || 'Hạng mục mới', order ?? max + 1);
    this.touchProject(projectId);
    return { id: Number(info.lastInsertRowid), name, order: order ?? max + 1 };
  }

  updateCategory(projectId: number, id: number, data: { name?: string; order?: number; ttRate?: number | null }): void {
    const c = this.getCategory(projectId, id);
    this.db
      .prepare('UPDATE categories SET name = ?, sort_order = ?, tt_rate = ? WHERE id = ?')
      .run(data.name ?? c.name, data.order ?? c.order, data.ttRate !== undefined ? data.ttRate : c.ttRate ?? null, id);
    this.touchProject(projectId);
  }

  deleteCategory(projectId: number, id: number): void {
    this.getCategory(projectId, id);
    this.db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    this.touchProject(projectId);
  }

  // ---------------- items ----------------
  listItems(projectId: number): EstimateItem[] {
    return (
      this.db
        .prepare(
          `SELECT i.* FROM estimate_items i JOIN categories c ON c.id = i.category_id
           WHERE c.project_id = ? ORDER BY c.sort_order, c.id, i.sort_order, i.id`,
        )
        .all(projectId) as ItemRow[]
    ).map(toItem);
  }

  getItem(projectId: number, id: number): EstimateItem {
    const r = this.db
      .prepare('SELECT i.* FROM estimate_items i JOIN categories c ON c.id = i.category_id WHERE c.project_id = ? AND i.id = ?')
      .get(projectId, id) as ItemRow | undefined;
    if (!r) throw new HttpError(404, 'Không tìm thấy công tác');
    return toItem(r);
  }

  createItem(
    projectId: number,
    data: {
      categoryId: number;
      normCode?: string;
      name?: string;
      unit?: string;
      quantity?: number;
      quantityFormula?: string | null;
      note?: string | null;
      order?: number;
      codeStatus?: EstimateItem['codeStatus'];
      source?: EstimateItem['source'];
      sourceRawText?: string | null;
      sourceFlags?: string[];
      nameZh?: string | null;
      pricing?: PricingInput;
      quantitySource?: string;
      normCodeRaw?: string | null;
      codeCheck?: EstimateItem['codeCheck'];
      codeCheckNote?: string | null;
    },
  ): EstimateItem {
    this.getCategory(projectId, data.categoryId);
    const code = (data.normCode ?? '').trim().toUpperCase();
    const norm = code ? this.getNorm(code, this.datasetOf(projectId)) : undefined;
    const max = (this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM estimate_items WHERE category_id = ?').get(data.categoryId) as { m: number }).m;
    const info = this.db
      .prepare(
        `INSERT INTO estimate_items (category_id, sort_order, norm_code, name, unit, quantity, quantity_formula, note, code_status,
           source_file, source_sheet, source_row, source_description, source_quantity, source_unit, source_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.categoryId,
        data.order ?? max + 1,
        norm?.code ?? code,
        data.name ?? norm?.name ?? '',
        data.unit ?? norm?.unit ?? '',
        data.quantity ?? 0,
        data.quantityFormula ?? null,
        data.note ?? null,
        data.codeStatus ?? (code ? 'manual' : ''),
        data.source?.file ?? null,
        data.source?.sheet ?? null,
        data.source?.row ?? null,
        data.source?.description ?? null,
        data.source?.quantity ?? null,
        data.source?.unit ?? null,
        data.source?.code ?? null,
      );
    const newId = Number(info.lastInsertRowid);
    this.db
      .prepare('UPDATE estimate_items SET source_raw_text = ?, source_flags = ?, quantity_source = ? WHERE id = ?')
      .run(data.sourceRawText ?? null, data.sourceFlags?.length ? JSON.stringify(data.sourceFlags) : null, data.quantitySource ?? (data.quantityFormula ? 'FORMULA' : 'MANUAL'), newId);
    if (data.nameZh) this.db.prepare('UPDATE estimate_items SET name_zh = ? WHERE id = ?').run(data.nameZh, newId);
    if (data.source?.cells) this.db.prepare('UPDATE estimate_items SET source_cells = ? WHERE id = ?').run(JSON.stringify(data.source.cells), newId);
    if (data.normCodeRaw !== undefined || data.codeCheck !== undefined) {
      this.db.prepare('UPDATE estimate_items SET norm_code_raw = ?, code_check = ?, code_check_note = ? WHERE id = ?').run(data.normCodeRaw ?? null, data.codeCheck ?? null, data.codeCheckNote ?? null, newId);
    }
    if (data.pricing) this.setPricing(projectId, newId, data.pricing, false);
    this.touchProject(projectId);
    return this.getItem(projectId, newId);
  }

  /** Pricing method of an item: norm-based, custom (GTT) or market quote; custom prices need a source. */
  setPricing(projectId: number, itemId: number, p: PricingInput, touch = true): EstimateItem {
    this.getItem(projectId, itemId);
    const custom = p.pricingMethod === 'NORM_BASED' ? null : p.custom ?? {};
    const q = p.pricingMethod === 'MARKET_QUOTE' ? p.quote ?? {} : null;
    this.db
      .prepare(
        `UPDATE estimate_items SET pricing_method = ?, custom_vl = ?, custom_nc = ?, custom_m = ?, price_source = ?,
         quote_supplier = ?, quote_no = ?, quote_date = ?, quote_valid_until = ?, quote_vat = ?, quote_vat_rate = ? WHERE id = ?`,
      )
      .run(
        p.pricingMethod,
        custom ? custom.vl ?? 0 : null,
        custom ? custom.nc ?? 0 : null,
        custom ? custom.m ?? 0 : null,
        p.pricingMethod === 'NORM_BASED' ? null : p.priceSource ?? null,
        q?.supplier ?? null,
        q?.number ?? null,
        q?.date ?? null,
        q?.validUntil ?? null,
        q?.vatStatus ?? null,
        q?.vatRate ?? null,
        itemId,
      );
    if (touch) this.touchProject(projectId);
    return this.getItem(projectId, itemId);
  }

  /** Selected TT 38/2026 Phụ lục VII mix design for this item's "Vữa..." resource (null clears it). */
  setMixCode(projectId: number, itemId: number, mixCode: string | null): EstimateItem {
    this.getItem(projectId, itemId);
    if (mixCode && !this.getMixDesign(mixCode)) throw new HttpError(404, 'Không tìm thấy mã cấp phối');
    this.db.prepare('UPDATE estimate_items SET mix_code = ? WHERE id = ?').run(mixCode, itemId);
    this.touchProject(projectId);
    return this.getItem(projectId, itemId);
  }

  // ---------------- mix designs (TT 38/2026 Phụ lục VII) ----------------
  listMixDesigns(filter: { kind?: MixKind; grade?: string; q?: string } = {}): Pick<MixDesign, 'code' | 'section' | 'spec' | 'kind' | 'grade' | 'page' | 'status'>[] {
    const conds: string[] = [];
    const args: unknown[] = [];
    if (filter.kind) {
      conds.push('kind = ?');
      args.push(filter.kind);
    }
    if (filter.grade) {
      conds.push('grade = ?');
      args.push(filter.grade);
    }
    if (filter.q) {
      conds.push('(code LIKE ? OR section LIKE ? OR spec LIKE ?)');
      args.push(`%${filter.q}%`, `%${filter.q}%`, `%${filter.q}%`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    return this.db
      .prepare(`SELECT code, section, spec, kind, grade, page, status FROM mix_designs ${where} ORDER BY code LIMIT 200`)
      .all(...args) as Pick<MixDesign, 'code' | 'section' | 'spec' | 'kind' | 'grade' | 'page' | 'status'>[];
  }

  getMixDesign(code: string): MixDesign | undefined {
    const d = this.db.prepare('SELECT code, section, spec, kind, grade, page, status FROM mix_designs WHERE code = ?').get(code) as
      | Pick<MixDesign, 'code' | 'section' | 'spec' | 'kind' | 'grade' | 'page' | 'status'>
      | undefined;
    if (!d) return undefined;
    const materials = this.db.prepare('SELECT material, unit, qty, resource_code FROM mix_design_materials WHERE mix_code = ? ORDER BY sort_order').all(code) as {
      material: string;
      unit: string;
      qty: number;
      resource_code: string | null;
    }[];
    return { ...d, materials: materials.map((m) => ({ material: m.material, unit: m.unit, qty: m.qty, resourceCode: m.resource_code })) };
  }

  // ---------------- quantity lines ----------------
  quantityLines(itemId: number): QuantityLineRow[] {
    return (
      this.db.prepare('SELECT * FROM quantity_lines WHERE item_id = ? ORDER BY sort_order, id').all(itemId) as {
        id: number;
        description: string;
        expression: string;
        variables_json: string;
        sign: 1 | -1;
        unit: string | null;
        result: number | null;
        factor: number | null;
        source_reference: string | null;
      }[]
    ).map((r) => ({
      id: r.id,
      description: r.description,
      expression: r.expression,
      variables: JSON.parse(r.variables_json),
      sign: r.sign,
      unit: r.unit,
      result: r.result,
      factor: r.factor,
      sourceReference: r.source_reference,
    }));
  }

  /**
   * Attach imported "diễn giải khối lượng" rows (Dài × Rộng × Cao × Số cấu kiện) to an item WITHOUT changing the item quantity,
   * which stays the file's value (the caller warns when the sum differs).
   */
  attachImportedLines(itemId: number, lines: { description: string; expression: string; result: number | null }[]) {
    const ins = this.db.prepare('INSERT INTO quantity_lines (item_id, sort_order, description, expression, variables_json, sign, unit, result, factor) VALUES (?, ?, ?, ?, ?, 1, NULL, ?, 1)');
    lines.forEach((l, i) => ins.run(itemId, i + 1, l.description, l.expression || String(l.result ?? 0), '{}', l.result));
  }

  /** Replace the quantity lines of an item; the item quantity becomes their sum. */
  saveQuantityLines(projectId: number, itemId: number, lines: QuantityLineInput[]) {
    const item = this.getItem(projectId, itemId);
    const calc = computeQuantityLines(lines, item.unit);
    if (calc.errors) {
      const first = calc.lines.find((l) => l.error)!;
      throw new HttpError(400, `Dòng ${calc.lines.indexOf(first) + 1}: ${first.error}`);
    }
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM quantity_lines WHERE item_id = ?').run(itemId);
      const ins = this.db.prepare(
        'INSERT INTO quantity_lines (item_id, sort_order, description, expression, variables_json, sign, unit, result, factor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      calc.lines.forEach((l, i) =>
        ins.run(itemId, i + 1, l.description ?? '', l.expression, JSON.stringify(l.variables ?? {}), l.sign ?? 1, l.unit || null, l.result, l.factor),
      );
      if (lines.length) {
        this.db.prepare(`UPDATE estimate_items SET quantity = ?, quantity_formula = NULL, quantity_source = 'LINES' WHERE id = ?`).run(calc.total, itemId);
      } else {
        this.db.prepare(`UPDATE estimate_items SET quantity_source = 'MANUAL' WHERE id = ? AND quantity_source = 'LINES'`).run(itemId);
      }
      this.touchProject(projectId);
    })();
    return { total: calc.total, lines: calc.lines, item: this.getItem(projectId, itemId) };
  }

  updateItem(projectId: number, id: number, data: Partial<EstimateItem>): EstimateItem {
    const cur = this.getItem(projectId, id);
    const next = { ...cur, ...data };
    // Changing the norm code re-fills name and unit from the norm library.
    if (data.normCode !== undefined && data.normCode.trim().toUpperCase() !== cur.normCode) {
      next.normCode = data.normCode.trim().toUpperCase();
      next.codeStatus = data.codeStatus ?? (next.normCode ? 'manual' : '');
      next.codeConfidence = data.codeConfidence ?? null;
      const norm = this.getNorm(next.normCode, this.datasetOf(projectId));
      if (norm) {
        next.normCode = norm.code;
        if (data.name === undefined) next.name = norm.name;
        if (data.unit === undefined) next.unit = norm.unit;
      }
    }
    if (next.categoryId !== cur.categoryId) this.getCategory(projectId, next.categoryId);
    this.db
      .prepare(
        `UPDATE estimate_items SET category_id = ?, sort_order = ?, norm_code = ?, name = ?, unit = ?, quantity = ?,
         quantity_formula = ?, note = ?, code_status = ?, code_confidence = ? WHERE id = ?`,
      )
      .run(
        next.categoryId,
        next.order,
        next.normCode,
        next.name,
        next.unit,
        next.quantity,
        next.quantityFormula ?? null,
        next.note ?? null,
        next.codeStatus ?? '',
        next.codeConfidence ?? null,
        id,
      );
    this.touchProject(projectId);
    return this.getItem(projectId, id);
  }

  deleteItem(projectId: number, id: number): void {
    this.getItem(projectId, id);
    this.db.prepare('DELETE FROM estimate_items WHERE id = ?').run(id);
    this.touchProject(projectId);
  }

  // ---------------- code suggestion ----------------
  private indexes = new Map<string, NormIndex<Norm>>();

  /** Suggestion index for a norm dataset (rebuilt after imports). */
  normIndex(dataset: string): NormIndex<Norm> {
    let idx = this.indexes.get(dataset);
    if (!idx) {
      const rows = this.db.prepare('SELECT code, name, unit, grp FROM norms WHERE dataset = ?').all(dataset) as { code: string; name: string; unit: string; grp: string }[];
      idx = new NormIndex(rows.map((r) => ({ code: r.code, name: r.name, unit: r.unit, group: r.grp })));
      this.indexes.set(dataset, idx);
    }
    return idx;
  }

  invalidateNormIndex(): void {
    this.indexes.clear();
  }

  /** Items that still need a norm code (no code, or code not in the project's norm dataset). */
  unassignedItems(projectId: number): EstimateItem[] {
    const ds = this.datasetOf(projectId);
    // Items priced from the imported file (CUSTOM_GTT "Giá file") still need a norm code; deliberate GTT / quotes and TB/VT do not.
    const fromFile = (i: EstimateItem) => i.pricingMethod === 'CUSTOM_GTT' && /^File Excel/.test(i.priceSource ?? '');
    return this.listItems(projectId).filter((i) => ((i.pricingMethod ?? 'NORM_BASED') === 'NORM_BASED' || fromFile(i)) && i.codeStatus !== 'tbvt' && (!i.normCode || !this.getNorm(i.normCode, ds)));
  }

  suggestFor(projectId: number, item: EstimateItem, limit = 5) {
    const text = item.source?.description || item.name;
    const unit = item.source?.unit || item.unit || undefined;
    return this.normIndex(this.datasetOf(projectId)).suggest(text, unit, limit, { allowRepair: this.isRepairContext(projectId, item, text) });
  }

  /** PL6 repair norms (S*) are only suggested for a project / hạng mục / work that is marked "sửa chữa". */
  isRepairContext(projectId: number, item: EstimateItem, text: string): boolean {
    const re = /\b(sua chua|cai tao|bao tri|nang cap|tu sua)\b/;
    const p = this.db.prepare('SELECT name, location FROM projects WHERE id = ?').get(projectId) as { name: string; location: string } | undefined;
    const c = this.db.prepare('SELECT name FROM categories WHERE id = ?').get(item.categoryId) as { name: string } | undefined;
    return [p?.name, c?.name, text, item.name].some((t) => !!t && re.test(normalizeText(t)));
  }

  snapshotItem(projectId: number, itemId: number): ItemSnapshot {
    const i = this.getItem(projectId, itemId);
    return {
      normCode: i.normCode,
      name: i.name,
      unit: i.unit,
      quantity: i.quantity,
      quantityFormula: i.quantityFormula ?? null,
      codeStatus: i.codeStatus,
      codeConfidence: i.codeConfidence ?? null,
      source: i.source ?? null,
    };
  }

  restoreItem(projectId: number, itemId: number, snap: ItemSnapshot): void {
    this.getItem(projectId, itemId);
    this.db
      .prepare(
        `UPDATE estimate_items SET norm_code = ?, name = ?, unit = ?, quantity = ?, quantity_formula = ?, code_status = ?, code_confidence = ?,
         source_description = ?, source_quantity = ?, source_unit = ? WHERE id = ?`,
      )
      .run(
        snap.normCode,
        snap.name,
        snap.unit,
        snap.quantity,
        snap.quantityFormula,
        snap.codeStatus ?? '',
        snap.codeConfidence,
        snap.source?.description ?? null,
        snap.source?.quantity ?? null,
        snap.source?.unit ?? null,
        itemId,
      );
    this.touchProject(projectId);
  }

  /**
   * Set the norm code of an item. The original description, quantity and unit are kept in the
   * source_* columns (filled from the current values the first time), and the quantity is
   * converted into the norm unit (e.g. 250 m3 → 2,5 100m3).
   */
  assignCode(projectId: number, itemId: number, normCode: string, status: 'auto' | 'confirmed' | 'manual', confidence: number | null = null): EstimateItem {
    const item = this.getItem(projectId, itemId);
    const norm = this.getNorm(normCode, this.datasetOf(projectId));
    if (!norm) throw new HttpError(404, `Không tìm thấy mã định mức ${normCode}`);
    const srcDesc = item.source?.description ?? item.name;
    const srcUnit = item.source?.unit ?? item.unit;
    const srcQty = item.source?.quantity ?? item.quantity;
    const factor = srcUnit ? unitFactor(srcUnit, norm.unit) : 1;
    const quantity = factor === null ? item.quantity : srcQty * factor;
    this.db
      .prepare(
        `UPDATE estimate_items SET norm_code = ?, name = ?, unit = ?, quantity = ?, quantity_formula = ?, code_status = ?, code_confidence = ?,
         source_description = ?, source_quantity = ?, source_unit = ? WHERE id = ?`,
      )
      .run(
        norm.code,
        norm.name,
        norm.unit,
        quantity,
        factor !== null && factor !== 1 ? null : item.quantityFormula ?? null,
        status,
        confidence,
        srcDesc,
        srcQty,
        srcUnit,
        itemId,
      );
    this.touchProject(projectId);
    return this.getItem(projectId, itemId);
  }

  // ---------------- norms & resources ----------------
  getNorm(code: string, dataset: string): Norm | undefined {
    const r = this.db
      .prepare(
        `SELECT code, name, unit, grp, appendix, section_code, section_title, work, variant, page, source_file, source_sha256, status
         FROM norms WHERE dataset = ? AND code = ? COLLATE NOCASE`,
      )
      .get(dataset, code) as
      | {
          code: string;
          name: string;
          unit: string;
          grp: string;
          appendix: string | null;
          section_code: string | null;
          section_title: string | null;
          work: string | null;
          variant: string | null;
          page: number | null;
          source_file: string | null;
          source_sha256: string | null;
          status: string | null;
        }
      | undefined;
    return (
      r && {
        code: r.code,
        name: r.name,
        unit: r.unit,
        group: r.grp,
        appendix: r.appendix ?? undefined,
        sectionCode: r.section_code ?? undefined,
        sectionTitle: r.section_title ?? undefined,
        work: r.work ?? undefined,
        variant: r.variant ?? undefined,
        page: r.page ?? undefined,
        sourceFile: r.source_file ?? undefined,
        sourceSha256: r.source_sha256 ?? undefined,
        status: r.status || undefined,
      }
    );
  }

  getNormResources(code: string, dataset: string): (NormResource & Resource)[] {
    return (
      this.db
        .prepare(
          `SELECT nr.norm_code, nr.resource_code, nr.consumption, nr.pct_base, r.* FROM norm_resources nr
           JOIN resources r ON r.code = nr.resource_code WHERE nr.dataset = ? AND nr.norm_code = ?
           ORDER BY CASE r.type WHEN 'VL' THEN 0 WHEN 'NC' THEN 1 ELSE 2 END, r.code`,
        )
        .all(dataset, code) as (ResourceRow & { norm_code: string; resource_code: string; consumption: number; pct_base: 'VL' | 'M' | null })[]
    ).map((r) => ({ ...toResource(r), normCode: r.norm_code, resourceCode: r.resource_code, consumption: r.consumption, pctBase: r.pct_base ?? undefined }));
  }

  /** Diacritic-insensitive search by code or name. */
  /**
   * Norm search: code prefixes ("AF.1", "af11"), then relevance ranking of the description
   * (abbreviations, parameters, no diacritics); falls back to plain token search.
   */
  searchNorms(query: string, dataset: string, limit = 30): Norm[] {
    const idx = this.normIndex(dataset);
    const byCode = idx.byCodePrefix(query.trim());
    if (byCode.length) return byCode.slice(0, limit);
    const ranked = idx.suggest(query, null, limit);
    if (ranked.length) {
      const top = ranked[0].score;
      return ranked.filter((r) => r.score >= top * 0.5).map((r) => r.norm);
    }
    return this.plainSearchNorms(query, dataset, limit);
  }

  private plainSearchNorms(query: string, dataset: string, limit: number): Norm[] {
    const all = this.db.prepare('SELECT code, name, unit, grp FROM norms WHERE dataset = ?').all(dataset) as { code: string; name: string; unit: string; grp: string }[];
    return searchByCodeOrName(all, query, limit).map((h) => ({ code: h.item.code, name: h.item.name, unit: h.item.unit, group: h.item.grp }));
  }

  listResources(): (Resource & { isSample: boolean })[] {
    return (this.db.prepare('SELECT * FROM resources ORDER BY type, code').all() as ResourceRow[]).map(toResource);
  }

  getResource(code: string): Resource | undefined {
    const r = this.db.prepare('SELECT * FROM resources WHERE code = ? COLLATE NOCASE').get(code) as ResourceRow | undefined;
    return r && toResource(r);
  }

  searchResources(query: string, limit = 30): Resource[] {
    return searchByCodeOrName(this.listResources(), query, limit).map((h) => h.item);
  }

  hasSampleData(): boolean {
    const r = this.db.prepare('SELECT (SELECT COUNT(*) FROM norms WHERE is_sample = 1) + (SELECT COUNT(*) FROM resources WHERE is_sample = 1) AS n').get() as { n: number };
    return r.n > 0;
  }

  upsertResource(r: Resource, isSample = false): void {
    this.db
      .prepare(
        `INSERT INTO resources (code, name, unit, type, base_price, name_search, is_sample) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET name = excluded.name, unit = excluded.unit, type = excluded.type,
         base_price = excluded.base_price, name_search = excluded.name_search, is_sample = excluded.is_sample`,
      )
      .run(r.code, r.name, r.unit, r.type, r.basePrice, normalizeText(`${r.code} ${r.name}`), isSample ? 1 : 0);
  }

  /** Norm-based unit cost (VL/NC/M per unit of the norm) at the project's effective prices. */
  normUnitCost(dataset: string, code: string, projectId: number) {
    const nrs = this.getNormResources(code, dataset);
    if (!nrs.length) return null;
    const resolved = this.priceResolver?.(projectId);
    const prices = resolved ? Object.fromEntries(Object.entries(resolved).map(([k, v]) => [k, v.price])) : this.projectPrices(projectId);
    return computeUnitCost(
      nrs.map((n) => ({ normCode: code, resourceCode: n.resourceCode, consumption: n.consumption, pctBase: n.pctBase })),
      new Map(nrs.map((n) => [n.code, n as Resource])),
      prices,
    );
  }

  // ---------------- prices ----------------
  projectPrices(projectId: number): Record<string, number> {
    const rows = this.db.prepare('SELECT resource_code, price FROM project_prices WHERE project_id = ?').all(projectId) as {
      resource_code: string;
      price: number;
    }[];
    return Object.fromEntries(rows.map((r) => [r.resource_code, r.price]));
  }

  getProjectPrice(projectId: number, code: string): number | null {
    const r = this.db.prepare('SELECT price FROM project_prices WHERE project_id = ? AND resource_code = ?').get(projectId, code) as
      | { price: number }
      | undefined;
    return r ? r.price : null;
  }

  /** Set (or clear with null) the project price of a resource. */
  setProjectPrice(projectId: number, code: string, price: number | null): void {
    if (price === null) this.db.prepare('DELETE FROM project_prices WHERE project_id = ? AND resource_code = ?').run(projectId, code);
    else
      this.db
        .prepare(
          `INSERT INTO project_prices (project_id, resource_code, price) VALUES (?, ?, ?)
           ON CONFLICT(project_id, resource_code) DO UPDATE SET price = excluded.price`,
        )
        .run(projectId, code, price);
    this.touchProject(projectId);
  }

  effectivePrice(projectId: number, code: string): number {
    return this.getProjectPrice(projectId, code) ?? this.getResource(code)?.basePrice ?? 0;
  }

  // ---------------- calculation ----------------
  /** Full calculated estimate for a project. */
  calculate(projectId: number, opts: { resolved?: Record<string, ResolvedPrice> } = {}) {
    const project = this.getProject(projectId)!;
    const categories = this.listCategories(projectId);
    const items = this.listItems(projectId);
    const codes = [...new Set(items.map((i) => i.normCode).filter(Boolean))];
    const normResources: NormResource[] = [];
    const resourceCodes = new Set<string>();
    const legalSet = this.legal.get(project.legalSet);
    const stmt = this.db.prepare('SELECT norm_code, resource_code, consumption, pct_base FROM norm_resources WHERE dataset = ? AND norm_code = ?');
    const byNormCode = new Map<string, NormResource[]>();
    for (const c of codes) {
      const list: NormResource[] = [];
      for (const r of stmt.all(legalSet.normDataset, c) as { norm_code: string; resource_code: string; consumption: number; pct_base: 'VL' | 'M' | null }[]) {
        const nr: NormResource = { normCode: r.norm_code, resourceCode: r.resource_code, consumption: r.consumption, pctBase: r.pct_base ?? undefined };
        normResources.push(nr);
        list.push(nr);
        resourceCodes.add(r.resource_code);
      }
      byNormCode.set(c, list);
    }
    const resStmt = this.db.prepare('SELECT * FROM resources WHERE code = ?');
    const resourceRows = new Map<string, ResourceRow>();
    for (const c of resourceCodes) {
      const row = resStmt.get(c) as ResourceRow | undefined;
      if (row) resourceRows.set(c, row);
    }

    // Mix-design expansion (TT 38/2026 Phụ lục VII): an item with a chosen mix code gets its norm's
    // "Vữa..." resource line replaced by cement/sand/stone/water, scaled by the vữa consumption.
    const itemsForCalc = items.map((it) => {
      if (!it.mixCode || !it.normCode) return it;
      const nrs = byNormCode.get(it.normCode);
      if (!nrs) return it;
      const vuaLines = nrs.filter((nr) => !nr.pctBase && isMixResourceName(resourceRows.get(nr.resourceCode)?.name ?? ''));
      if (vuaLines.length !== 1) return it;
      const mix = this.getMixDesign(it.mixCode);
      if (!mix) return it;
      const expanded = expandMixDesign(nrs, vuaLines[0].resourceCode, vuaLines[0].consumption, mix);
      for (const nr of expanded) {
        if (!resourceRows.has(nr.resourceCode)) {
          const row = resStmt.get(nr.resourceCode) as ResourceRow | undefined;
          if (row) resourceRows.set(nr.resourceCode, row);
        }
      }
      return { ...it, normResourcesOverride: expanded };
    });
    const resources = [...resourceRows.values()].map(toResource);
    const resolved = opts.resolved ?? this.priceResolver?.(projectId);
    const effective = resolved ? Object.fromEntries(Object.entries(resolved).map(([k, v]) => [k, v.price])) : this.projectPrices(projectId);
    const estimate = computeEstimate({ categories, items: itemsForCalc, normResources, resources, projectPrices: effective });
    const priceSources = Object.fromEntries(
      estimate.resourceSummary.map((r) => [r.code, resolved?.[r.code]?.source ?? { kind: 'base', label: 'Giá gốc thư viện' }]),
    );
    const cost = computeProjectCost(legalSet, estimate.total, project.costSettings, project.buildingType, project.vatRate, {
      gxdttTmdt: project.gxdttTmdt,
      categories: estimate.categories.map((c) => ({ id: c.id, name: c.name, direct: c.total, ttRate: c.ttRate })),
    });
    const dateWarning = legalSetDateWarning(project.legalSet, project.priceDate);
    return {
      project,
      ...estimate,
      legalSet: { id: legalSet.id, label: legalSet.label, status: legalSet.status, normDataset: legalSet.normDataset, documents: legalSet.documents },
      provisionalRates: Object.values(legalSet.tables).some((t) => t.status !== 'verified'),
      settings: cost.settings,
      ratesSource: cost.ratesSource,
      costSummary: cost.costSummary,
      totalEstimate: cost.totalEstimate,
      warnings: dateWarning ? [dateWarning, ...cost.warnings] : cost.warnings,
      notes: cost.notes ?? [],
      priceSources,
    };
  }
}

export type Calculation = ReturnType<Repo['calculate']>;

import {
  computeEstimate,
  computeProjectCost,
  defaultLegalSetFor,
  legalSetDateWarning,
  normalizeText,
  searchByCodeOrName,
  type BuildingType,
  type Category,
  type EstimateItem,
  type LegalSetId,
  type Norm,
  type NormResource,
  type ProjectCostSettings,
  type Resource,
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
}
const toItem = (r: ItemRow): EstimateItem => ({
  id: r.id,
  categoryId: r.category_id,
  order: r.sort_order,
  normCode: r.norm_code,
  name: r.name,
  unit: r.unit,
  quantity: r.quantity,
  quantityFormula: r.quantity_formula,
  note: r.note,
});

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
        `INSERT INTO projects (owner_id, name, owner_name, location, building_type, price_base_date, vat_rate, legal_set, price_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
    return this.getProject(Number(info.lastInsertRowid))!;
  }

  updateProject(id: number, data: Partial<Project>): Project {
    const p = this.getProject(id)!;
    const next = { ...p, ...data };
    this.db
      .prepare(
        `UPDATE projects SET name = ?, owner_name = ?, location = ?, building_type = ?, price_base_date = ?,
         vat_rate = ?, cost_settings = ?, legal_set = ?, price_date = ?, updated_at = datetime('now') WHERE id = ?`,
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
        id,
      );
    return this.getProject(id)!;
  }

  touchProject(id: number): void {
    this.db.prepare(`UPDATE projects SET updated_at = datetime('now') WHERE id = ?`).run(id);
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
      return this.getProject(copy.id)!;
    })();
  }

  // ---------------- categories ----------------
  listCategories(projectId: number): Category[] {
    return (
      this.db.prepare('SELECT id, name, sort_order FROM categories WHERE project_id = ? ORDER BY sort_order, id').all(projectId) as {
        id: number;
        name: string;
        sort_order: number;
      }[]
    ).map((r) => ({ id: r.id, name: r.name, order: r.sort_order }));
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

  updateCategory(projectId: number, id: number, data: { name?: string; order?: number }): void {
    const c = this.getCategory(projectId, id);
    this.db.prepare('UPDATE categories SET name = ?, sort_order = ? WHERE id = ?').run(data.name ?? c.name, data.order ?? c.order, id);
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
    data: { categoryId: number; normCode?: string; name?: string; unit?: string; quantity?: number; quantityFormula?: string | null; note?: string | null; order?: number },
  ): EstimateItem {
    this.getCategory(projectId, data.categoryId);
    const code = (data.normCode ?? '').trim().toUpperCase();
    const norm = code ? this.getNorm(code, this.datasetOf(projectId)) : undefined;
    const max = (this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM estimate_items WHERE category_id = ?').get(data.categoryId) as { m: number }).m;
    const info = this.db
      .prepare(
        `INSERT INTO estimate_items (category_id, sort_order, norm_code, name, unit, quantity, quantity_formula, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
    this.touchProject(projectId);
    return this.getItem(projectId, Number(info.lastInsertRowid));
  }

  updateItem(projectId: number, id: number, data: Partial<EstimateItem>): EstimateItem {
    const cur = this.getItem(projectId, id);
    const next = { ...cur, ...data };
    // Changing the norm code re-fills name and unit from the norm library.
    if (data.normCode !== undefined && data.normCode.trim().toUpperCase() !== cur.normCode) {
      next.normCode = data.normCode.trim().toUpperCase();
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
         quantity_formula = ?, note = ? WHERE id = ?`,
      )
      .run(next.categoryId, next.order, next.normCode, next.name, next.unit, next.quantity, next.quantityFormula ?? null, next.note ?? null, id);
    this.touchProject(projectId);
    return this.getItem(projectId, id);
  }

  deleteItem(projectId: number, id: number): void {
    this.getItem(projectId, id);
    this.db.prepare('DELETE FROM estimate_items WHERE id = ?').run(id);
    this.touchProject(projectId);
  }

  // ---------------- norms & resources ----------------
  getNorm(code: string, dataset: string): Norm | undefined {
    const r = this.db.prepare('SELECT code, name, unit, grp FROM norms WHERE dataset = ? AND code = ? COLLATE NOCASE').get(dataset, code) as
      | { code: string; name: string; unit: string; grp: string }
      | undefined;
    return r && { code: r.code, name: r.name, unit: r.unit, group: r.grp };
  }

  getNormResources(code: string, dataset: string): (NormResource & Resource)[] {
    return (
      this.db
        .prepare(
          `SELECT nr.norm_code, nr.resource_code, nr.consumption, r.* FROM norm_resources nr
           JOIN resources r ON r.code = nr.resource_code WHERE nr.dataset = ? AND nr.norm_code = ?
           ORDER BY CASE r.type WHEN 'VL' THEN 0 WHEN 'NC' THEN 1 ELSE 2 END, r.code`,
        )
        .all(dataset, code) as (ResourceRow & { norm_code: string; resource_code: string; consumption: number })[]
    ).map((r) => ({ ...toResource(r), normCode: r.norm_code, resourceCode: r.resource_code, consumption: r.consumption }));
  }

  /** Diacritic-insensitive search by code or name. */
  searchNorms(query: string, dataset: string, limit = 30): Norm[] {
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
  calculate(projectId: number) {
    const project = this.getProject(projectId)!;
    const categories = this.listCategories(projectId);
    const items = this.listItems(projectId);
    const codes = [...new Set(items.map((i) => i.normCode).filter(Boolean))];
    const normResources: NormResource[] = [];
    const resourceCodes = new Set<string>();
    const legalSet = this.legal.get(project.legalSet);
    const stmt = this.db.prepare('SELECT norm_code, resource_code, consumption FROM norm_resources WHERE dataset = ? AND norm_code = ?');
    for (const c of codes) {
      for (const r of stmt.all(legalSet.normDataset, c) as { norm_code: string; resource_code: string; consumption: number }[]) {
        normResources.push({ normCode: r.norm_code, resourceCode: r.resource_code, consumption: r.consumption });
        resourceCodes.add(r.resource_code);
      }
    }
    const resStmt = this.db.prepare('SELECT * FROM resources WHERE code = ?');
    const resources = [...resourceCodes]
      .map((c) => resStmt.get(c) as ResourceRow | undefined)
      .filter((r): r is ResourceRow => !!r)
      .map(toResource);
    const estimate = computeEstimate({ categories, items, normResources, resources, projectPrices: this.projectPrices(projectId) });
    const cost = computeProjectCost(legalSet, estimate.total, project.costSettings, project.buildingType, project.vatRate);
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
    };
  }
}

export type Calculation = ReturnType<Repo['calculate']>;

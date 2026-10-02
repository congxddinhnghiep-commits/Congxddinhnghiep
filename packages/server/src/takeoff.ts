import {
  computeElementTasks,
  computeQuickRow,
  computeRebarRow,
  evaluateManualFormula,
  formatNumber,
  rebarGroup,
  summarizeRebarByGroup,
  type ElementParams,
  type ElementType,
  type GeneratedTask,
  type RebarGroup,
} from '@dutoan/core';
import type { DB } from './db.js';
import { HttpError, type Repo } from './repo.js';

const round3 = (x: number): number => Math.round((x + Number.EPSILON) * 1000) / 1000;
const fmt = (n: number) => formatNumber(n, n % 1 === 0 ? 0 : 3);

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface StoryRow {
  id: number;
  projectId: number;
  name: string;
  heightM: number;
  elevationM: number;
  order: number;
}

export interface TakeoffElementRow {
  id: number;
  projectId: number;
  categoryId: number | null;
  storyId: number | null;
  type: ElementType;
  name: string;
  count: number;
  params: ElementParams;
  enabled: Record<string, boolean>;
  overrides: Record<string, { value: number; reason?: string | null }>;
  material: string | null;
  note: string | null;
  source: 'manual' | 'excel' | 'etabs';
  sourceRef: string | null;
  order: number;
}

export interface GeneratedTaskRow extends GeneratedTask {
  computedValue: number;
  overrideValue: number | null;
  overrideReason: string | null;
  normCode: string;
  codeStatus: '' | 'auto';
  confidence: number | null;
}

export interface ManualSheetRow {
  id: number;
  projectId: number;
  mode: 'expression' | 'quick';
  drawingName: string;
  category: string;
  expression: string | null;
  quick: { n: number; a: number; l: number; h: number } | null;
  result: number | null;
  targetItemId: number | null;
  order: number;
}

export interface RebarScheduleRow {
  id: number;
  projectId: number;
  elementId: number | null;
  cauKien: string;
  soHieu: string | null;
  shapeCode: string | null;
  lengths: (number | null)[];
  note: string | null;
  diaMm: number;
  chieuDai1ThanhMm: number | null;
  soCauKien: number;
  soThanh1CauKien: number;
  order: number;
  computed: { chieuDai1ThanhMm: number; tongChieuDaiM: number; tongTrongLuongKg: number; group: RebarGroup };
}

interface StoryRowDb {
  id: number;
  project_id: number;
  name: string;
  height_m: number;
  elevation_m: number;
  sort_order: number;
}
const toStory = (r: StoryRowDb): StoryRow => ({ id: r.id, projectId: r.project_id, name: r.name, heightM: r.height_m, elevationM: r.elevation_m, order: r.sort_order });

interface ElementRowDb {
  id: number;
  project_id: number;
  category_id: number | null;
  story_id: number | null;
  type: string;
  name: string;
  count: number;
  params_json: string;
  enabled_json: string;
  overrides_json: string;
  material: string | null;
  note: string | null;
  source: string;
  source_ref: string | null;
  sort_order: number;
}
const toElement = (r: ElementRowDb): TakeoffElementRow => ({
  id: r.id,
  projectId: r.project_id,
  categoryId: r.category_id,
  storyId: r.story_id,
  type: r.type as ElementType,
  name: r.name,
  count: r.count,
  params: JSON.parse(r.params_json),
  enabled: JSON.parse(r.enabled_json),
  overrides: JSON.parse(r.overrides_json),
  material: r.material,
  note: r.note,
  source: r.source as TakeoffElementRow['source'],
  sourceRef: r.source_ref,
  order: r.sort_order,
});

interface ManualRowDb {
  id: number;
  project_id: number;
  mode: string;
  drawing_name: string;
  category: string;
  expression: string | null;
  quick_n: number | null;
  quick_a: number | null;
  quick_l: number | null;
  quick_h: number | null;
  result: number | null;
  target_item_id: number | null;
  sort_order: number;
}
const toManual = (r: ManualRowDb): ManualSheetRow => ({
  id: r.id,
  projectId: r.project_id,
  mode: r.mode as ManualSheetRow['mode'],
  drawingName: r.drawing_name,
  category: r.category,
  expression: r.expression,
  quick: r.mode === 'quick' ? { n: r.quick_n ?? 0, a: r.quick_a ?? 0, l: r.quick_l ?? 0, h: r.quick_h ?? 0 } : null,
  result: r.result,
  targetItemId: r.target_item_id,
  order: r.sort_order,
});

interface RebarRowDb {
  id: number;
  project_id: number;
  element_id: number | null;
  cau_kien: string;
  so_hieu: string | null;
  shape_code: string | null;
  l1: number | null;
  l2: number | null;
  l3: number | null;
  l4: number | null;
  l5: number | null;
  l6: number | null;
  note: string | null;
  dia_mm: number;
  chieu_dai_1_thanh_mm: number | null;
  so_cau_kien: number;
  so_thanh_1_cau_kien: number;
  sort_order: number;
}
const toRebar = (r: RebarRowDb): RebarScheduleRow => {
  const lengths = [r.l1, r.l2, r.l3, r.l4, r.l5, r.l6];
  const computed = computeRebarRow({ diaMm: r.dia_mm, lengths, chieuDai1ThanhMm: r.chieu_dai_1_thanh_mm, soCauKien: r.so_cau_kien, soThanh1CauKien: r.so_thanh_1_cau_kien });
  return {
    id: r.id,
    projectId: r.project_id,
    elementId: r.element_id,
    cauKien: r.cau_kien,
    soHieu: r.so_hieu,
    shapeCode: r.shape_code,
    lengths,
    note: r.note,
    diaMm: r.dia_mm,
    chieuDai1ThanhMm: r.chieu_dai_1_thanh_mm,
    soCauKien: r.so_cau_kien,
    soThanh1CauKien: r.so_thanh_1_cau_kien,
    order: r.sort_order,
    computed,
  };
};

// ---------------------------------------------------------------------------
// Push to estimate (section F)
// ---------------------------------------------------------------------------

export interface PushLine {
  description: string;
  result: number;
  sourceReference: string;
}

export interface PushGroup {
  key: string;
  categoryId: number;
  storyId: number | null;
  templateKey: string;
  name: string;
  unit: string;
  quantity: number;
  normCode: string;
  codeStatus: '' | 'auto';
  confidence: number | null;
  lines: PushLine[];
}

export interface PushPlanRow {
  group: PushGroup;
  existingItemId: number | null;
  kind: 'create' | 'update' | 'unchanged';
  conflict: boolean;
  previousQuantity: number | null;
}

export interface PushPlan {
  rows: PushPlanRow[];
  conflicts: number;
}

interface TakeoffPushSnapshot {
  kind: 'takeoff_push';
  created: number[];
  updated: { itemId: number; quantity: number; takeoffPushedQuantity: number | null; lines: { description: string; expression: string; result: number | null }[] }[];
}

/** Section A-F: stories, take-off elements, manual sheets, rebar schedule, and "Đẩy sang dự toán". */
export class TakeoffService {
  constructor(
    private db: DB,
    private repo: Repo,
  ) {}

  private requireProject(projectId: number): void {
    if (!this.repo.getProject(projectId)) throw new HttpError(404, 'Không tìm thấy công trình');
  }

  // ---------------- stories ----------------
  listStories(projectId: number): StoryRow[] {
    return (this.db.prepare('SELECT * FROM stories WHERE project_id = ? ORDER BY sort_order, id').all(projectId) as StoryRowDb[]).map(toStory);
  }

  createStory(projectId: number, data: { name: string; heightM?: number; elevationM?: number }): StoryRow {
    this.requireProject(projectId);
    const max = (this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM stories WHERE project_id = ?').get(projectId) as { m: number }).m;
    const info = this.db
      .prepare('INSERT INTO stories (project_id, name, height_m, elevation_m, sort_order) VALUES (?, ?, ?, ?, ?)')
      .run(projectId, data.name.trim() || 'Tầng mới', data.heightM ?? 0, data.elevationM ?? 0, max + 1);
    return toStory(this.db.prepare('SELECT * FROM stories WHERE id = ?').get(Number(info.lastInsertRowid)) as StoryRowDb);
  }

  updateStory(projectId: number, id: number, data: { name?: string; heightM?: number; elevationM?: number; order?: number }): StoryRow {
    const s = this.listStories(projectId).find((x) => x.id === id);
    if (!s) throw new HttpError(404, 'Không tìm thấy tầng');
    this.db
      .prepare('UPDATE stories SET name = ?, height_m = ?, elevation_m = ?, sort_order = ? WHERE id = ?')
      .run(data.name ?? s.name, data.heightM ?? s.heightM, data.elevationM ?? s.elevationM, data.order ?? s.order, id);
    return this.listStories(projectId).find((x) => x.id === id)!;
  }

  deleteStory(projectId: number, id: number): void {
    if (!this.listStories(projectId).some((x) => x.id === id)) throw new HttpError(404, 'Không tìm thấy tầng');
    this.db.prepare('DELETE FROM stories WHERE id = ?').run(id);
  }

  // ---------------- elements ----------------
  listElements(projectId: number): TakeoffElementRow[] {
    return (this.db.prepare('SELECT * FROM takeoff_elements WHERE project_id = ? ORDER BY sort_order, id').all(projectId) as ElementRowDb[]).map(toElement);
  }

  getElement(projectId: number, id: number): TakeoffElementRow {
    const r = this.db.prepare('SELECT * FROM takeoff_elements WHERE project_id = ? AND id = ?').get(projectId, id) as ElementRowDb | undefined;
    if (!r) throw new HttpError(404, 'Không tìm thấy cấu kiện');
    return toElement(r);
  }

  createElement(
    projectId: number,
    data: { type: ElementType; name: string; count?: number; categoryId?: number | null; storyId?: number | null; params?: ElementParams; material?: string | null; note?: string | null },
  ): TakeoffElementRow {
    this.requireProject(projectId);
    if (data.categoryId) this.repo.getCategory(projectId, data.categoryId);
    const max = (this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM takeoff_elements WHERE project_id = ?').get(projectId) as { m: number }).m;
    const info = this.db
      .prepare(
        `INSERT INTO takeoff_elements (project_id, category_id, story_id, type, name, count, params_json, material, note, source, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
      )
      .run(projectId, data.categoryId ?? null, data.storyId ?? null, data.type, data.name?.trim() || data.type, Math.max(1, Math.round(data.count ?? 1)), JSON.stringify(data.params ?? {}), data.material ?? null, data.note ?? null, max + 1);
    return this.getElement(projectId, Number(info.lastInsertRowid));
  }

  updateElement(
    projectId: number,
    id: number,
    data: Partial<{
      name: string;
      count: number;
      categoryId: number | null;
      storyId: number | null;
      params: ElementParams;
      enabled: Record<string, boolean>;
      overrides: Record<string, { value: number; reason?: string | null }>;
      material: string | null;
      note: string | null;
      order: number;
    }>,
  ): TakeoffElementRow {
    const e = this.getElement(projectId, id);
    if (data.categoryId) this.repo.getCategory(projectId, data.categoryId);
    this.db
      .prepare(
        `UPDATE takeoff_elements SET category_id = ?, story_id = ?, name = ?, count = ?, params_json = ?, enabled_json = ?, overrides_json = ?, material = ?, note = ?, sort_order = ? WHERE id = ?`,
      )
      .run(
        data.categoryId !== undefined ? data.categoryId : e.categoryId,
        data.storyId !== undefined ? data.storyId : e.storyId,
        data.name ?? e.name,
        data.count !== undefined ? Math.max(1, Math.round(data.count)) : e.count,
        JSON.stringify(data.params ?? e.params),
        JSON.stringify(data.enabled ?? e.enabled),
        JSON.stringify(data.overrides ?? e.overrides),
        data.material !== undefined ? data.material : e.material,
        data.note !== undefined ? data.note : e.note,
        data.order ?? e.order,
        id,
      );
    return this.getElement(projectId, id);
  }

  deleteElement(projectId: number, id: number): void {
    this.getElement(projectId, id);
    this.db.prepare('DELETE FROM takeoff_elements WHERE id = ?').run(id);
  }

  /** Generated tasks for one element, with overrides and a norm-code suggestion applied (section C, E.3). */
  tasksFor(projectId: number, element: TakeoffElementRow): GeneratedTaskRow[] {
    const dataset = this.repo.datasetOf(projectId);
    const idx = this.repo.normIndex(dataset);
    const raw = computeElementTasks(element.type, element.params, element.count, { enabled: element.enabled, elementName: element.name });
    return raw.map((t): GeneratedTaskRow => {
      const override = element.overrides[t.key];
      const suggestion = idx.suggest(t.name, t.unit, 1)[0];
      const auto = suggestion && suggestion.confidence >= 0.8 ? suggestion : null;
      return {
        ...t,
        value: override ? override.value : t.value,
        computedValue: t.value,
        overrideValue: override?.value ?? null,
        overrideReason: override?.reason ?? null,
        normCode: auto?.norm.code ?? '',
        codeStatus: auto ? 'auto' : '',
        confidence: suggestion?.confidence ?? null,
      };
    });
  }

  elementsWithTasks(projectId: number) {
    return this.listElements(projectId).map((element) => ({ element, tasks: this.tasksFor(projectId, element) }));
  }

  // ---------------- manual sheets (section E) ----------------
  listManualRows(projectId: number): ManualSheetRow[] {
    return (this.db.prepare('SELECT * FROM manual_sheet_rows WHERE project_id = ? ORDER BY sort_order, id').all(projectId) as ManualRowDb[]).map(toManual);
  }

  /** Evaluate (and optionally save) one manual-calc row: free expression or the quick n/A/L/H table. */
  evalManualRow(projectId: number, data: { mode: 'expression' | 'quick'; expression?: string; quick?: { n: number; a: number; l: number; h: number }; drawingName?: string; category?: string }, save: boolean) {
    this.requireProject(projectId);
    let result: number;
    let variables: Record<string, number> = {};
    let quick: ReturnType<typeof computeQuickRow> | null = null;
    if (data.mode === 'quick') {
      const q = data.quick ?? { n: 0, a: 0, l: 0, h: 0 };
      quick = computeQuickRow(q);
      result = quick.volume;
    } else {
      if (!data.expression?.trim()) throw new HttpError(400, 'Thiếu công thức');
      try {
        const r = evaluateManualFormula(data.expression);
        result = r.value;
        variables = r.variables;
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    }
    let row: ManualSheetRow | null = null;
    if (save) {
      const max = (this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM manual_sheet_rows WHERE project_id = ?').get(projectId) as { m: number }).m;
      const info = this.db
        .prepare(
          `INSERT INTO manual_sheet_rows (project_id, mode, drawing_name, category, expression, quick_n, quick_a, quick_l, quick_h, result, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(projectId, data.mode, data.drawingName ?? '', data.category ?? '', data.mode === 'expression' ? data.expression : null, data.quick?.n ?? null, data.quick?.a ?? null, data.quick?.l ?? null, data.quick?.h ?? null, result, max + 1);
      row = toManual(this.db.prepare('SELECT * FROM manual_sheet_rows WHERE id = ?').get(Number(info.lastInsertRowid)) as ManualRowDb);
    }
    return { result, variables, quick, row };
  }

  deleteManualRow(projectId: number, id: number): void {
    const r = this.db.prepare('SELECT id FROM manual_sheet_rows WHERE project_id = ? AND id = ?').get(projectId, id);
    if (!r) throw new HttpError(404, 'Không tìm thấy dòng tính tay');
    this.db.prepare('DELETE FROM manual_sheet_rows WHERE id = ?').run(id);
  }

  /** Send a manual row's result to an estimate item as a new diễn giải line (section E.2). */
  sendManualRowToItem(projectId: number, rowId: number, itemId: number): void {
    const row = this.listManualRows(projectId).find((r) => r.id === rowId);
    if (!row) throw new HttpError(404, 'Không tìm thấy dòng tính tay');
    const item = this.repo.getItem(projectId, itemId);
    this.repo.attachImportedLines(item.id, [{ description: row.drawingName || row.expression || 'Bảng tính tay', expression: String(row.result ?? 0), result: row.result }]);
    const lines = this.repo.quantityLines(item.id);
    const total = round3(lines.reduce((a, l) => a + (l.result ?? 0), 0));
    this.db.prepare(`UPDATE estimate_items SET quantity = ?, quantity_source = 'LINES' WHERE id = ?`).run(total, item.id);
    this.db.prepare('UPDATE manual_sheet_rows SET target_item_id = ? WHERE id = ?').run(item.id, rowId);
    this.repo.touchProject(projectId);
  }

  // ---------------- rebar schedule (section D) ----------------
  listRebarRows(projectId: number): RebarScheduleRow[] {
    return (this.db.prepare('SELECT * FROM rebar_schedule_rows WHERE project_id = ? ORDER BY sort_order, id').all(projectId) as RebarRowDb[]).map(toRebar);
  }

  saveRebarRow(
    projectId: number,
    data: {
      id?: number;
      elementId?: number | null;
      cauKien: string;
      soHieu?: string | null;
      shapeCode?: string | null;
      lengths?: (number | null)[];
      note?: string | null;
      diaMm: number;
      chieuDai1ThanhMm?: number | null;
      soCauKien: number;
      soThanh1CauKien: number;
    },
  ): RebarScheduleRow {
    this.requireProject(projectId);
    const [l1, l2, l3, l4, l5, l6] = data.lengths ?? [];
    if (data.id) {
      const existing = this.listRebarRows(projectId).find((r) => r.id === data.id);
      if (!existing) throw new HttpError(404, 'Không tìm thấy dòng thép');
      this.db
        .prepare(
          `UPDATE rebar_schedule_rows SET element_id = ?, cau_kien = ?, so_hieu = ?, shape_code = ?, l1 = ?, l2 = ?, l3 = ?, l4 = ?, l5 = ?, l6 = ?, note = ?, dia_mm = ?, chieu_dai_1_thanh_mm = ?, so_cau_kien = ?, so_thanh_1_cau_kien = ? WHERE id = ?`,
        )
        .run(data.elementId ?? null, data.cauKien, data.soHieu ?? null, data.shapeCode ?? null, l1 ?? null, l2 ?? null, l3 ?? null, l4 ?? null, l5 ?? null, l6 ?? null, data.note ?? null, data.diaMm, data.chieuDai1ThanhMm ?? null, data.soCauKien, data.soThanh1CauKien, data.id);
      return this.listRebarRows(projectId).find((r) => r.id === data.id)!;
    }
    const max = (this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM rebar_schedule_rows WHERE project_id = ?').get(projectId) as { m: number }).m;
    const info = this.db
      .prepare(
        `INSERT INTO rebar_schedule_rows (project_id, element_id, cau_kien, so_hieu, shape_code, l1, l2, l3, l4, l5, l6, note, dia_mm, chieu_dai_1_thanh_mm, so_cau_kien, so_thanh_1_cau_kien, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(projectId, data.elementId ?? null, data.cauKien, data.soHieu ?? null, data.shapeCode ?? null, l1 ?? null, l2 ?? null, l3 ?? null, l4 ?? null, l5 ?? null, l6 ?? null, data.note ?? null, data.diaMm, data.chieuDai1ThanhMm ?? null, data.soCauKien, data.soThanh1CauKien, max + 1);
    return this.listRebarRows(projectId).find((r) => r.id === Number(info.lastInsertRowid))!;
  }

  deleteRebarRow(projectId: number, id: number): void {
    const r = this.db.prepare('SELECT id FROM rebar_schedule_rows WHERE project_id = ? AND id = ?').get(projectId, id);
    if (!r) throw new HttpError(404, 'Không tìm thấy dòng thép');
    this.db.prepare('DELETE FROM rebar_schedule_rows WHERE id = ?').run(id);
  }

  /** Per-type, per-TT38-group summary in tấn (section D.3). */
  rebarSummary(projectId: number) {
    const rows = this.listRebarRows(projectId);
    const byType = new Map<string, RebarScheduleRow[]>();
    for (const r of rows) {
      const elType = r.elementId ? this.listElements(projectId).find((e) => e.id === r.elementId)?.type ?? 'khac' : 'khac';
      (byType.get(elType) ?? byType.set(elType, []).get(elType)!).push(r);
    }
    return [...byType.entries()].map(([type, group]) => ({ type, groups: summarizeRebarByGroup(group.map((g) => g.computed)) }));
  }

  // ---------------- F. push to estimate ----------------
  private buildGroups(projectId: number, opts: { elementIds?: number[]; splitByStory?: boolean }): Map<string, PushGroup> {
    const groups = new Map<string, PushGroup>();
    const stories = new Map(this.listStories(projectId).map((s) => [s.id, s.name]));
    for (const element of this.listElements(projectId)) {
      if (opts.elementIds && !opts.elementIds.includes(element.id)) continue;
      if (!element.categoryId) continue;
      const tasks = this.tasksFor(projectId, element);
      for (const t of tasks) {
        const storyKey = opts.splitByStory ? (element.storyId ?? 0) : '';
        const key = `${element.categoryId}|${storyKey}|${t.key}`;
        let g = groups.get(key);
        if (!g) {
          g = {
            key,
            categoryId: element.categoryId,
            storyId: opts.splitByStory ? element.storyId : null,
            templateKey: t.key,
            name: t.name,
            unit: t.unit,
            quantity: 0,
            normCode: t.normCode,
            codeStatus: t.codeStatus,
            confidence: t.confidence,
            lines: [],
          };
          groups.set(key, g);
        }
        const storyName = element.storyId ? stories.get(element.storyId) : '';
        const overrideNote = t.overrideValue !== null ? ' (đã sửa tay)' : '';
        g.lines.push({
          description: `${element.name}${storyName ? ` (${storyName})` : ''} × ${element.count}: ${t.formula} = ${fmt(t.value)}${overrideNote}`,
          result: t.value,
          sourceReference: `takeoff:${element.id}:${t.key}`,
        });
        g.quantity = round3(g.quantity + t.value);
      }
    }
    return groups;
  }

  pushPreview(projectId: number, opts: { elementIds?: number[]; splitByStory?: boolean } = {}): PushPlan {
    this.requireProject(projectId);
    const groups = this.buildGroups(projectId, opts);
    const byKey = new Map((this.db.prepare('SELECT id, takeoff_key, quantity, takeoff_pushed_quantity FROM estimate_items WHERE takeoff_key IS NOT NULL').all() as { id: number; takeoff_key: string; quantity: number; takeoff_pushed_quantity: number | null }[]).map((r) => [r.takeoff_key, r]));
    const rows: PushPlanRow[] = [];
    let conflicts = 0;
    for (const g of groups.values()) {
      const existing = byKey.get(g.key);
      if (!existing) {
        rows.push({ group: g, existingItemId: null, kind: 'create', conflict: false, previousQuantity: null });
        continue;
      }
      const edited = existing.takeoff_pushed_quantity !== null && Math.abs(existing.quantity - existing.takeoff_pushed_quantity) > 1e-6;
      const changed = Math.abs(existing.quantity - g.quantity) > 1e-6;
      if (edited && changed) {
        conflicts++;
        rows.push({ group: g, existingItemId: existing.id, kind: 'update', conflict: true, previousQuantity: existing.quantity });
      } else if (changed) {
        rows.push({ group: g, existingItemId: existing.id, kind: 'update', conflict: false, previousQuantity: existing.quantity });
      } else {
        rows.push({ group: g, existingItemId: existing.id, kind: 'unchanged', conflict: false, previousQuantity: existing.quantity });
      }
    }
    return { rows, conflicts };
  }

  /** Apply "Đẩy sang dự toán" as one undoable revision (section F.2). `overwriteKeys` forces conflicting rows to be overwritten. */
  pushApply(projectId: number, opts: { elementIds?: number[]; splitByStory?: boolean; overwriteKeys?: string[] } = {}, user: string) {
    const plan = this.pushPreview(projectId, opts);
    const overwrite = new Set(opts.overwriteKeys ?? []);
    const snapshot: TakeoffPushSnapshot = { kind: 'takeoff_push', created: [], updated: [] };
    let created = 0;
    let updated = 0;
    let skipped = 0;
    this.db.transaction(() => {
      for (const row of plan.rows) {
        const g = row.group;
        if (row.kind === 'unchanged') continue;
        if (row.conflict && !overwrite.has(g.key)) {
          skipped++;
          continue;
        }
        if (row.kind === 'create') {
          const item = this.repo.createItem(projectId, {
            categoryId: g.categoryId,
            normCode: g.normCode,
            name: g.name,
            unit: g.unit,
            quantity: g.quantity,
            codeStatus: g.codeStatus || undefined,
            note: 'Từ bóc khối lượng',
            quantitySource: 'FORMULA',
          });
          this.repo.attachImportedLines(item.id, g.lines.map((l) => ({ description: l.description, expression: String(l.result), result: l.result })));
          this.db.prepare('UPDATE estimate_items SET takeoff_key = ?, takeoff_pushed_quantity = ? WHERE id = ?').run(g.key, g.quantity, item.id);
          snapshot.created.push(item.id);
          created++;
        } else if (row.existingItemId) {
          const prevLines = this.repo.quantityLines(row.existingItemId);
          snapshot.updated.push({
            itemId: row.existingItemId,
            quantity: row.previousQuantity ?? 0,
            takeoffPushedQuantity: (this.db.prepare('SELECT takeoff_pushed_quantity AS v FROM estimate_items WHERE id = ?').get(row.existingItemId) as { v: number | null }).v,
            lines: prevLines.map((l) => ({ description: l.description, expression: l.expression, result: l.result })),
          });
          this.db.prepare('DELETE FROM quantity_lines WHERE item_id = ?').run(row.existingItemId);
          this.repo.attachImportedLines(row.existingItemId, g.lines.map((l) => ({ description: l.description, expression: String(l.result), result: l.result })));
          this.db.prepare('UPDATE estimate_items SET quantity = ?, takeoff_key = ?, takeoff_pushed_quantity = ? WHERE id = ?').run(g.quantity, g.key, g.quantity, row.existingItemId);
          updated++;
        }
      }
      this.repo.touchProject(projectId);
    })();
    let revisionId = 0;
    if (created || updated) {
      const desc = `Đẩy sang dự toán: thêm ${created}, cập nhật ${updated} công việc từ bóc khối lượng${skipped ? `, giữ nguyên ${skipped} dòng do xung đột khối lượng` : ''}`;
      const info = this.db.prepare('INSERT INTO estimate_revisions (project_id, kind, description, created_by, snapshot_json) VALUES (?, ?, ?, ?, ?)').run(projectId, 'takeoff_push', desc, user, JSON.stringify(snapshot));
      revisionId = Number(info.lastInsertRowid);
    }
    return { created, updated, skipped, conflicts: plan.conflicts, revisionId };
  }

  /** Undo the latest revision IF it is a take-off push (same "only latest overall" rule as regional updates). */
  undoPush(projectId: number, revisionId: number): void {
    const rows = this.db.prepare('SELECT id, kind, snapshot_json, undone_at FROM estimate_revisions WHERE project_id = ? ORDER BY id DESC').all(projectId) as { id: number; kind: string; snapshot_json: string; undone_at: string | null }[];
    const latest = rows.find((r) => !r.undone_at);
    const rev = rows.find((r) => r.id === revisionId);
    if (!rev) throw new HttpError(404, 'Không tìm thấy phiên bản');
    if (rev.kind !== 'takeoff_push') throw new HttpError(400, 'Phiên bản này không phải lần đẩy sang dự toán');
    if (rev.undone_at) throw new HttpError(409, 'Phiên bản này đã được hoàn tác');
    if (!latest || latest.id !== rev.id) throw new HttpError(409, 'Chỉ hoàn tác được phiên bản mới nhất – hãy hoàn tác các phiên bản sau nó trước');
    const snap = JSON.parse(rev.snapshot_json) as TakeoffPushSnapshot;
    this.db.transaction(() => {
      for (const itemId of snap.created) {
        try {
          this.repo.deleteItem(projectId, itemId);
        } catch {
          /* already removed */
        }
      }
      for (const u of snap.updated) {
        this.db.prepare('DELETE FROM quantity_lines WHERE item_id = ?').run(u.itemId);
        const ins = this.db.prepare('INSERT INTO quantity_lines (item_id, sort_order, description, expression, variables_json, sign, unit, result, factor) VALUES (?, ?, ?, ?, ?, 1, NULL, ?, 1)');
        u.lines.forEach((l, i) => ins.run(u.itemId, i + 1, l.description, l.expression, '{}', l.result));
        this.db.prepare('UPDATE estimate_items SET quantity = ?, takeoff_pushed_quantity = ? WHERE id = ?').run(u.quantity, u.takeoffPushedQuantity, u.itemId);
      }
      this.db.prepare(`UPDATE estimate_revisions SET undone_at = datetime('now') WHERE id = ?`).run(rev.id);
      this.repo.touchProject(projectId);
    })();
  }
}

export { rebarGroup };

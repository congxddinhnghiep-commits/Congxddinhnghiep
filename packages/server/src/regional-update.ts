import { normalizeText, periodRange, proposeBooks, type PeriodType, type ResolvedPrice, type ResourceType } from '@dutoan/core';
import type { DB } from './db.js';
import { resolveImportCode, type CodeResolution } from './import-codes.js';
import { restoreReplaced, type ReimportSnapshot } from './import-sources.js';
import type { PriceBookService } from './pricebooks.js';
import { undoPriceSourceApply, type PriceSourceApplySnapshot } from './price-source.js';
import { HttpError, type Repo } from './repo.js';

export interface RegionalUpdateRequest {
  region: string;
  subArea?: string | null;
  /** Pick the newest book (≤ price date) of each type; otherwise only books of `period`. */
  auto?: boolean;
  period?: { type: PeriodType; year: number; value: number | null } | null;
  /** Which prices to update (default all three). */
  types?: ResourceType[];
  priceDate?: string | null;
  /** Re-map codes that are missing from the active norm set (or sample-only) – section B flow. */
  remapCodes?: boolean;
  /** Use exactly these price books (each for its own type) instead of choosing by region/period. */
  bookIds?: number[];
  /** itemId → code chosen by the user for the re-mapping (null = leave). */
  codeChoices?: Record<string, string | null>;
}

interface Sel {
  bookId: number;
  resourceType: ResourceType;
  priority: number;
}

interface Snapshot {
  project: { region: string | null; subArea: string | null; priceDate: string | null };
  selection: Sel[];
  codes: { itemId: number; normCode: string; codeStatus: string; normCodeRaw: string | null; codeCheck: string | null; codeCheckNote: string | null }[];
}

const ALL_TYPES: ResourceType[] = ['VL', 'NC', 'M'];
const sourceLabel = (r: ResolvedPrice | undefined) => r?.source.label ?? '–';

/** Preview and apply "Cập nhật định mức & đơn giá theo khu vực" as an undoable estimate revision. */
export class RegionalUpdateService {
  constructor(
    private db: DB,
    private repo: Repo,
    private books: PriceBookService,
  ) {}

  /** Books chosen for each requested type (newest first = highest priority). */
  private choose(projectId: number, req: RegionalUpdateRequest) {
    const p = this.repo.getProject(projectId)!;
    const types: ResourceType[] = req.types?.length ? [...req.types] : [...ALL_TYPES];
    const priceDate = req.priceDate ?? p.priceDate;
    const auto = req.auto !== false;
    const explicit = req.bookIds?.length ? this.books.list().filter((b) => req.bookIds!.includes(b.id)) : null;
    let candidates = explicit ?? proposeBooks(this.books.list(), req.region, priceDate, req.subArea ?? null);
    if (explicit && !req.types?.length) types.splice(0, types.length, ...([...new Set(explicit.map((b) => b.bookType))].filter((t) => t !== 'TH') as ResourceType[]));
    if (!auto && req.period) {
      const { start, end } = periodRange(req.period.type, req.period.year, req.period.value);
      candidates = candidates.filter((b) => b.periodStart >= start && b.periodStart <= end);
    }
    // metadata-only books (0 price rows) can't price anything: reported, never selected
    const empty = candidates.filter((b) => b.rowCount === 0 && types.includes(b.bookType as ResourceType));
    candidates = candidates.filter((b) => b.rowCount > 0);
    const kept = this.books.selection(projectId).filter((s) => !types.includes(s.resourceType));
    const chosen: Sel[] = [...kept];
    const perType: Record<string, ReturnType<PriceBookService['list']>> = {};
    for (const t of types) {
      const list = candidates.filter((b) => b.bookType === t).sort((a, b) => b.periodStart.localeCompare(a.periodStart));
      perType[t] = list;
      list.forEach((b, i) => chosen.push({ bookId: b.id, resourceType: t, priority: i + 1 }));
    }
    return { selection: chosen, perType, types, priceDate, empty };
  }

  /** Items whose norm code is unknown in the active set or only a sample – proposals per section B. */
  private remapPlan(projectId: number) {
    const dataset = this.repo.datasetOf(projectId);
    const out: { itemId: number; name: string; normCode: string; unit: string; resolution: CodeResolution }[] = [];
    for (const it of this.repo.listItems(projectId)) {
      if ((it.pricingMethod ?? 'NORM_BASED') !== 'NORM_BASED' && !it.normCode) continue;
      const norm = it.normCode ? this.repo.getNorm(it.normCode, dataset) : undefined;
      const sample = norm ? this.db.prepare('SELECT is_sample FROM norms WHERE dataset = ? AND code = ?').get(dataset, norm.code) as { is_sample: number } | undefined : undefined;
      if (norm && !sample?.is_sample) continue;
      if (!it.normCode && (it.pricingMethod ?? 'NORM_BASED') !== 'NORM_BASED') continue;
      out.push({ itemId: it.id, name: it.name, normCode: it.normCode, unit: it.unit, resolution: resolveImportCode(this.repo, dataset, { code: it.normCode, name: it.name, unit: it.unit }, { ignoreExisting: true }) });
    }
    return out;
  }

  preview(projectId: number, req: RegionalUpdateRequest) {
    const p = this.repo.getProject(projectId)!;
    if (!req.region) throw new HttpError(400, 'Chưa chọn tỉnh/thành');
    const { selection, perType, types, empty } = this.choose(projectId, req);
    const subArea = req.subArea ?? null;
    const before = this.repo.calculate(projectId);
    const afterPrices = this.books.resolve(projectId, selection, subArea);
    const beforePrices = this.books.resolve(projectId);
    const after = this.repo.calculate(projectId, { resolved: afterPrices });
    const warnings: string[] = [];
    if (p.status === 'approved') warnings.push('Công trình đã được duyệt – không thể áp dụng cập nhật lên bản đã duyệt. Hãy bỏ duyệt hoặc nhân bản công trình.');
    const chosenBooks = types.flatMap((t) => (perType[t] ?? []).map((b) => ({ id: b.id, title: b.title, type: t, status: b.status, verificationStatus: b.verificationStatus, rowCount: b.rowCount })));
    for (const t of types) if (!(perType[t] ?? []).length) warnings.push(`Không có bộ giá ${t === 'VL' ? 'vật liệu' : t === 'NC' ? 'nhân công' : 'ca máy'} của ${req.region}${req.subArea ? ` – ${req.subArea}` : ''} phù hợp kỳ giá đã chọn – giữ nguyên giá hiện tại.`);
    for (const b of empty) warnings.push(`Bộ "${b.title}" chưa có dòng giá nào (chỉ có thông tin văn bản) – bỏ qua, cần nhập giá từ file công bố.`);
    for (const b of chosenBooks) {
      if (b.verificationStatus !== 'verified') warnings.push(`Bộ "${b.title}" chưa được xác minh (${b.verificationStatus ?? 'nháp'}).`);
    }

    const resources: {
      code: string;
      name: string;
      unit: string;
      type: ResourceType;
      quantity: number;
      oldPrice: number;
      newPrice: number;
      oldSource: string;
      newSource: string;
      delta: number;
      note: string | null;
    }[] = [];
    const unpriced: { code: string; name: string; unit: string; type: ResourceType; price: number; source: string }[] = [];
    // Every resource used by an item's analysis. Items priced from the file / GTT / a quote keep their price
    // (their norm analysis is comparison only), so their share is flagged and left out of the totals.
    const used = new Map<string, { name: string; unit: string; type: ResourceType; basePrice: number; applied: number; reference: number }>();
    for (const c of after.categories) {
      for (const it of c.items) {
        const custom = (it.pricingMethod ?? 'NORM_BASED') !== 'NORM_BASED';
        for (const a of it.analysis) {
          const u = used.get(a.resourceCode) ?? { name: a.name, unit: a.unit, type: a.type, basePrice: 0, applied: 0, reference: 0 };
          if (custom) u.reference += a.quantity;
          else u.applied += a.quantity;
          used.set(a.resourceCode, u);
        }
      }
    }
    for (const [code, r] of used) {
      if (!types.includes(r.type)) continue;
      const o = beforePrices[code];
      const n = afterPrices[code];
      if (n?.source.kind === 'manual') {
        continue; // manual project prices always win and are not touched by the update
      }
      if (n?.source.kind === 'base') {
        unpriced.push({ code, name: r.name, unit: r.unit, type: r.type, price: n.price, source: sourceLabel(n) });
      }
      const oldPrice = o?.price ?? r.basePrice;
      const newPrice = n?.price ?? r.basePrice;
      if (Math.abs(newPrice - oldPrice) > 1e-9 || sourceLabel(o) !== sourceLabel(n)) {
        const note = n?.source.kind === 'base' ? 'không có giá trong bộ đã chọn – giữ giá hiện tại' : r.applied === 0 ? 'chỉ để so sánh (các công việc dùng giá file/GTT không đổi)' : null;
        resources.push({ code, name: r.name, unit: r.unit, type: r.type, quantity: r.applied + r.reference, oldPrice, newPrice, oldSource: sourceLabel(o), newSource: sourceLabel(n), delta: (newPrice - oldPrice) * r.applied, note });
      }
    }
    const missingCodes = new Set(unpriced.map((u) => u.code));
    const items: { itemId: number; name: string; normCode: string; oldUnit: number; newUnit: number; delta: number; missingPrices: number; fixed: boolean }[] = [];
    const afterItems = new Map(after.categories.flatMap((c) => c.items).map((i) => [i.id, i]));
    let fixedItems = 0;
    for (const c of before.categories) {
      for (const it of c.items) {
        const ai = afterItems.get(it.id);
        if (!ai) continue;
        const custom = (it.pricingMethod ?? 'NORM_BASED') !== 'NORM_BASED';
        if (custom) fixedItems++;
        const missing = ai.analysis.filter((a) => missingCodes.has(a.resourceCode)).length;
        const oldUnit = custom ? it.normUnitCost?.total ?? 0 : it.unitCost.total;
        const newUnit = custom ? ai.normUnitCost?.total ?? 0 : ai.unitCost.total;
        if (Math.abs(newUnit - oldUnit) > 0.5 || (missing && !custom)) {
          items.push({ itemId: it.id, name: it.name, normCode: it.normCode, oldUnit, newUnit, delta: custom ? 0 : ai.amount.total - it.amount.total, missingPrices: missing, fixed: custom });
        }
      }
    }
    if (fixedItems) warnings.push(`${fixedItems} công việc đang dùng đơn giá trong file / GTT / báo giá – giữ nguyên khi cập nhật khu vực; giá theo định mức chỉ hiển thị để so sánh.`);
    const tot = (c: typeof before) => ({ direct: c.total.total, gxdtt: c.costSummary.G, gxd: c.costSummary.Gxd });
    const b = tot(before);
    const a = tot(after);
    const dataset = this.repo.datasetOf(projectId);
    const stat = this.db.prepare('SELECT COUNT(*) AS n, SUM(is_sample) AS samples, SUM(status = \'imported_needs_review\') AS review FROM norms WHERE dataset = ?').get(dataset) as { n: number; samples: number | null; review: number | null };
    const remap = req.remapCodes ? this.remapPlan(projectId) : [];
    return {
      region: req.region,
      subArea,
      projectStatus: p.status,
      canApply: p.status !== 'approved',
      books: chosenBooks,
      totals: { before: b, after: a, delta: { direct: a.direct - b.direct, gxdtt: a.gxdtt - b.gxdtt, gxd: a.gxd - b.gxd } },
      resources,
      unpriced,
      items,
      normSet: { dataset, label: this.repo.legal.get(p.legalSet).label, total: stat.n, sample: stat.samples ?? 0, needsReview: stat.review ?? 0 },
      remap,
      warnings,
    };
  }

  apply(projectId: number, req: RegionalUpdateRequest, user: string) {
    const p = this.repo.getProject(projectId)!;
    if (p.status === 'approved') throw new HttpError(409, 'Công trình đã được duyệt – không được sửa bản đã duyệt. Hãy bỏ duyệt hoặc nhân bản công trình rồi cập nhật.');
    const plan = this.preview(projectId, req);
    const { selection } = this.choose(projectId, req);
    const snapshot: Snapshot = {
      project: { region: p.region, subArea: p.subArea, priceDate: p.priceDate },
      selection: this.books.selection(projectId),
      codes: [],
    };
    let revisionId = 0;
    this.db.transaction(() => {
      for (const [itemId, code] of Object.entries(req.codeChoices ?? {})) {
        if (!code) continue;
        const it = this.repo.getItem(projectId, Number(itemId));
        const dataset = this.repo.datasetOf(projectId);
        const norm = this.repo.getNorm(code, dataset);
        if (!norm) throw new HttpError(400, `Mã ${code} không có trong bộ ${dataset}`);
        snapshot.codes.push({ itemId: it.id, normCode: it.normCode, codeStatus: it.codeStatus ?? '', normCodeRaw: it.normCodeRaw ?? null, codeCheck: it.codeCheck ?? null, codeCheckNote: it.codeCheckNote ?? null });
        this.db
          .prepare(`UPDATE estimate_items SET norm_code = ?, code_status = 'confirmed', norm_code_raw = COALESCE(norm_code_raw, ?), code_check = 'propose', code_check_note = ? WHERE id = ?`)
          .run(norm.code, it.normCode || null, `Chuyển mã ${it.normCode || '(trống)'} → ${norm.code} khi cập nhật bộ định mức`, it.id);
      }
      this.repo.updateProject(projectId, { region: req.region, subArea: req.subArea ?? null, ...(req.priceDate ? { priceDate: req.priceDate } : {}) });
      this.books.saveSelection(projectId, selection);
      const changed = plan.resources.length;
      const desc = `Cập nhật đơn giá theo khu vực ${req.region}${req.subArea ? ` – ${req.subArea}` : ''}: ${changed} tài nguyên đổi giá${snapshot.codes.length ? `, ${snapshot.codes.length} công việc đổi mã` : ''}`;
      const info = this.db
        .prepare('INSERT INTO estimate_revisions (project_id, kind, description, created_by, total_before, total_after, snapshot_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(projectId, 'regional_update', desc, user, plan.totals.before.gxd, plan.totals.after.gxd, JSON.stringify(snapshot));
      revisionId = Number(info.lastInsertRowid);
    })();
    return { revisionId, applied: { resources: plan.resources.length, items: plan.items.length, codes: snapshot.codes.length }, totals: plan.totals };
  }

  revisions(projectId: number) {
    return (
      this.db.prepare('SELECT id, kind, description, created_by, created_at, total_before, total_after, undone_at FROM estimate_revisions WHERE project_id = ? ORDER BY id DESC').all(projectId) as {
        id: number;
        kind: string;
        description: string;
        created_by: string;
        created_at: string;
        total_before: number | null;
        total_after: number | null;
        undone_at: string | null;
      }[]
    ).map((r) => ({ id: r.id, kind: r.kind, description: r.description, createdBy: r.created_by, createdAt: r.created_at, totalBefore: r.total_before, totalAfter: r.total_after, undone: !!r.undone_at }));
  }

  /** Undo the latest active revision (restores region/sub-area/price date, the price-book selection and item codes). */
  undo(projectId: number, revisionId: number) {
    const p = this.repo.getProject(projectId)!;
    if (p.status === 'approved') throw new HttpError(409, 'Công trình đã được duyệt – không được sửa bản đã duyệt.');
    const rows = this.db.prepare('SELECT id, snapshot_json, undone_at FROM estimate_revisions WHERE project_id = ? ORDER BY id DESC').all(projectId) as { id: number; snapshot_json: string; undone_at: string | null }[];
    const latest = rows.find((r) => !r.undone_at);
    const rev = rows.find((r) => r.id === revisionId);
    if (!rev) throw new HttpError(404, 'Không tìm thấy phiên bản');
    if (rev.undone_at) throw new HttpError(409, 'Phiên bản này đã được hoàn tác');
    if (!latest || latest.id !== rev.id) throw new HttpError(409, 'Chỉ hoàn tác được phiên bản mới nhất – hãy hoàn tác các phiên bản sau nó trước');
    const raw = JSON.parse(rev.snapshot_json) as Snapshot | ReimportSnapshot | PriceSourceApplySnapshot;
    if ('kind' in raw && raw.kind === 'price_source_apply') {
      this.db.transaction(() => {
        undoPriceSourceApply(this.db, raw);
        this.db.prepare(`UPDATE estimate_revisions SET undone_at = datetime('now') WHERE id = ?`).run(rev.id);
        this.repo.touchProject(projectId);
      })();
      return;
    }
    if ('kind' in raw && raw.kind === 'reimport') {
      this.db.transaction(() => {
        restoreReplaced(this.db, raw);
        this.db.prepare(`UPDATE estimate_revisions SET undone_at = datetime('now') WHERE id = ?`).run(rev.id);
        this.repo.touchProject(projectId);
      })();
      return;
    }
    const snap = raw as Snapshot;
    this.db.transaction(() => {
      this.repo.updateProject(projectId, { region: snap.project.region, subArea: snap.project.subArea, priceDate: snap.project.priceDate });
      this.db.prepare('DELETE FROM project_price_books WHERE project_id = ?').run(projectId);
      const ins = this.db.prepare('INSERT INTO project_price_books (project_id, book_id, resource_type, priority) VALUES (?, ?, ?, ?)');
      for (const s of snap.selection) ins.run(projectId, s.bookId, s.resourceType, s.priority);
      for (const c of snap.codes) {
        this.db
          .prepare('UPDATE estimate_items SET norm_code = ?, code_status = ?, norm_code_raw = ?, code_check = ?, code_check_note = ? WHERE id = ?')
          .run(c.normCode, c.codeStatus, c.normCodeRaw, c.codeCheck, c.codeCheckNote, c.itemId);
      }
      this.db.prepare(`UPDATE estimate_revisions SET undone_at = datetime('now') WHERE id = ?`).run(rev.id);
      this.repo.touchProject(projectId);
    })();
  }

  /** A newer verified price book of the project's region than the ones in use (badge "Có bộ giá mới"). */
  status(projectId: number) {
    const p = this.repo.getProject(projectId)!;
    if (!p.region) return { enabled: p.autoPriceUpdate, count: 0, books: [] as { id: number; title: string; type: string }[] };
    const sel = this.books.selection(projectId);
    const all = this.books.list();
    const byId = new Map(all.map((b) => [b.id, b]));
    const latest = new Map<string, string>();
    for (const s of sel) {
      const b = byId.get(s.bookId);
      if (b && b.periodStart > (latest.get(s.resourceType) ?? '')) latest.set(s.resourceType, b.periodStart);
    }
    const inUse = new Set(sel.map((s) => s.bookId));
    const newer = all.filter(
      (b) =>
        normalizeText(b.region) === normalizeText(p.region!) &&
        b.verificationStatus === 'verified' &&
        b.rowCount > 0 &&
        !inUse.has(b.id) &&
        b.periodStart > (latest.get(b.bookType) ?? ''),
    );
    return { enabled: p.autoPriceUpdate, count: newer.length, books: newer.map((b) => ({ id: b.id, title: b.title, type: b.bookType })) };
  }
}

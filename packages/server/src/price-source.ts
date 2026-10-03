import type { PriceSourceKind } from '@dutoan/core';
import type { DB } from './db.js';
import { HttpError, type Repo } from './repo.js';

/** Update 6 E.2: "Áp dụng lại thứ tự ưu tiên nguồn giá" – switches every item whose currently-applied price_source
 * disagrees with what the project's priority order now prefers, as one undoable estimate_revisions entry. */
export interface PriceSourceChange {
  itemId: number;
  name: string;
  from: { kind: PriceSourceKind | null; price: number };
  to: { kind: PriceSourceKind; price: number };
}

interface ItemPriceRow {
  id: number;
  pricing_method: string | null;
  custom_vl: number | null;
  custom_nc: number | null;
  custom_m: number | null;
  price_source: string | null;
}

export interface PriceSourceApplySnapshot {
  kind: 'price_source_apply';
  items: ItemPriceRow[];
}

function unitPriceOf(calc: ReturnType<Repo['calculate']>, itemId: number): number {
  for (const c of calc.categories) {
    const it = c.items.find((x) => x.id === itemId);
    if (it) return it.unitCost.vl + it.unitCost.nc + it.unitCost.m;
  }
  return 0;
}

/** Items whose current price_source differs from what the priority order now prefers, with old → new price. */
export function previewApplyPriority(repo: Repo, projectId: number): { changes: PriceSourceChange[] } {
  const before = repo.calculate(projectId);
  const db = repo.db;
  const changes: PriceSourceChange[] = [];
  const candidates = Object.entries(before.itemPriceSources).filter(([, ps]) => ps.preferred && ps.preferred !== ps.current);
  if (!candidates.length) return { changes };
  const snapshot: ItemPriceRow[] = candidates.map(([itemId]) => db.prepare('SELECT id, pricing_method, custom_vl, custom_nc, custom_m, price_source FROM estimate_items WHERE id = ?').get(Number(itemId)) as ItemPriceRow);
  const applied: { itemId: number; kind: PriceSourceKind }[] = [];
  db.transaction(() => {
    for (const [itemId, ps] of candidates) {
      const id = Number(itemId);
      try {
        repo.applyPriceSourceKind(projectId, id, ps.preferred!);
        applied.push({ itemId: id, kind: ps.preferred! });
      } catch {
        // can't apply (e.g. no file price after all) – leave it, no change reported
      }
    }
    const after = repo.calculate(projectId);
    for (const { itemId: id, kind } of applied) {
      const [, ps] = candidates.find(([k]) => Number(k) === id)!;
      const item = before.categories.flatMap((c) => c.items).find((x) => x.id === id)!;
      changes.push({ itemId: id, name: item.name, from: { kind: ps.current, price: unitPriceOf(before, id) }, to: { kind, price: unitPriceOf(after, id) } });
    }
    for (const row of snapshot) {
      db.prepare('UPDATE estimate_items SET pricing_method = ?, custom_vl = ?, custom_nc = ?, custom_m = ?, price_source = ? WHERE id = ?').run(
        row.pricing_method,
        row.custom_vl,
        row.custom_nc,
        row.custom_m,
        row.price_source,
        row.id,
      );
    }
  })();
  return { changes };
}

export function applyPriority(db: DB, repo: Repo, projectId: number, user: string) {
  const project = repo.getProject(projectId)!;
  if (project.status === 'approved') throw new HttpError(409, 'Công trình đã được duyệt – không được sửa bản đã duyệt.');
  const { changes } = previewApplyPriority(repo, projectId);
  if (!changes.length) return { revisionId: null, changed: 0, changes };
  const before = repo.calculate(projectId);
  const snapshot: PriceSourceApplySnapshot = {
    kind: 'price_source_apply',
    items: changes.map((c) => db.prepare('SELECT id, pricing_method, custom_vl, custom_nc, custom_m, price_source FROM estimate_items WHERE id = ?').get(c.itemId) as ItemPriceRow),
  };
  let revisionId = 0;
  db.transaction(() => {
    for (const c of changes) repo.applyPriceSourceKind(projectId, c.itemId, c.to.kind);
    const after = repo.calculate(projectId);
    const totalBefore = before.costSummary.total ?? before.costSummary.Gxd;
    const totalAfter = after.costSummary.total ?? after.costSummary.Gxd;
    const info = db
      .prepare('INSERT INTO estimate_revisions (project_id, kind, description, created_by, total_before, total_after, snapshot_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(projectId, 'price_source_apply', `Áp dụng lại thứ tự ưu tiên nguồn giá: ${changes.length} công việc đổi nguồn giá`, user, totalBefore, totalAfter, JSON.stringify(snapshot));
    revisionId = Number(info.lastInsertRowid);
    repo.touchProject(projectId);
  })();
  return { revisionId, changed: changes.length, changes };
}

export function undoPriceSourceApply(db: DB, snap: PriceSourceApplySnapshot): void {
  for (const row of snap.items) {
    db.prepare('UPDATE estimate_items SET pricing_method = ?, custom_vl = ?, custom_nc = ?, custom_m = ?, price_source = ? WHERE id = ?').run(
      row.pricing_method,
      row.custom_vl,
      row.custom_nc,
      row.custom_m,
      row.price_source,
      row.id,
    );
  }
}

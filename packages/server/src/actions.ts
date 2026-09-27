import { evaluateFormula, formatNumber, type Action } from '@dutoan/core';
import type { ItemSnapshot, Repo } from './repo.js';

/** Inverse operations recorded so an assistant action can be undone. */
export type UndoOp =
  | { op: 'deleteItem'; itemId: number }
  | { op: 'deleteCategory'; categoryId: number }
  | { op: 'setQuantity'; itemId: number; quantity: number; quantityFormula: string | null }
  | { op: 'setPrice'; resourceCode: string; price: number | null }
  | { op: 'restoreItem'; itemId: number; snapshot: ItemSnapshot };

export interface ActionResult {
  text: string;
  undo: UndoOp[];
}

const fmt = (n: number) => formatNumber(n, n % 1 === 0 ? 0 : 3);

/** Typed tools shared by the rule-based assistant and the Claude provider. */
export function executeAction(repo: Repo, projectId: number, action: Action): ActionResult {
  return repo.db.transaction((): ActionResult => {
    switch (action.tool) {
      case 'createCategory': {
        const c = repo.createCategory(projectId, action.params.name);
        return { text: `Đã tạo hạng mục «${c.name}».`, undo: [{ op: 'deleteCategory', categoryId: c.id }] };
      }
      case 'addItem': {
        const p = action.params;
        const undo: UndoOp[] = [];
        let categoryId = p.categoryId;
        if (!categoryId) {
          if (!p.newCategoryName) throw new Error('Thiếu hạng mục');
          categoryId = repo.createCategory(projectId, p.newCategoryName).id;
          undo.push({ op: 'deleteCategory', categoryId });
        }
        if (!repo.getNorm(p.normCode, repo.datasetOf(projectId))) throw new Error(`Không tìm thấy mã định mức ${p.normCode}`);
        const item = repo.createItem(projectId, {
          categoryId,
          normCode: p.normCode,
          quantity: p.quantity,
          quantityFormula: p.quantityFormula ?? null,
        });
        undo.unshift({ op: 'deleteItem', itemId: item.id });
        return { text: `Đã thêm ${item.normCode} – ${item.name}: ${fmt(item.quantity)} ${item.unit}.`, undo };
      }
      case 'updateQuantity': {
        const p = action.params;
        const cur = repo.getItem(projectId, p.itemId);
        const quantity = p.quantityFormula ? evaluateFormula(p.quantityFormula) : p.quantity;
        repo.updateItem(projectId, p.itemId, { quantity, quantityFormula: p.quantityFormula ?? null });
        return {
          text: `Đã sửa khối lượng ${cur.normCode}: ${fmt(cur.quantity)} → ${fmt(quantity)} ${cur.unit}.`,
          undo: [{ op: 'setQuantity', itemId: cur.id, quantity: cur.quantity, quantityFormula: cur.quantityFormula ?? null }],
        };
      }
      case 'autoAssignCodes': {
        const undo: UndoOp[] = [];
        let n = 0;
        for (const a of action.params.assignments) {
          const item = repo.getItem(projectId, a.itemId);
          // Skip items that got a valid code since the preview was built.
          if (item.normCode && repo.getNorm(item.normCode, repo.datasetOf(projectId))) continue;
          undo.push({ op: 'restoreItem', itemId: a.itemId, snapshot: repo.snapshotItem(projectId, a.itemId) });
          repo.assignCode(projectId, a.itemId, a.normCode, 'auto', a.confidence);
          n++;
        }
        return { text: `Đã gắn mã tự động cho ${n} công việc (trạng thái "tự động" – cần xác nhận trước khi duyệt).`, undo };
      }
      case 'setPrice': {
        const p = action.params;
        const res = repo.getResource(p.resourceCode);
        if (!res) throw new Error(`Không tìm thấy tài nguyên ${p.resourceCode}`);
        const old = repo.getProjectPrice(projectId, res.code);
        repo.setProjectPrice(projectId, res.code, p.price);
        return {
          text: `Đã đổi giá ${res.name}: ${fmt(p.price)} đ/${res.unit}.`,
          undo: [{ op: 'setPrice', resourceCode: res.code, price: old }],
        };
      }
    }
  })();
}

export function applyUndo(repo: Repo, projectId: number, ops: UndoOp[]): void {
  repo.db.transaction(() => {
    for (const u of ops) {
      switch (u.op) {
        case 'deleteItem':
          try {
            repo.deleteItem(projectId, u.itemId);
          } catch {
            /* already removed */
          }
          break;
        case 'deleteCategory':
          try {
            repo.deleteCategory(projectId, u.categoryId);
          } catch {
            /* already removed */
          }
          break;
        case 'setQuantity':
          repo.updateItem(projectId, u.itemId, { quantity: u.quantity, quantityFormula: u.quantityFormula });
          break;
        case 'setPrice':
          repo.setProjectPrice(projectId, u.resourceCode, u.price);
          break;
        case 'restoreItem':
          repo.restoreItem(projectId, u.itemId, u.snapshot);
          break;
      }
    }
  })();
}

import {
  AssistantEngine,
  RuleBasedProvider,
  type Action,
  type AssistantContext,
  type Intent,
  type IntentProvider,
  type PendingField,
  type Reply,
} from '@dutoan/core';
import { applyUndo, executeAction, type UndoOp } from './actions.js';
import { ClaudeProvider } from './claude-provider.js';
import { config } from './config.js';
import { HttpError, type Repo } from './repo.js';

export function createProvider(): IntentProvider {
  if (config.anthropic.apiKey) return new ClaudeProvider(config.anthropic.apiKey, config.anthropic.model);
  return new RuleBasedProvider();
}

export function contextFor(repo: Repo, projectId: number): AssistantContext {
  const dataset = repo.datasetOf(projectId);
  return {
    searchNorms: (q, limit) => repo.searchNorms(q, dataset, limit),
    suggestNorms: (q, unit) => repo.normIndex(dataset).suggest(q, unit, 8).map((s) => ({ ...s.norm, confidence: s.confidence })),
    autoAssignPreview: (threshold) => autoAssignPlan(repo, projectId, threshold),
    getNorm: (code) => repo.getNorm(code, dataset),
    listCategories: () => repo.listCategories(projectId).map((c) => ({ id: c.id, name: c.name })),
    searchResources: (q, limit) => repo.searchResources(q, limit).map((r) => ({ ...r, price: repo.effectivePrice(projectId, r.code) })),
    getResource: (code) => {
      const r = repo.getResource(code);
      return r && { ...r, price: repo.effectivePrice(projectId, r.code) };
    },
    listItems: () => {
      const cats = new Map(repo.listCategories(projectId).map((c) => [c.id, c.name]));
      return repo.listItems(projectId).map((i, idx) => ({
        id: i.id,
        line: idx + 1,
        normCode: i.normCode,
        name: i.name,
        unit: i.unit,
        quantity: i.quantity,
        categoryName: cats.get(i.categoryId) ?? '',
      }));
    },
  };
}

/** Best suggestion per unassigned item, split by the confidence threshold. */
export function autoAssignPlan(repo: Repo, projectId: number, threshold: number) {
  const lines = new Map(repo.listItems(projectId).map((i, idx) => [i.id, idx + 1]));
  const assign: { itemId: number; line: number; name: string; normCode: string; normName: string; confidence: number; why: string }[] = [];
  const review: { itemId: number; line: number; name: string; best: { code: string; confidence: number } | null }[] = [];
  for (const item of repo.unassignedItems(projectId)) {
    const s = repo.suggestFor(projectId, item, 2)[0];
    const name = item.source?.description || item.name;
    if (s && s.confidence >= threshold) {
      assign.push({ itemId: item.id, line: lines.get(item.id)!, name, normCode: s.norm.code, normName: s.norm.name, confidence: s.confidence, why: s.why });
    } else {
      review.push({ itemId: item.id, line: lines.get(item.id)!, name, best: s ? { code: s.norm.code, confidence: s.confidence } : null });
    }
  }
  return { assign, below: review.length, review };
}

export class AssistantService {
  readonly engine: AssistantEngine;
  constructor(
    private repo: Repo,
    provider: IntentProvider = createProvider(),
  ) {
    this.engine = new AssistantEngine(provider);
  }

  get providerName(): string {
    return this.engine.provider.name;
  }

  async message(projectId: number, body: { text?: string; intent?: Intent; pending?: PendingField }): Promise<Reply> {
    const ctx = contextFor(this.repo, projectId);
    if (body.intent) return this.engine.resolve(body.intent, ctx);
    if (!body.text?.trim()) throw new HttpError(400, 'Nội dung trống');
    return this.engine.handle(body.text, ctx, body.pending);
  }

  confirm(projectId: number, userId: number, action: Action, description: string): { text: string } {
    let result;
    try {
      result = executeAction(this.repo, projectId, action);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    this.repo.db
      .prepare('INSERT INTO assistant_history (project_id, user_id, description, action_json, undo_json) VALUES (?, ?, ?, ?, ?)')
      .run(projectId, userId, description || result.text, JSON.stringify(action), JSON.stringify(result.undo));
    return { text: result.text };
  }

  /** Record a change made outside the assistant (e.g. a file import) so it can be undone. */
  record(projectId: number, userId: number, description: string, action: object, undo: UndoOp[]): void {
    this.repo.db
      .prepare('INSERT INTO assistant_history (project_id, user_id, description, action_json, undo_json) VALUES (?, ?, ?, ?, ?)')
      .run(projectId, userId, description, JSON.stringify(action), JSON.stringify(undo));
  }

  undo(projectId: number): { text: string } {
    const last = this.repo.db
      .prepare('SELECT id, description, undo_json FROM assistant_history WHERE project_id = ? AND undone = 0 ORDER BY id DESC LIMIT 1')
      .get(projectId) as { id: number; description: string; undo_json: string } | undefined;
    if (!last) return { text: 'Không có thao tác nào để hoàn tác.' };
    applyUndo(this.repo, projectId, JSON.parse(last.undo_json) as UndoOp[]);
    this.repo.db.prepare('UPDATE assistant_history SET undone = 1 WHERE id = ?').run(last.id);
    return { text: `Đã hoàn tác: ${last.description}` };
  }

  history(projectId: number) {
    return this.repo.db
      .prepare('SELECT id, description, undone, created_at FROM assistant_history WHERE project_id = ? ORDER BY id DESC LIMIT 50')
      .all(projectId);
  }
}

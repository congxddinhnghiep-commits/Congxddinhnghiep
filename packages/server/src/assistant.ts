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
  return {
    searchNorms: (q, limit) => repo.searchNorms(q, limit),
    getNorm: (code) => repo.getNorm(code),
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

import {
  AssistantEngine,
  RuleBasedProvider,
  type Action,
  type AssistantContext,
  type Intent,
  type PendingField,
  type Reply,
} from '@dutoan/core';
import { applyUndo, executeAction, type UndoOp } from './actions.js';
import { runAgent, toReply, type ProjectContextInfo } from './ai/agent.js';
import type { AiRegistry } from './ai/registry.js';
import { AiError, PROVIDER_LABELS, scrub } from './ai/types.js';
import type { ToolEnv } from './ai/tools.js';
import type { LegalService } from './legal.js';
import type { PriceBookService } from './pricebooks.js';
import type { RegionalUpdateService } from './regional-update.js';
import { HttpError, type Repo } from './repo.js';

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

export interface AssistantServices {
  regional: RegionalUpdateService;
  priceBooks: PriceBookService;
  legal: LegalService;
  /** Analysis summary of an uploaded workbook, for the import-mapping-help tool. */
  analyzeFile?: (fileId: string, userId: number, projectId: number) => unknown;
}

export interface MessageBody {
  text?: string;
  intent?: Intent;
  pending?: PendingField;
  /** Recent turns (text only) so the AI agent keeps the conversation. */
  history?: { role: 'user' | 'assistant'; text: string }[];
  /** Estimate lines the user has selected (1-based STT), added to the AI context. */
  selectedLines?: number[];
}

const cleanHistory = (h: MessageBody['history']) =>
  (Array.isArray(h) ? h : [])
    .filter((x) => x && (x.role === 'user' || x.role === 'assistant') && typeof x.text === 'string' && x.text.trim())
    .slice(-10)
    .map((x) => ({ role: x.role, text: x.text.slice(0, 2000) }));

/**
 * Assistant: the AI agent (ChatGPT / Claude, keys from the server environment only) when a provider is
 * configured, the offline rule-based engine otherwise or when the AI call fails (invalid key, quota, network…).
 */
export class AssistantService {
  /** Offline rules engine – the fallback and the resolver of option clicks. */
  readonly engine = new AssistantEngine(new RuleBasedProvider());
  constructor(
    private repo: Repo,
    private ai: AiRegistry,
    private svc: AssistantServices,
  ) {}

  get providerName(): string {
    return this.ai.active().id;
  }

  private contextInfo(projectId: number, selected?: number[]): ProjectContextInfo {
    const p = this.repo.getProject(projectId)!;
    const ctx = contextFor(this.repo, projectId);
    const items = ctx.listItems();
    return {
      name: p.name,
      legalSet: this.svc.legal.get(p.legalSet).label,
      normDataset: this.repo.datasetOf(projectId),
      region: p.region,
      subArea: p.subArea,
      priceDate: p.priceDate,
      status: p.status,
      itemCount: items.length,
      categories: ctx.listCategories().map((c) => c.name),
      selectedLines: (selected ?? [])
        .slice(0, 20)
        .map((n) => items.find((i) => i.line === n))
        .filter((i): i is NonNullable<typeof i> => !!i)
        .map((i) => ({ line: i.line, name: i.name, normCode: i.normCode, quantity: i.quantity, unit: i.unit })),
    };
  }

  async message(projectId: number, body: MessageBody, userId = 0): Promise<Reply> {
    const ctx = contextFor(this.repo, projectId);
    if (body.intent) return this.engine.resolve(body.intent, ctx);
    if (!body.text?.trim()) throw new HttpError(400, 'Nội dung trống');
    const active = this.ai.active();
    // answering a question of the offline rules engine, or no AI configured → offline rules
    if (active.id === 'offline' || body.pending) return this.engine.handle(body.text, ctx, body.pending);
    try {
      const provider = this.ai.chatProvider(active.id);
      const env: ToolEnv = {
        repo: this.repo,
        projectId,
        ctx,
        regional: this.svc.regional,
        priceBooks: this.svc.priceBooks,
        legal: this.svc.legal,
        autoAssign: (t) => autoAssignPlan(this.repo, projectId, t),
        analyzeFile: this.svc.analyzeFile ? (fileId) => this.svc.analyzeFile!(fileId, userId, projectId) : undefined,
      };
      const r = await runAgent(provider, env, this.contextInfo(projectId, body.selectedLines), cleanHistory(body.history), body.text, this.ai.limits());
      return toReply(r, `${PROVIDER_LABELS[active.id]} · ${provider.model}`);
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError('unknown', scrub((e as Error).message ?? ''));
      console.warn(`[assistant] ${active.id}: ${err.code}`); // never the key or the request
      const offline = await this.engine.handle(body.text, ctx);
      const notice = `⚠ ${PROVIDER_LABELS[active.id]}: ${err.message} Đã chuyển sang chế độ ngoại tuyến cho yêu cầu này.`;
      return { ...offline, text: `${notice}\n${offline.text}` } as Reply;
    }
  }

  confirm(projectId: number, userId: number, action: Action, description: string): { text: string } {
    let result;
    try {
      if (action.tool === 'regionalUpdate') {
        const user = this.repo.db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as { username: string } | undefined;
        const p = action.params;
        const r = this.svc.regional.apply(projectId, { region: p.region, subArea: p.subArea ?? null, auto: p.auto !== false, types: p.types, bookIds: p.bookIds, remapCodes: p.remapCodes }, user?.username ?? 'ai');
        result = { text: `Đã cập nhật đơn giá theo khu vực ${p.region}: ${r.applied.resources} tài nguyên đổi giá (phiên bản #${r.revisionId}, hoàn tác được).`, undo: [{ op: 'undoRevision', revisionId: r.revisionId } as UndoOp] };
      } else result = executeAction(this.repo, projectId, action);
    } catch (e) {
      if (e instanceof HttpError) throw e;
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
    applyUndo(this.repo, projectId, JSON.parse(last.undo_json) as UndoOp[], { undoRevision: (id) => this.svc.regional.undo(projectId, id) });
    this.repo.db.prepare('UPDATE assistant_history SET undone = 1 WHERE id = ?').run(last.id);
    return { text: `Đã hoàn tác: ${last.description}` };
  }

  history(projectId: number) {
    return this.repo.db
      .prepare('SELECT id, description, undone, created_at FROM assistant_history WHERE project_id = ? ORDER BY id DESC LIMIT 50')
      .all(projectId);
  }
}

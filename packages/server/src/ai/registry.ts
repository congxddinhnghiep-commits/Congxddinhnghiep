import { config } from '../config.js';
import type { DB } from '../db.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAiProvider } from './openai.js';
import { AiError, PROVIDER_LABELS, scrub, type ChatProvider, type ProviderId } from './types.js';

export type AiConfig = Pick<typeof config, 'openai' | 'anthropic' | 'ai'>;
export type ProviderFactory = (id: 'openai' | 'anthropic', apiKey: string, model: string) => ChatProvider;

const DEFAULT_FACTORY: ProviderFactory = (id, key, model) => (id === 'openai' ? new OpenAiProvider(key, model) : new AnthropicProvider(key, model));
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\-/]{0,79}$/;
const ENV_KEY: Record<'openai' | 'anthropic', string> = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' };

/** Chooses the active AI provider from the environment (keys) and the Settings screen (choice + model names). */
export class AiRegistry {
  private lastTest: Partial<Record<ProviderId, { ok: boolean; at: string; message: string }>> = {};

  constructor(
    private db: DB,
    private cfg: AiConfig = config,
    private factory: ProviderFactory = DEFAULT_FACTORY,
  ) {}

  private get(key: string): string | null {
    return (this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
  }
  private set(key: string, value: string | null): void {
    if (value === null) this.db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
    else this.db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  limits(): { maxIterations: number; maxOutputTokens: number; timeoutMs: number } {
    const { maxIterations, maxOutputTokens, timeoutMs } = this.cfg.ai;
    return { maxIterations, maxOutputTokens, timeoutMs };
  }

  hasKey(id: ProviderId): boolean {
    return id === 'offline' ? true : !!this.cfg[id].apiKey;
  }

  modelFor(id: 'openai' | 'anthropic'): string {
    return this.get(`ai.model.${id}`) || this.cfg[id].model;
  }

  /** Requested provider: Settings screen → AI_PROVIDER env → auto. */
  requested(): ProviderId | 'auto' {
    const v = this.get('ai.provider') || this.cfg.ai.provider;
    return v === 'openai' || v === 'anthropic' || v === 'offline' ? v : 'auto';
  }

  /** The provider actually used: falls back to offline when the requested one has no key. */
  active(): { id: ProviderId; requested: ProviderId | 'auto'; fellBack: boolean } {
    const requested = this.requested();
    if (requested === 'offline') return { id: 'offline', requested, fellBack: false };
    if (requested === 'openai' || requested === 'anthropic') return this.hasKey(requested) ? { id: requested, requested, fellBack: false } : { id: 'offline', requested, fellBack: true };
    if (this.hasKey('anthropic')) return { id: 'anthropic', requested, fellBack: false };
    if (this.hasKey('openai')) return { id: 'openai', requested, fellBack: false };
    return { id: 'offline', requested, fellBack: false };
  }

  chatProvider(id: 'openai' | 'anthropic' = this.active().id as 'openai' | 'anthropic'): ChatProvider {
    if (!this.hasKey(id)) throw new AiError('no_key');
    return this.factory(id, this.cfg[id].apiKey, this.modelFor(id));
  }

  save(input: { provider?: unknown; models?: Record<string, unknown> }): void {
    if (input.provider !== undefined) {
      if (!['openai', 'anthropic', 'offline', 'auto'].includes(String(input.provider))) throw new Error('Nhà cung cấp AI không hợp lệ');
      this.set('ai.provider', input.provider === 'auto' ? null : String(input.provider));
    }
    for (const id of ['openai', 'anthropic'] as const) {
      const m = input.models?.[id];
      if (m === undefined) continue;
      const name = String(m).trim();
      if (name && !MODEL_RE.test(name)) throw new Error(`Tên mô hình ${PROVIDER_LABELS[id]} không hợp lệ`);
      this.set(`ai.model.${id}`, name || null);
    }
  }

  /** Never contains a key – only whether one is configured. */
  status() {
    const act = this.active();
    const providers = (['openai', 'anthropic'] as const).map((id) => {
      const has = this.hasKey(id);
      const t = this.lastTest[id];
      return {
        id,
        label: PROVIDER_LABELS[id],
        hasKey: has,
        envKey: ENV_KEY[id],
        model: this.modelFor(id),
        defaultModel: this.cfg[id].model,
        status: has ? 'Đã kết nối' : 'Chưa có khóa API',
        detail: !has ? `Chưa đặt biến môi trường ${ENV_KEY[id]}.` : t ? (t.ok ? `Kiểm tra lúc ${t.at}: hoạt động (${t.message}).` : `Kiểm tra lúc ${t.at} thất bại: ${t.message}`) : 'Đã có khóa API – bấm “Kiểm tra kết nối” để xác nhận.',
        tested: t ? t.ok : null,
      };
    });
    return {
      requested: this.requested(),
      active: act.id,
      activeLabel: PROVIDER_LABELS[act.id],
      activeModel: act.id === 'offline' ? null : this.modelFor(act.id),
      fellBack: act.fellBack,
      providers,
    };
  }

  /** Minimal real round trip to verify the key/model (costs a few tokens). */
  async test(id: 'openai' | 'anthropic', signal?: AbortSignal) {
    const started = Date.now();
    try {
      const p = this.chatProvider(id);
      const r = await p.chat({ system: 'Bạn là bộ kiểm tra kết nối.', messages: [{ role: 'user', content: 'Trả lời đúng một từ: OK' }], tools: [], maxTokens: 16, signal });
      const out = { ok: true as const, model: p.model, latencyMs: Date.now() - started, message: (r.text || 'OK').slice(0, 40) };
      this.lastTest[id] = { ok: true, at: new Date().toLocaleTimeString('vi-VN'), message: `${p.model}, ${out.latencyMs} ms` };
      return out;
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError('unknown', scrub((e as Error).message));
      this.lastTest[id] = { ok: false, at: new Date().toLocaleTimeString('vi-VN'), message: err.message };
      return { ok: false as const, code: err.code, message: err.message };
    }
  }
}

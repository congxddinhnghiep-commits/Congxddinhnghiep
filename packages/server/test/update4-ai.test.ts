import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { OpenAiProvider, mapOpenAiError } from '../src/ai/openai.js';
import { AnthropicProvider, mapAnthropicError } from '../src/ai/anthropic.js';
import { AiError, scrub, type ChatProvider, type ChatRequest, type ChatResult } from '../src/ai/types.js';
import { openDb } from '../src/db.js';
import { runImportTt38 } from '../src/scripts/import-tt38.js';
import { seedAdmin } from '../src/seed.js';

// Update 4 B: AI provider layer with mocked providers (no network).
const OPENAI_KEY = 'sk-test-openai-SECRET-1234567890';
const ANTHROPIC_KEY = 'sk-ant-test-SECRET-1234567890';

/** Scripted chat provider: each call takes the next step; records the requests it received. */
class Scripted implements ChatProvider {
  readonly requests: ChatRequest[] = [];
  private i = 0;
  constructor(
    readonly id: 'openai' | 'anthropic',
    readonly model: string,
    private steps: (ChatResult | Error | ((req: ChatRequest) => Promise<ChatResult>))[],
  ) {}
  async chat(req: ChatRequest): Promise<ChatResult> {
    this.requests.push(req);
    const s = this.steps[Math.min(this.i++, this.steps.length - 1)];
    if (s instanceof Error) throw s;
    if (typeof s === 'function') return s(req);
    return s;
  }
}
const call = (name: string, args: Record<string, unknown>, id = `c-${name}`): ChatResult => ({ text: '', toolCalls: [{ id, name, args }], usage: { inputTokens: 100, outputTokens: 20 } });
const say = (text: string): ChatResult => ({ text, toolCalls: [], usage: { inputTokens: 100, outputTokens: 30 } });

let scripted: Scripted | null = null;
const cfg = {
  openai: { apiKey: OPENAI_KEY, model: 'gpt-test' },
  anthropic: { apiKey: '', model: 'claude-test' },
  ai: { provider: '', maxIterations: 3, maxOutputTokens: 5000, timeoutMs: 400 },
};
const db = openDb(':memory:');
seedAdmin(db, 'admin', 'admin123');
runImportTt38(db);
const app = createApp(db, { serveWeb: false, ai: { cfg, factory: () => scripted! } });
let token = '';
const A = () => ({ Authorization: `Bearer ${token}` });

async function newProject(name: string) {
  const p = (await request(app).post('/api/projects').set(A()).send({ name, priceDate: '2026-09-01' })).body;
  const est = (await request(app).get(`/api/projects/${p.id}/estimate`).set(A())).body;
  return { pid: p.id as number, catId: est.categories[0].id as number };
}
const ask = async (pid: number, text: string, extra: Record<string, unknown> = {}) => (await request(app).post(`/api/projects/${pid}/assistant`).set(A()).send({ text, ...extra })).body;
const items = async (pid: number) => (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body.categories.flatMap((c: { items: { normCode: string; quantity: number }[] }) => c.items);

beforeAll(async () => {
  const t = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' })).body.token;
  token = (await request(app).post('/api/auth/change-password').set({ Authorization: `Bearer ${t}` }).send({ oldPassword: 'admin123', newPassword: 'MatKhau2026!' })).body.token;
});

describe('B1/B2 settings screen data: provider, model, status – never a key', () => {
  it('reports status per provider and the active one; the keys are never returned', async () => {
    const r = (await request(app).get('/api/ai/status').set(A())).body;
    expect(r.active).toBe('openai'); // auto: only the OpenAI key exists
    expect(r.activeModel).toBe('gpt-test');
    expect(r.providers.find((p: { id: string }) => p.id === 'openai')).toMatchObject({ hasKey: true, status: 'Đã kết nối', envKey: 'OPENAI_API_KEY' });
    expect(r.providers.find((p: { id: string }) => p.id === 'anthropic')).toMatchObject({ hasKey: false, status: 'Chưa có khóa API', envKey: 'ANTHROPIC_API_KEY' });
    const conf = (await request(app).get('/api/config').set(A())).body;
    for (const body of [r, conf]) expect(JSON.stringify(body)).not.toMatch(/SECRET|sk-test|sk-ant/);
    expect(conf).toMatchObject({ assistantProvider: 'openai', assistantLabel: 'ChatGPT (OpenAI)' });
    // keys are not in the database either
    const dump = JSON.stringify(db.prepare('SELECT * FROM app_settings').all());
    expect(dump).not.toMatch(/SECRET|sk-/);
  });

  it('saves provider and model names (admin), validates them, and falls back to offline without a key', async () => {
    const bad = await request(app).put('/api/ai/settings').set(A()).send({ provider: 'gemini' });
    expect(bad.status).toBe(400);
    const badModel = await request(app).put('/api/ai/settings').set(A()).send({ models: { openai: 'gpt 4; drop table' } });
    expect(badModel.status).toBe(400);
    const ok = await request(app).put('/api/ai/settings').set(A()).send({ provider: 'anthropic', models: { anthropic: 'claude-custom-1' } });
    expect(ok.status).toBe(200);
    // Claude chosen but no ANTHROPIC_API_KEY → offline, status explains
    expect(ok.body).toMatchObject({ requested: 'anthropic', active: 'offline', fellBack: true });
    expect(ok.body.providers.find((p: { id: string }) => p.id === 'anthropic')).toMatchObject({ model: 'claude-custom-1', status: 'Chưa có khóa API' });
    await request(app).put('/api/ai/settings').set(A()).send({ provider: 'openai', models: { anthropic: '' } });
    expect((await request(app).get('/api/ai/status').set(A())).body).toMatchObject({ active: 'openai' });
  });

  it('"Kiểm tra kết nối" runs a real round trip with the chosen provider and reports Vietnamese errors', async () => {
    scripted = new Scripted('openai', 'gpt-test', [say('OK')]);
    const ok = (await request(app).post('/api/ai/test').set(A()).send({ provider: 'openai' })).body;
    expect(ok).toMatchObject({ ok: true, model: 'gpt-test' });
    expect(scripted.requests[0].tools).toEqual([]);
    scripted = new Scripted('openai', 'gpt-test', [new AiError('invalid_key')]);
    const bad = (await request(app).post('/api/ai/test').set(A()).send({ provider: 'openai' })).body;
    expect(bad).toMatchObject({ ok: false, code: 'invalid_key' });
    expect(bad.message).toMatch(/Khóa API không hợp lệ/);
    expect(bad.status.providers[0].detail).toMatch(/thất bại/);
    expect((await request(app).post('/api/ai/test').set(A()).send({ provider: 'anthropic' })).body).toMatchObject({ ok: false, code: 'no_key' });
  });
});

describe('B4 tools: read-only run directly, write tools return a PREVIEW, apply = undoable', () => {
  it('tool-call round trip: search_norms result is fed back to the model', async () => {
    const { pid } = await newProject('ai read');
    scripted = new Scripted('openai', 'gpt-test', [call('search_norms', { query: 'AF.11110' }), say('Mã AF.11110 là bê tông lót móng.')]);
    const r = await ask(pid, 'tìm mã AF.11110');
    expect(r).toMatchObject({ type: 'agent', text: 'Mã AF.11110 là bê tông lót móng.', previews: [], provider: 'ChatGPT (OpenAI) · gpt-test' });
    expect(r.trace).toEqual([{ tool: 'search_norms', readOnly: true, ok: true }]);
    const second = scripted.requests[1];
    const toolMsg = second.messages.find((m) => m.role === 'tool');
    expect(toolMsg && 'content' in toolMsg && toolMsg.content).toContain('AF.11110');
    // system prompt carries the project context in Vietnamese
    expect(scripted.requests[0].system).toMatch(/Bộ pháp lý: .*TT 36\/2026/);
    expect(scripted.requests[0].system).toMatch(/bộ định mức: TT38_2026/);
    expect(scripted.requests[0].tools.length).toBeGreaterThan(10);
  });

  it('write tool → preview only; confirm applies; the assistant undo reverts it', async () => {
    const { pid } = await newProject('ai write');
    scripted = new Scripted('openai', 'gpt-test', [call('add_item', { normCode: 'AF.11110', quantity: 3, categoryName: 'PHẦN MÓNG' }), say('Đã chuẩn bị bản xem trước.')]);
    const r = await ask(pid, 'thêm 3 m3 bê tông lót móng vào phần móng');
    expect(r.type).toBe('agent');
    expect(r.previews).toHaveLength(1);
    expect(r.previews[0].action).toMatchObject({ tool: 'addItem', params: { normCode: 'AF.11110', quantity: 3, newCategoryName: 'PHẦN MÓNG' } });
    expect(r.previews[0].text).toMatch(/Thêm vào «PHẦN MÓNG \(tạo mới\)»: AF\.11110/);
    expect(r.trace).toEqual([{ tool: 'add_item', readOnly: false, ok: true }]);
    // the model is told it is only a preview
    const fed = scripted.requests[1].messages.find((m) => m.role === 'tool');
    expect(fed && 'content' in fed && fed.content).toMatch(/CHƯA áp dụng/);
    expect(await items(pid)).toHaveLength(0); // nothing applied yet

    const c = await request(app).post(`/api/projects/${pid}/assistant/confirm`).set(A()).send({ action: r.previews[0].action, description: r.previews[0].text });
    expect(c.status).toBe(200);
    expect((await items(pid)).map((i: { normCode: string }) => i.normCode)).toEqual(['AF.11110']);
    await request(app).post(`/api/projects/${pid}/assistant/undo`).set(A());
    expect(await items(pid)).toHaveLength(0);
  });

  it('asks for a choice when the code is uncertain instead of guessing (no preview)', async () => {
    const { pid, catId } = await newProject('ai ambiguous');
    void catId;
    scripted = new Scripted('openai', 'gpt-test', [call('add_item', { normQuery: 'bê tông', quantity: 2, unit: 'm3', categoryName: 'X' }), say('Bạn muốn loại bê tông nào?')]);
    const r = await ask(pid, 'thêm 2 m3 bê tông');
    expect(r.previews).toEqual([]);
    const fed = scripted.requests[1].messages.find((m) => m.role === 'tool');
    expect(fed && 'content' in fed && fed.content).toMatch(/needChoice|candidates/);
  });

  it('regional_update: preview from the agent, apply creates a revision, assistant undo reverts it', async () => {
    const res = (code: string) => (db.prepare("SELECT r.code FROM norm_resources nr JOIN resources r ON r.code = nr.resource_code WHERE nr.dataset='TT38_2026' AND nr.norm_code='AF.11110' AND r.name = ?").get(code) as { code: string }).code;
    const b = (await request(app).post('/api/price-books').set(A()).send({ region: 'TP. Hồ Chí Minh', issuer: 'Sở Xây dựng', docNumber: 'AI-VL', periodType: 'month', periodYear: 2026, periodValue: 8, bookType: 'VL', vat: 'excluded' })).body;
    db.prepare(`INSERT INTO price_book_rows (book_id, resource_code, name, unit, price, match_status, verification_status) VALUES (?, ?, 'Vữa bê tông', 'm3', 1200000, 'matched', 'verified')`).run(b.id, res('Vữa bê tông'));
    await request(app).post(`/api/price-books/${b.id}/status`).set(A()).send({ status: 'verified' });
    const { pid, catId } = await newProject('ai regional');
    await request(app).post(`/api/projects/${pid}/items`).set(A()).send({ categoryId: catId, normCode: 'AF.11110', quantity: 10 });
    scripted = new Scripted('openai', 'gpt-test', [call('regional_update', { region: 'TP. Hồ Chí Minh', types: ['VL'] }), say('Bản xem trước cập nhật giá.')]);
    const r = await ask(pid, 'cập nhật đơn giá theo TP.HCM');
    expect(r.previews).toHaveLength(1);
    expect(r.previews[0].action).toMatchObject({ tool: 'regionalUpdate', params: { region: 'TP. Hồ Chí Minh', types: ['VL'] } });
    expect(r.previews[0].text).toMatch(/1 tài nguyên đổi giá, GXD \+/);
    const before = (await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body.total.total;
    expect(before).toBe(0); // preview changed nothing
    const c = await request(app).post(`/api/projects/${pid}/assistant/confirm`).set(A()).send({ action: r.previews[0].action, description: r.previews[0].text });
    expect(c.status).toBe(200);
    expect(c.body.text).toMatch(/phiên bản #\d+/);
    expect((await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body.total.total).toBeGreaterThan(0);
    expect((await request(app).get(`/api/projects/${pid}/revisions`).set(A())).body[0]).toMatchObject({ kind: 'regional_update', undone: false });
    await request(app).post(`/api/projects/${pid}/assistant/undo`).set(A());
    expect((await request(app).get(`/api/projects/${pid}/estimate`).set(A())).body.total.total).toBe(0);
    expect((await request(app).get(`/api/projects/${pid}/revisions`).set(A())).body[0].undone).toBe(true);
  });

  it('UI commands (open the import / regional dialogs) come back as commands', async () => {
    const { pid } = await newProject('ai commands');
    scripted = new Scripted('openai', 'gpt-test', [call('open_import_panel', {}), say('Đã mở hộp thoại nhập.')]);
    expect((await ask(pid, 'mở nhập excel')).commands).toEqual(['importFile']);
  });

  it('keeps recent turns for the model and never sends more than 10', async () => {
    const { pid } = await newProject('ai history');
    scripted = new Scripted('openai', 'gpt-test', [say('ok')]);
    const history = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `t${i}` }));
    await ask(pid, 'tiếp', { history });
    expect(scripted.requests[0].messages).toHaveLength(11);
    expect(scripted.requests[0].messages[0]).toMatchObject({ content: 't4' });
  });
});

describe('B5 limits and fallback', () => {
  it('stops after the maximum number of tool iterations', async () => {
    const { pid } = await newProject('ai limit');
    scripted = new Scripted('openai', 'gpt-test', [call('list_items', {})]); // always calls a tool
    const r = await ask(pid, 'lặp mãi');
    expect(r.type).toBe('agent');
    expect(r.text).toMatch(/giới hạn 3 bước/);
    expect(scripted.requests).toHaveLength(3);
  });

  it('enforces the output-token budget', async () => {
    const { pid } = await newProject('ai budget');
    scripted = new Scripted('openai', 'gpt-test', [{ text: '', toolCalls: [{ id: 'x', name: 'list_items', args: {} }], usage: { inputTokens: 1, outputTokens: 6000 } }]);
    const r = await ask(pid, 'tốn token');
    expect(r.text).toMatch(/ngoại tuyến/); // AiError limit → offline fallback with a Vietnamese notice
    expect(r.text).toMatch(/giới hạn số bước \/ số token/);
  });

  it.each([
    [new AiError('invalid_key'), /Khóa API không hợp lệ/],
    [new AiError('quota'), /hết hạn mức/],
    [new AiError('network'), /lỗi mạng/],
  ])('%s → automatic fallback to the offline rules with a Vietnamese notice', async (err, re) => {
    const { pid } = await newProject('ai fallback');
    scripted = new Scripted('openai', 'gpt-test', [err]);
    const r = await ask(pid, 'tạo hạng mục phần móng');
    expect(r.type).toBe('preview'); // the offline engine answered
    expect(r.text).toMatch(re);
    expect(r.text).toMatch(/Đã chuyển sang chế độ ngoại tuyến/);
    expect(r.action).toEqual({ tool: 'createCategory', params: { name: 'phần móng' } });
  });

  it('times out slow providers', async () => {
    const { pid } = await newProject('ai timeout');
    scripted = new Scripted('openai', 'gpt-test', [(req) => new Promise((_res, rej) => req.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))]);
    const r = await ask(pid, 'chậm');
    expect(r.text).toMatch(/hết thời gian chờ/);
  });

  it('a missing key means the offline assistant answers directly (no AI call)', async () => {
    const off = createApp(db, { serveWeb: false, ai: { cfg: { ...cfg, openai: { apiKey: '', model: 'x' } }, factory: () => { throw new Error('must not be called'); } } });
    const t = (await request(off).post('/api/auth/login').send({ username: 'admin', password: 'MatKhau2026!' })).body.token;
    const st = (await request(off).get('/api/ai/status').set({ Authorization: `Bearer ${t}` })).body;
    expect(st).toMatchObject({ active: 'offline', activeLabel: 'Ngoại tuyến (quy tắc)' });
    const p = (await request(off).post('/api/projects').set({ Authorization: `Bearer ${t}` }).send({ name: 'off' })).body;
    const r = (await request(off).post(`/api/projects/${p.id}/assistant`).set({ Authorization: `Bearer ${t}` }).send({ text: 'tạo hạng mục phần thân' })).body;
    expect(r.type).toBe('preview');
  });
});

describe('B1 provider adapters (fake SDK clients)', () => {
  it('OpenAI: maps tools, tool results and function calls; parses usage', async () => {
    let body: Record<string, unknown> = {};
    const fake = {
      chat: {
        completions: {
          create: async (b: Record<string, unknown>) => {
            body = b;
            return { choices: [{ message: { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_norms', arguments: '{"query":"đào"}' } }] } }], usage: { prompt_tokens: 11, completion_tokens: 7 } };
          },
        },
      },
    };
    const p = new OpenAiProvider('k', 'gpt-x', fake);
    const r = await p.chat({
      system: 'SYS',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_0', name: 'list_items', args: {} }] },
        { role: 'tool', toolCallId: 'call_0', name: 'list_items', content: '[]' },
      ],
      tools: [{ name: 'search_norms', description: 'd', readOnly: true, parameters: { type: 'object', properties: { query: { type: 'string' } } } }],
      maxTokens: 100,
    });
    expect(r).toEqual({ text: '', toolCalls: [{ id: 'call_1', name: 'search_norms', args: { query: 'đào' } }], usage: { inputTokens: 11, outputTokens: 7 } });
    expect(body).toMatchObject({ model: 'gpt-x', max_completion_tokens: 100, tool_choice: 'auto' });
    const msgs = body.messages as { role: string; tool_call_id?: string; tool_calls?: { function: { arguments: string } }[] }[];
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(msgs[2].tool_calls![0].function.arguments).toBe('{}');
    expect(msgs[3].tool_call_id).toBe('call_0');
    expect((body.tools as { type: string; function: { name: string } }[])[0]).toMatchObject({ type: 'function', function: { name: 'search_norms' } });
  });

  it('Anthropic: tool_use / tool_result blocks, results grouped in one user turn', async () => {
    let body: Record<string, unknown> = {};
    const fake = {
      messages: {
        create: async (b: Record<string, unknown>) => {
          body = b;
          return { content: [{ type: 'text', text: 'Xin chào' }, { type: 'tool_use', id: 'tu_1', name: 'get_norm', input: { code: 'AF.11110' } }], usage: { input_tokens: 5, output_tokens: 9 } };
        },
      },
    };
    const p = new AnthropicProvider('k', 'claude-x', fake);
    const r = await p.chat({
      system: 'SYS',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'đang tra', toolCalls: [{ id: 'a', name: 'list_items', args: {} }, { id: 'b', name: 'get_cost_summary', args: {} }] },
        { role: 'tool', toolCallId: 'a', name: 'list_items', content: '[]' },
        { role: 'tool', toolCallId: 'b', name: 'get_cost_summary', content: '{}' },
      ],
      tools: [{ name: 'get_norm', description: 'd', readOnly: true, parameters: { type: 'object', properties: {} } }],
      maxTokens: 50,
    });
    expect(r).toEqual({ text: 'Xin chào', toolCalls: [{ id: 'tu_1', name: 'get_norm', args: { code: 'AF.11110' } }], usage: { inputTokens: 5, outputTokens: 9 } });
    const msgs = body.messages as { role: string; content: { type: string }[] | string }[];
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect((msgs[2].content as { type: string }[]).map((b) => b.type)).toEqual(['tool_result', 'tool_result']);
    expect(body).toMatchObject({ system: 'SYS', max_tokens: 50, tool_choice: { type: 'auto' } });
  });

  it('maps SDK errors to Vietnamese error codes and never leaks a key', () => {
    expect(mapOpenAiError({ status: 401, message: 'bad' }).code).toBe('invalid_key');
    expect(mapOpenAiError({ status: 429, code: 'insufficient_quota', message: 'x' }).code).toBe('quota');
    expect(mapOpenAiError({ status: 429, message: 'x' }).code).toBe('rate_limit');
    expect(mapOpenAiError({ status: 404, message: 'x' }).code).toBe('model');
    expect(mapOpenAiError({ name: 'APIConnectionError', message: 'ECONNRESET' }).code).toBe('network');
    expect(mapAnthropicError({ status: 401, message: 'x' }).code).toBe('invalid_key');
    expect(mapAnthropicError({ status: 429, message: 'x' }).code).toBe('rate_limit');
    expect(mapAnthropicError({ status: 400, message: 'Your credit balance is too low' }).code).toBe('quota');
    const leak = mapOpenAiError({ status: 500, message: `Incorrect API key provided: ${OPENAI_KEY}` });
    expect(leak.message).not.toContain('SECRET');
    expect(scrub(`Bearer abcdefghijkl and ${ANTHROPIC_KEY}`)).not.toMatch(/SECRET|abcdefghijkl/);
  });
});

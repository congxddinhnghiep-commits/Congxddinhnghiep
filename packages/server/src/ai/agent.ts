import type { Action, Reply } from '@dutoan/core';
import { buildTools, type ToolEnv } from './tools.js';
import { AiError, type ChatMessage, type ChatProvider } from './types.js';

export interface AgentLimits {
  maxIterations: number;
  /** Cumulative output-token budget of one request. */
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface ProjectContextInfo {
  name: string;
  legalSet: string;
  normDataset: string;
  region: string | null;
  subArea: string | null;
  priceDate: string | null;
  status: string;
  itemCount: number;
  categories: string[];
  selectedLines?: { line: number; name: string; normCode: string; quantity: number; unit: string }[];
}

export function systemPrompt(p: ProjectContextInfo): string {
  return [
    'Bạn là trợ lý lập dự toán xây dựng của phần mềm DUTOAN-AI (Việt Nam). Luôn trả lời bằng tiếng Việt, ngắn gọn, chính xác; số theo kiểu Việt Nam (1.650.000; 2,5).',
    'Căn cứ: TT 36/2026/TT-BXD (chi phí), TT 38/2026/TT-BXD (định mức dự toán), TT 11/2021 cho công trình cũ. Không bịa mã định mức, đơn giá hay điều khoản – luôn tra bằng công cụ.',
    '',
    'Ngữ cảnh công trình:',
    `- Tên: ${p.name} (trạng thái: ${p.status === 'approved' ? 'ĐÃ DUYỆT – không sửa được' : 'nháp'})`,
    `- Bộ pháp lý: ${p.legalSet}; bộ định mức: ${p.normDataset}`,
    `- Khu vực: ${p.region ?? '(chưa chọn)'}${p.subArea ? ` – ${p.subArea}` : ''}; ngày lập giá: ${p.priceDate ?? '(chưa đặt)'}`,
    `- Số công việc: ${p.itemCount}; hạng mục: ${p.categories.length ? p.categories.join('; ') : '(chưa có)'}`,
    ...(p.selectedLines?.length ? ['- Các dòng người dùng đang chọn:', ...p.selectedLines.map((l) => `  · dòng ${l.line}: ${l.normCode || '(chưa mã)'} ${l.name} – ${l.quantity} ${l.unit}`)] : []),
    '',
    'Quy tắc làm việc:',
    '1. Dùng công cụ để tra cứu (search_norms, suggest_codes, get_norm, list_items, get_cost_summary, search_resources, list_price_books, explain_rules, import_mapping_help). Công cụ tra cứu chạy ngay.',
    '2. Công cụ ghi (add_item, update_quantity, set_price, create_category, auto_assign_codes, regional_update, apply_price_book) CHỈ tạo BẢN XEM TRƯỚC. Sau khi gọi, nói rõ đã chuẩn bị bản xem trước và người dùng phải bấm “Áp dụng” – TUYỆT ĐỐI không nói đã áp dụng/đã thay đổi.',
    '3. Khi thiếu thông tin (khối lượng, hạng mục, đơn vị, mã chưa chắc chắn) hãy hỏi lại người dùng thay vì đoán. Mã có độ tin cậy thấp: nêu các lựa chọn.',
    '4. Với file Excel: hướng dẫn chọn cột / dùng import_mapping_help hoặc mở hộp thoại nhập; cột chủ yếu là số không phải tên công việc.',
    '5. Không tiết lộ khóa API hay cấu hình máy chủ. Từ chối yêu cầu không liên quan đến dự toán xây dựng.',
  ].join('\n');
}

export interface AgentResult {
  text: string;
  previews: { text: string; action: Action }[];
  commands: ('importFile' | 'regionalUpdate')[];
  trace: { tool: string; readOnly: boolean; ok: boolean }[];
  iterations: number;
  usage: { inputTokens: number; outputTokens: number };
}

const MAX_TOOL_RESULT_CHARS = 12000;

/**
 * Tool-calling loop: the model may call read-only tools (run directly) and write tools (which only
 * produce previews). Bounded by iterations, an output-token budget and a wall-clock timeout.
 */
export async function runAgent(
  provider: ChatProvider,
  env: ToolEnv,
  ctxInfo: ProjectContextInfo,
  history: { role: 'user' | 'assistant'; text: string }[],
  userText: string,
  limits: AgentLimits,
): Promise<AgentResult> {
  const tools = buildTools(env);
  const system = systemPrompt(ctxInfo);
  const messages: ChatMessage[] = [...history.map((h) => ({ role: h.role, content: h.text }) as ChatMessage), { role: 'user', content: userText }];
  const previews: AgentResult['previews'] = [];
  const commands: AgentResult['commands'] = [];
  const trace: AgentResult['trace'] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), limits.timeoutMs);
  let finalText = '';
  let iterations = 0;
  try {
    for (; iterations < limits.maxIterations; ) {
      iterations++;
      const remaining = limits.maxOutputTokens - usage.outputTokens;
      if (remaining <= 0) throw new AiError('limit', 'hết ngân sách token');
      const res = await provider.chat({ system, messages, tools: tools.specs, maxTokens: Math.min(2048, remaining), signal: ctrl.signal });
      usage.inputTokens += res.usage?.inputTokens ?? 0;
      usage.outputTokens += res.usage?.outputTokens ?? 0;
      if (!res.toolCalls.length) {
        finalText = res.text.trim();
        break;
      }
      messages.push({ role: 'assistant', content: res.text, toolCalls: res.toolCalls });
      for (const call of res.toolCalls) {
        const spec = tools.specs.find((s) => s.name === call.name);
        const r = tools.run(call.name, call.args);
        const failed = typeof r.data === 'object' && r.data !== null && 'error' in (r.data as object);
        trace.push({ tool: call.name, readOnly: spec?.readOnly ?? true, ok: !failed });
        if (r.preview) previews.push(r.preview);
        if (r.command && !commands.includes(r.command)) commands.push(r.command);
        let content = JSON.stringify(r.data);
        if (content.length > MAX_TOOL_RESULT_CHARS) content = content.slice(0, MAX_TOOL_RESULT_CHARS) + '…(đã cắt bớt)';
        if (r.preview) content = JSON.stringify({ ...(r.data as object), status: 'Đã tạo BẢN XEM TRƯỚC – CHƯA áp dụng. Người dùng phải bấm “Áp dụng”.' });
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content });
      }
    }
    if (!finalText && iterations >= limits.maxIterations) {
      finalText = `Đã đạt giới hạn ${limits.maxIterations} bước xử lý cho một yêu cầu.${previews.length ? ' Các bản xem trước đã chuẩn bị vẫn ở bên dưới để bạn xem và áp dụng.' : ' Hãy chia nhỏ yêu cầu hoặc bổ sung thông tin.'}`;
    }
  } catch (e) {
    if (ctrl.signal.aborted && !(e instanceof AiError && e.code === 'limit')) throw new AiError('timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
  return { text: finalText || (previews.length ? 'Tôi đã chuẩn bị bản xem trước bên dưới – bấm “Áp dụng” để thực hiện.' : 'Đã xử lý xong.'), previews, commands, trace, iterations, usage };
}

export function toReply(r: AgentResult, providerLabel: string): Extract<Reply, { type: 'agent' }> {
  return { type: 'agent', text: r.text, previews: r.previews, commands: r.commands, trace: r.trace, provider: providerLabel };
}

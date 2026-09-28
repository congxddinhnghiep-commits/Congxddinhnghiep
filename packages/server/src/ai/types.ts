export type ProviderId = 'openai' | 'anthropic' | 'offline';

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'ChatGPT (OpenAI)',
  anthropic: 'Claude (Anthropic)',
  offline: 'Ngoại tuyến (quy tắc)',
};

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the arguments. */
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  /** Read-only tools run directly; write tools only produce a PREVIEW. */
  readOnly: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  maxTokens: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
}

/** A tool-calling chat model. Keys live only in the server process environment. */
export interface ChatProvider {
  readonly id: 'openai' | 'anthropic';
  readonly model: string;
  chat(req: ChatRequest): Promise<ChatResult>;
}

export type AiErrorCode = 'no_key' | 'invalid_key' | 'quota' | 'rate_limit' | 'network' | 'timeout' | 'model' | 'limit' | 'unknown';

const MESSAGES: Record<AiErrorCode, string> = {
  no_key: 'Chưa có khóa API cho nhà cung cấp AI đã chọn.',
  invalid_key: 'Khóa API không hợp lệ hoặc đã bị thu hồi – kiểm tra lại biến môi trường của khóa.',
  quota: 'Tài khoản AI đã hết hạn mức (quota) hoặc chưa thanh toán.',
  rate_limit: 'Nhà cung cấp AI đang giới hạn tốc độ – thử lại sau ít phút.',
  network: 'Không kết nối được tới nhà cung cấp AI (lỗi mạng).',
  timeout: 'Nhà cung cấp AI phản hồi quá lâu (hết thời gian chờ).',
  model: 'Tên mô hình không tồn tại hoặc tài khoản chưa được cấp quyền dùng mô hình này.',
  limit: 'Đã đạt giới hạn số bước / số token cho một yêu cầu.',
  unknown: 'Lỗi không xác định từ nhà cung cấp AI.',
};

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    detail?: string,
  ) {
    super(detail ? `${MESSAGES[code]} (${detail})` : MESSAGES[code]);
  }
}

/** Remove anything that looks like an API key before an error text is shown or logged. */
export function scrub(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_\-]{6,}/g, 'sk-***').replace(/Bearer\s+[A-Za-z0-9_\-.]{8,}/gi, 'Bearer ***');
}

import Anthropic from '@anthropic-ai/sdk';
import { AiError, scrub, type ChatMessage, type ChatProvider, type ChatRequest, type ChatResult } from './types.js';

export interface AnthropicLike {
  messages: { create(body: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<unknown> };
}

interface Message {
  content: ({ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } | { type: string })[];
  usage?: { input_tokens: number; output_tokens: number };
  stop_reason?: string;
}

/** Messages API content blocks; consecutive tool results are grouped into one user turn. */
function toAnthropic(messages: ChatMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1] as { role?: string; content?: unknown[] } | undefined;
      if (last?.role === 'user' && Array.isArray(last.content) && (last.content[0] as { type?: string })?.type === 'tool_result') last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    } else if (m.role === 'assistant') {
      const content: unknown[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
      out.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '…' }] });
    } else out.push({ role: 'user', content: m.content });
  }
  return out;
}

export function mapAnthropicError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  const err = e as { status?: number; name?: string; message?: string };
  if (err.name === 'AbortError' || err.name === 'APIUserAbortError') return new AiError('timeout');
  if (err.status === 401 || err.status === 403) return new AiError('invalid_key');
  if (err.status === 429) return new AiError('rate_limit');
  if (err.status === 402) return new AiError('quota');
  if (err.status === 404) return new AiError('model');
  if (err.name === 'APIConnectionTimeoutError') return new AiError('timeout');
  if (err.name === 'APIConnectionError' || err.status === undefined) return new AiError('network', scrub(err.message ?? ''));
  if (err.status === 400 && /credit|balance|billing/i.test(err.message ?? '')) return new AiError('quota');
  return new AiError('unknown', scrub(`${err.status ?? ''} ${err.message ?? ''}`.trim()));
}

/** Claude through the Anthropic Messages API tool use. */
export class AnthropicProvider implements ChatProvider {
  readonly id = 'anthropic' as const;
  private client: AnthropicLike;

  constructor(
    apiKey: string,
    readonly model: string,
    client?: AnthropicLike,
  ) {
    this.client = client ?? (new Anthropic({ apiKey, maxRetries: 1 }) as unknown as AnthropicLike);
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    try {
      const res = (await this.client.messages.create(
        {
          model: this.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: toAnthropic(req.messages),
          ...(req.tools.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })), tool_choice: { type: 'auto' } } : {}),
        },
        { signal: req.signal },
      )) as Message;
      const text = res.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      const toolCalls = res.content
        .filter((b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} }));
      return { text, toolCalls, usage: res.usage ? { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } : undefined };
    } catch (e) {
      throw mapAnthropicError(e);
    }
  }
}

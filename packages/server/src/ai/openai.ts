import OpenAI from 'openai';
import { AiError, scrub, type ChatMessage, type ChatProvider, type ChatRequest, type ChatResult } from './types.js';

/** Minimal shape of the OpenAI client we use (lets tests inject a fake without network). */
export interface OpenAiLike {
  chat: { completions: { create(body: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<unknown> } };
}

interface Completion {
  choices: { message: { content: string | null; tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[] } }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

function toOpenAi(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}),
      };
    }
    return { role: 'user', content: m.content };
  });
}

export function mapOpenAiError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  const err = e as { status?: number; code?: string; name?: string; message?: string; error?: { code?: string } };
  if (err.name === 'AbortError' || err.name === 'APIUserAbortError') return new AiError('timeout');
  const code = err.code ?? err.error?.code;
  if (err.status === 401) return new AiError('invalid_key');
  if (err.status === 429) return new AiError(code === 'insufficient_quota' ? 'quota' : 'rate_limit');
  if (err.status === 404 || code === 'model_not_found') return new AiError('model');
  if (err.status === 402) return new AiError('quota');
  if (err.name === 'APIConnectionError' || err.name === 'APIConnectionTimeoutError' || err.status === undefined) return err.name === 'APIConnectionTimeoutError' ? new AiError('timeout') : new AiError('network', scrub(err.message ?? ''));
  return new AiError('unknown', scrub(`${err.status ?? ''} ${err.message ?? ''}`.trim()));
}

/** ChatGPT through OpenAI function calling (chat completions). */
export class OpenAiProvider implements ChatProvider {
  readonly id = 'openai' as const;
  private client: OpenAiLike;

  constructor(
    apiKey: string,
    readonly model: string,
    client?: OpenAiLike,
  ) {
    this.client = client ?? (new OpenAI({ apiKey, maxRetries: 1 }) as unknown as OpenAiLike);
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    try {
      const res = (await this.client.chat.completions.create(
        {
          model: this.model,
          max_completion_tokens: req.maxTokens,
          messages: [{ role: 'system', content: req.system }, ...toOpenAi(req.messages)],
          ...(req.tools.length
            ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })), tool_choice: 'auto' }
            : {}),
        },
        { signal: req.signal },
      )) as Completion;
      const msg = res.choices?.[0]?.message;
      if (!msg) throw new AiError('unknown', 'phản hồi rỗng');
      return {
        text: msg.content ?? '',
        toolCalls: (msg.tool_calls ?? [])
          .filter((c) => c.type === 'function')
          .map((c) => {
            let args: Record<string, unknown> = {};
            try {
              args = c.function.arguments ? (JSON.parse(c.function.arguments) as Record<string, unknown>) : {};
            } catch {
              args = { __invalidJson: c.function.arguments };
            }
            return { id: c.id, name: c.function.name, args };
          }),
        usage: res.usage ? { inputTokens: res.usage.prompt_tokens, outputTokens: res.usage.completion_tokens } : undefined,
      };
    } catch (e) {
      throw mapOpenAiError(e);
    }
  }
}

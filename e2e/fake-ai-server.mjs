// Tiny fake OpenAI / Anthropic API for the E2E test (the SDKs honour OPENAI_BASE_URL / ANTHROPIC_BASE_URL).
import http from 'node:http';

export function startFakeAi(port, keys) {
  const seen = { auth: [], requests: 0 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.requests++;
      seen.auth.push(req.headers.authorization ?? req.headers['x-api-key'] ?? '');
      const json = (o) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(o));
      };
      let b = {};
      try {
        b = JSON.parse(body || '{}');
      } catch {}
      if (req.url?.endsWith('/chat/completions')) {
        const msgs = b.messages ?? [];
        const last = msgs[msgs.length - 1] ?? {};
        const usage = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };
        const base = { id: 'x', object: 'chat.completion', created: 0, model: b.model };
        if (!b.tools) return json({ ...base, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } }], usage });
        if (last.role === 'tool') return json({ ...base, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Đã chuẩn bị bản xem trước (AI giả lập) – bấm Áp dụng để thực hiện.' } }], usage });
        if (String(last.content).includes('thêm')) {
          const args = JSON.stringify({ normCode: 'AF.11110', quantity: 3, categoryName: 'PHẦN MÓNG' });
          return json({ ...base, choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'add_item', arguments: args } }] } }], usage });
        }
        return json({ ...base, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Tôi là AI giả lập.' } }], usage });
      }
      if (req.url?.includes('/messages')) return json({ id: 'm', type: 'message', role: 'assistant', model: b.model, content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 2 } });
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, seen, close: () => new Promise((r) => server.close(() => r())) })));
}

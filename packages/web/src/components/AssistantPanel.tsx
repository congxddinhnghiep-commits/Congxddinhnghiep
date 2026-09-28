import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Action, Intent, PendingField, Reply } from '@dutoan/core';
import { api, downloadExcel } from '../api';

type Msg =
  | { from: 'user'; text: string }
  | { from: 'bot'; reply: Reply; done?: boolean; doneItems?: number[] }
  | { from: 'info'; text: string; error?: boolean };

const EXAMPLES = [
  'thêm 50 m3 bê tông cột mác 300 vào hạng mục phần thân',
  'tìm mã định mức đào đất móng',
  'đổi giá xi măng PCB40 thành 1.650.000 đ/tấn',
  'sửa khối lượng dòng 1 thành 2*3,5*0,3',
  'tính lại',
  'xuất excel',
];

/** Trợ lý AI: nhận lệnh tiếng Việt, hỏi lại khi thiếu thông tin, xem trước và chỉ thực hiện khi người dùng xác nhận. */
export function AssistantPanel({
  projectId,
  provider,
  providerLabel,
  providerModel,
  onChanged,
  onOpenImport,
  onOpenRegional,
  onClose,
}: {
  projectId: number;
  provider: string;
  providerLabel: string;
  providerModel: string | null;
  onChanged: () => Promise<void>;
  onOpenImport: () => void;
  onOpenRegional: () => void;
  onClose: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      from: 'info',
      text: `Xin chào! Tôi là trợ lý lập dự toán (${provider === 'offline' ? 'chế độ ngoại tuyến – theo quy tắc' : `${providerLabel}${providerModel ? ` · ${providerModel}` : ''}`}). Hãy nhập yêu cầu bằng tiếng Việt, có dấu hoặc không dấu. Mọi thay đổi đều được xem trước và chỉ thực hiện khi bạn bấm Áp dụng / Xác nhận, và hoàn tác được.`,
    },
  ]);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<PendingField | undefined>();
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [msgs]);

  const push = (m: Msg) => setMsgs((prev) => [...prev, m]);
  const markDone = (idx: number) => setMsgs((prev) => prev.map((m, i) => (i === idx && m.from === 'bot' ? { ...m, done: true } : m)));

  const handleReply = async (reply: Reply) => {
    setPending(reply.type === 'question' ? reply.pending : undefined);
    push({ from: 'bot', reply });
    if (reply.type === 'agent') {
      try {
        if (reply.commands.includes('importFile')) onOpenImport();
        if (reply.commands.includes('regionalUpdate')) onOpenRegional();
      } catch (e) {
        push({ from: 'info', text: (e as Error).message, error: true });
      }
    }
    if (reply.type === 'command') {
      try {
        if (reply.command === 'recalc') await onChanged();
        else if (reply.command === 'exportExcel') await downloadExcel(projectId);
        else if (reply.command === 'importFile') onOpenImport();
        else if (reply.command === 'regionalUpdate') onOpenRegional();
        else if (reply.command === 'undo') {
          const r = await api.undo(projectId);
          push({ from: 'info', text: r.text });
          await onChanged();
        }
      } catch (e) {
        push({ from: 'info', text: (e as Error).message, error: true });
      }
    }
  };

  const send = async (body: { text?: string; intent?: Intent }, label: string) => {
    push({ from: 'user', text: label });
    setBusy(true);
    try {
      const history = msgs
        .flatMap((m): { role: 'user' | 'assistant'; text: string }[] =>
          m.from === 'user' ? [{ role: 'user', text: m.text }] : m.from === 'bot' && (m.reply.type === 'agent' || m.reply.type === 'message') ? [{ role: 'assistant', text: m.reply.text }] : [],
        )
        .slice(-8);
      const reply = await api.assistant(projectId, { ...body, pending: body.text ? pending : undefined, history: body.text ? history : undefined });
      await handleReply(reply);
    } catch (e) {
      push({ from: 'info', text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setText('');
    send({ text: t }, t);
  };

  const confirm = async (idx: number, reply: Extract<Reply, { type: 'preview' }>) => {
    markDone(idx);
    setBusy(true);
    try {
      const r = await api.confirmAction(projectId, reply.action, reply.text.replace(/\s*Xác nhận\?$/, ''));
      push({ from: 'info', text: `✔ ${r.text}` });
      await onChanged();
    } catch (e) {
      push({ from: 'info', text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const applyPreview = async (idx: number, k: number, p: { text: string; action: Action }) => {
    setMsgs((prev) => prev.map((m, i) => (i === idx && m.from === 'bot' ? { ...m, doneItems: [...(m.doneItems ?? []), k] } : m)));
    setBusy(true);
    try {
      const r = await api.confirmAction(projectId, p.action, p.text);
      push({ from: 'info', text: `✔ ${r.text}` });
      await onChanged();
    } catch (e) {
      push({ from: 'info', text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    try {
      const r = await api.undo(projectId);
      push({ from: 'info', text: r.text });
      await onChanged();
    } catch (e) {
      push({ from: 'info', text: (e as Error).message, error: true });
    }
  };

  return (
    <aside className="assistant">
      <div className="assistant-head">
        <b>🤖 Trợ lý AI</b>
        <span className="assistant-provider" data-testid="assistant-provider">
          {provider === 'offline' ? 'Ngoại tuyến' : `${providerLabel}${providerModel ? ` · ${providerModel}` : ''}`}
        </span>
        <span className="spacer" />
        <button className="small" onClick={undo} title="Hoàn tác thao tác gần nhất của trợ lý">
          ↶ Hoàn tác
        </button>
        <button className="icon" onClick={onClose} aria-label="Đóng trợ lý">
          ×
        </button>
      </div>
      <div className="assistant-body">
        {msgs.map((m, i) => {
          if (m.from === 'user')
            return (
              <div key={i} className="msg user">
                {m.text}
              </div>
            );
          if (m.from === 'info')
            return (
              <div key={i} className={`msg info ${m.error ? 'err' : ''}`}>
                {m.text}
              </div>
            );
          const r = m.reply;
          return (
            <div key={i} className={`msg bot ${r.type}`}>
              <div className="pre">{r.text}</div>
              {r.type === 'message' && r.table && (
                <table className="table compact">
                  <thead>
                    <tr>
                      {r.table.columns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {r.table.rows.map((row, j) => (
                      <tr key={j}>
                        {row.map((c, k) => (
                          <td key={k}>{c}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {(r.type === 'question' || r.type === 'message') && r.options && r.options.length > 0 && (
                <div className="options">
                  {r.options.map((o, j) => (
                    <button key={j} disabled={m.done || busy} onClick={() => (markDone(i), send({ intent: o.intent }, o.label))}>
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
              {r.type === 'agent' && (
                <>
                  {r.trace.length > 0 && (
                    <div className="agent-trace" title="Các công cụ mô hình đã dùng">
                      {r.trace.map((t, j) => (
                        <span key={j} className={`tool ${t.readOnly ? '' : 'write'} ${t.ok ? '' : 'fail'}`}>
                          {t.readOnly ? '🔎' : '✎'} {t.tool}
                        </span>
                      ))}
                    </div>
                  )}
                  {r.previews.map((p, k) => (
                    <div key={k} className="agent-preview" data-testid="agent-preview">
                      <div className="pre">{p.text}</div>
                      <div className="options">
                        <button className="primary" data-testid="agent-apply" disabled={m.doneItems?.includes(k) || busy} onClick={() => applyPreview(i, k, p)}>
                          Áp dụng
                        </button>
                        <button data-testid="agent-cancel" disabled={m.doneItems?.includes(k) || busy} onClick={() => (setMsgs((prev) => prev.map((x, ii) => (ii === i && x.from === 'bot' ? { ...x, doneItems: [...(x.doneItems ?? []), k] } : x))), push({ from: 'info', text: 'Đã hủy.' }))}>
                          Hủy
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
              {r.type === 'preview' && (
                <div className="options">
                  <button className="primary" disabled={m.done || busy} onClick={() => confirm(i, r)}>
                    Xác nhận
                  </button>
                  <button disabled={m.done || busy} onClick={() => (markDone(i), push({ from: 'info', text: 'Đã hủy.' }))}>
                    Hủy
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {busy && <div className="msg info">Đang xử lý…</div>}
        <div ref={endRef} />
      </div>
      {msgs.length <= 1 && (
        <div className="examples">
          {EXAMPLES.map((e) => (
            <button key={e} className="chip" onClick={() => setText(e)}>
              {e}
            </button>
          ))}
        </div>
      )}
      <form className="assistant-input" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={pending ? 'Nhập câu trả lời…' : 'Nhập yêu cầu, ví dụ: thêm 20 m3 xây tường gạch…'}
          disabled={busy}
        />
        <button className="primary" disabled={busy || !text.trim()}>
          Gửi
        </button>
      </form>
    </aside>
  );
}

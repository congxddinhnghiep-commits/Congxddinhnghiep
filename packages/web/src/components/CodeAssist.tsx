import { useState } from 'react';
import { api, type AutoAssignPlan, type SuggestionCandidate } from '../api';
import { Modal } from './Modal';

const pctTxt = (c: number) => `${Math.round(c * 100)}%`;

/** Suggestion badge for an item without a valid code: accept the best one or pick among the top 5. */
export function SuggestionCell({
  projectId,
  itemId,
  candidates,
  onDone,
}: {
  projectId: number;
  itemId: number;
  candidates: SuggestionCandidate[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  if (!candidates.length) return <span className="code-state review" title="Không tìm thấy định mức phù hợp (kiểm tra đơn vị)">cần xem lại</span>;
  const best = candidates[0];
  const accept = async (code: string) => {
    try {
      await api.assignCode(projectId, itemId, code);
      setOpen(false);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <span className="suggest">
      <button className={`chip-sug ${best.confidence >= 0.8 ? 'hi' : 'lo'}`} title={`${best.name}\nVì sao: ${best.why}\nBấm để chấp nhận`} onClick={() => accept(best.code)}>
        {best.code} · {pctTxt(best.confidence)}
      </button>
      <button className="icon tiny" title="Xem 5 gợi ý" onClick={() => setOpen(true)}>
        ▾
      </button>
      {open && (
        <Modal title="Gợi ý mã định mức" onClose={() => setOpen(false)} wide>
          {error && <div className="error">{error}</div>}
          <table className="table compact">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên định mức</th>
                <th>ĐV</th>
                <th className="num">Tin cậy</th>
                <th>Vì sao</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.code}>
                  <td>{c.code}</td>
                  <td>{c.name}</td>
                  <td>{c.unit}</td>
                  <td className="num">{pctTxt(c.confidence)}</td>
                  <td className="hint">{c.why}</td>
                  <td>
                    <button className="small primary" onClick={() => accept(c.code)}>
                      Chọn
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </span>
  );
}

/** Bulk "Gắn mã tự động": preview (≥ threshold) → apply; items below stay "cần xem lại". */
export function AutoAssignDialog({ projectId, onClose, onDone }: { projectId: number; onClose: () => void; onDone: () => void }) {
  const [threshold, setThreshold] = useState('80');
  const [plan, setPlan] = useState<AutoAssignPlan | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const preview = async () => {
    setBusy(true);
    setMsg('');
    try {
      setPlan(await api.autoAssignPreview(projectId, Number(threshold.replace(',', '.')) / 100));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const r = await api.autoAssign(projectId, plan.assign);
      setMsg(r.text);
      setPlan(null);
      onDone();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Gắn mã tự động" onClose={onClose} wide>
      <div className="toolbar">
        <label>
          Ngưỡng độ tin cậy (%)&nbsp;
          <input className="num" style={{ width: 70 }} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </label>
        <button className="primary" disabled={busy} onClick={preview}>
          Xem trước
        </button>
        <span className="hint">Mã gắn tự động được đánh dấu “tự động” và phải được xác nhận trước khi duyệt dự toán.</span>
      </div>
      {msg && <p className="ok">{msg}</p>}
      {plan && (
        <>
          <h4>
            Sẽ gắn mã: {plan.assign.length} công việc · Cần xem lại (dưới ngưỡng): {plan.below}
          </h4>
          <div className="table-scroll" style={{ maxHeight: 360 }}>
            <table className="table compact">
              <thead>
                <tr>
                  <th>Dòng</th>
                  <th>Mô tả gốc</th>
                  <th>Mã đề xuất</th>
                  <th className="num">Tin cậy</th>
                  <th>Vì sao</th>
                </tr>
              </thead>
              <tbody>
                {plan.assign.map((a) => (
                  <tr key={a.itemId}>
                    <td>{a.line}</td>
                    <td>{a.name}</td>
                    <td title={a.normName}>{a.normCode}</td>
                    <td className="num">{pctTxt(a.confidence)}</td>
                    <td className="hint">{a.why}</td>
                  </tr>
                ))}
                {plan.review.map((r) => (
                  <tr key={r.itemId} className="muted">
                    <td>{r.line}</td>
                    <td>{r.name}</td>
                    <td>{r.best ? r.best.code : '—'}</td>
                    <td className="num">{r.best ? pctTxt(r.best.confidence) : ''}</td>
                    <td>
                      <span className="code-state review">cần xem lại</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <button onClick={() => setPlan(null)}>Hủy</button>
            <button className="primary" disabled={busy || !plan.assign.length} onClick={apply}>
              Gắn mã cho {plan.assign.length} công việc
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

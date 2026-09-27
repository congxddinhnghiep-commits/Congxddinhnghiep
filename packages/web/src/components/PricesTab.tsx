import { useEffect, useState } from 'react';
import { RESOURCE_TYPE_LABELS, type ResourceType } from '@dutoan/core';
import { api, type AppConfig, type PriceRow, type Project } from '../api';
import { PriceHistory, ProjectPriceBooks } from './ProjectPriceBooks';
import { TransportDialog } from './TransportDialog';
import { money, parseInputNumber } from '../format';

export function PricesTab({ project, config, onChanged }: { project: Project; config: AppConfig; onChanged: () => void }) {
  const projectId = project.id;
  const [history, setHistory] = useState<string | null>(null);
  const [transport, setTransport] = useState<PriceRow | null>(null);
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [all, setAll] = useState(false);
  const [type, setType] = useState<ResourceType | ''>('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');

  const load = () => api.prices(projectId, all).then(setRows);
  useEffect(() => {
    load();
  }, [projectId, all]);

  const save = async (code: string, text: string) => {
    setError('');
    const price = text.trim() === '' ? null : parseInputNumber(text);
    if (text.trim() !== '' && price === null) return setError('Giá không hợp lệ');
    try {
      await api.setPrice(projectId, code, price);
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const f = filter.trim().toLowerCase();
  const shown = rows.filter((r) => (!type || r.type === type) && (!f || `${r.code} ${r.name}`.toLowerCase().includes(f)));

  return (
    <div>
      <ProjectPriceBooks project={project} config={config} onChanged={() => (load(), onChanged())} />
      <h3>Giá tài nguyên của công trình</h3>
      <div className="toolbar">
        <select value={type} onChange={(e) => setType(e.target.value as ResourceType | '')}>
          <option value="">Tất cả loại</option>
          {Object.entries(RESOURCE_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input placeholder="Lọc theo mã, tên…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Hiện cả tài nguyên chưa dùng
        </label>
        <span className="hint">Ô “Giá nhập tay” ghi đè mọi nguồn khác; để trống để dùng bộ đơn giá đã chọn hoặc giá gốc.</span>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Mã</th>
              <th>Tên vật liệu / nhân công / máy</th>
              <th>ĐV</th>
              <th>Loại</th>
              <th className="num">Giá gốc (đ)</th>
              <th className="num" style={{ width: 150 }}>
                Giá nhập tay (đ)
              </th>
              <th className="num">Giá áp dụng (đ)</th>
              <th>Nguồn giá</th>
              <th className="num">Chênh lệch (đ)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const diff = r.effectivePrice - r.basePrice;
              return (
                <tr key={r.code}>
                  <td>{r.code}</td>
                  <td>
                    <button className="link" title="Xem lịch sử giá" onClick={() => setHistory(r.code)}>
                      {r.name}
                    </button>{' '}
                    {r.isSample && <span className="tag">mẫu</span>}
                  </td>
                  <td>{r.unit}</td>
                  <td>{r.type}</td>
                  <td className="num">{money(r.basePrice)}</td>
                  <td>
                    <input
                      className="cell num"
                      key={`${r.code}-${r.projectPrice}`}
                      defaultValue={r.projectPrice === null ? '' : money(r.projectPrice)}
                      placeholder={money(r.basePrice)}
                      onBlur={(e) => {
                        const cur = r.projectPrice === null ? '' : money(r.projectPrice);
                        if (e.target.value !== cur) save(r.code, e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const inputs = [...document.querySelectorAll<HTMLInputElement>('.table input.cell')];
                          const i = inputs.indexOf(e.currentTarget);
                          (inputs[i + 1] ?? e.currentTarget).focus();
                        }
                      }}
                    />
                  </td>
                  <td className="num">{money(r.effectivePrice)}</td>
                  <td className={`source-cell ${r.source?.kind === 'base' ? 'base' : ''}`}>
                    {r.source?.label}
                    {r.source?.notes?.length ? ` (${r.source.notes.join('; ')})` : ''}
                  </td>
                  <td className={`num ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}`}>{diff ? money(diff) : ''}</td>
                  <td>
                    {r.type === 'VL' && (
                      <button className="small" title="Vận chuyển đến công trình" onClick={() => setTransport(r)}>
                        🚚{r.source?.transport ? ` +${money(r.source.transport)}` : ''}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {transport && <TransportDialog projectId={projectId} resource={transport} onClose={() => setTransport(null)} onSaved={() => (load(), onChanged())} />}
      {history && <PriceHistory code={history} onClose={() => setHistory(null)} />}
      {shown.length === 0 && <p className="hint">Chưa có tài nguyên nào. Thêm công tác vào dự toán để xuất hiện vật liệu, nhân công, máy.</p>}
    </div>
  );
}

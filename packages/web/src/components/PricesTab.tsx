import { useEffect, useState } from 'react';
import { RESOURCE_TYPE_LABELS, type ResourceType } from '@dutoan/core';
import { api, type PriceRow } from '../api';
import { money, parseInputNumber } from '../format';

export function PricesTab({ projectId, onChanged }: { projectId: number; onChanged: () => void }) {
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
        <span className="hint">Nhập giá tại thời điểm lập dự toán; để trống để dùng giá gốc.</span>
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
              <th className="num" style={{ width: 160 }}>
                Giá công trình (đ)
              </th>
              <th className="num">Chênh lệch (đ)</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const diff = r.projectPrice === null ? 0 : r.projectPrice - r.basePrice;
              return (
                <tr key={r.code}>
                  <td>{r.code}</td>
                  <td>
                    {r.name} {r.isSample && <span className="tag">mẫu</span>}
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
                  <td className={`num ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}`}>{diff ? money(diff) : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.length === 0 && <p className="hint">Chưa có tài nguyên nào. Thêm công tác vào dự toán để xuất hiện vật liệu, nhân công, máy.</p>}
    </div>
  );
}

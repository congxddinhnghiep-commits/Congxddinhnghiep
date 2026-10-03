import { useCallback, useEffect, useState } from 'react';
import { api, type ProjectSummaryDTO } from '../api';
import { money } from '../format';

/** Update 6 A: "Tổng hợp dự án" – one row per hạng mục công trình + project-level lines the user defines + grand total. */
export function ProjectSummaryTab({ projectId, onSelectPackage }: { projectId: number; onSelectPackage: (id: number) => void }) {
  const [data, setData] = useState<ProjectSummaryDTO | null>(null);
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'rate' | 'amount'>('rate');
  const [value, setValue] = useState('');

  const reload = useCallback(async () => {
    try {
      setData(await api.projectSummary(projectId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const addLine = async () => {
    if (!label.trim()) return;
    try {
      await api.createSummaryLine(projectId, { label: label.trim(), kind, value: Number(value) || 0 });
      setLabel('');
      setValue('');
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeLine = async (id: number) => {
    try {
      await api.deleteSummaryLine(projectId, id);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div>Đang tải…</div>;

  return (
    <div className="project-summary" data-testid="project-summary">
      <table className="table">
        <thead>
          <tr>
            <th>STT</th>
            <th>Hạng mục công trình</th>
            <th className="num">Diện tích (m²)</th>
            <th className="num">Giá trị</th>
            <th className="num">Đơn giá/m²</th>
            <th>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {data.packages.map((p, i) => (
            <tr key={p.workPackage.id}>
              <td>{i + 1}</td>
              <td>
                <button className="link" onClick={() => onSelectPackage(p.workPackage.id)}>
                  {p.workPackage.name}
                </button>
                {p.workPackage.mode === 'bao_gia' && <span className="badge">báo giá</span>}
                <span className="hint"> · {p.itemCount} công việc</span>
              </td>
              <td className="num">{p.workPackage.areaM2 ?? ''}</td>
              <td className="num">{money(p.value)}</td>
              <td className="num">{p.unitValue !== null ? money(p.unitValue) : ''}</td>
              <td>{p.workPackage.note}</td>
            </tr>
          ))}
          <tr className="rt-row-category">
            <td />
            <td colSpan={3}>
              <b>Cộng hạng mục công trình</b>
            </td>
            <td className="num">
              <b>{money(data.packagesTotal)}</b>
            </td>
            <td />
          </tr>
          {data.lines.map((l) => (
            <tr key={l.id}>
              <td />
              <td>
                {l.label} {l.kind === 'rate' && <span className="hint">({l.value}%)</span>}
              </td>
              <td />
              <td className="num">{money(l.amount)}</td>
              <td />
              <td>
                <button className="icon small" title="Xóa dòng" onClick={() => removeLine(l.id)}>
                  🗑
                </button>
              </td>
            </tr>
          ))}
          <tr className="rt-row-category">
            <td />
            <td colSpan={3}>
              <b>TỔNG CỘNG DỰ ÁN</b>
            </td>
            <td className="num">
              <b>{money(data.grandTotal)}</b>
            </td>
            <td />
          </tr>
        </tbody>
      </table>

      <div className="form inline" style={{ marginTop: 12 }}>
        <input placeholder="Tên dòng (vd. Chi phí quản lý dự án)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value as 'rate' | 'amount')}>
          <option value="rate">% trên tổng hạng mục</option>
          <option value="amount">Số tiền (đ)</option>
        </select>
        <input type="number" placeholder={kind === 'rate' ? 'vd. 3' : 'vd. 50000000'} value={value} onChange={(e) => setValue(e.target.value)} />
        <button onClick={addLine}>+ Thêm dòng</button>
      </div>
    </div>
  );
}

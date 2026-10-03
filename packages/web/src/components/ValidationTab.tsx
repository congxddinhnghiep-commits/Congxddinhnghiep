import { useEffect, useState } from 'react';
import { api, type ValidationReport } from '../api';
import { money } from '../format';

const STATUS = { pass: '✓ Đạt', warning: '⚠ Cảnh báo', fail: '✗ Lỗi' };
const SEV = { error: 'Lỗi', warning: 'Cảnh báo', info: 'Thông tin' };
const PRICE_SOURCE_LABELS: Record<string, string> = { dia_phuong: 'Địa phương', ho_so: 'Hồ sơ', chiet_tinh: 'Chiết tính', thu_cong: 'Thủ công' };

/** Báo cáo kiểm tra dự toán – các kiểm tra bắt buộc của engine dự toán. */
export function ValidationTab({ projectId, version }: { projectId: number; version: unknown }) {
  const [r, setR] = useState<ValidationReport | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    api
      .validation(projectId)
      .then((x) => {
        setR(x);
        setOpen(Object.fromEntries(x.checks.filter((c) => c.status !== 'pass').map((c) => [c.id, true])));
      })
      .catch((e) => setError(e.message));
  }, [projectId, version]);
  if (error) return <div className="error">{error}</div>;
  if (!r) return <p>Đang kiểm tra…</p>;
  return (
    <div className="validation">
      <div className="toolbar">
        <span className="vbadge fail">{r.counts.error} lỗi</span>
        <span className="vbadge warning">{r.counts.warning} cảnh báo</span>
        <span className="vbadge info">{r.counts.info} thông tin</span>
        <span className="hint">
          Bộ pháp lý: {r.project.legalSet} · ngày lập giá {r.project.priceDate ?? 'chưa nhập'} · kiểm tra lúc {new Date(r.generatedAt).toLocaleString('vi-VN')}
        </span>
      </div>
      {r.priceSourceSummary.length > 0 && (
        <section className="vcheck" data-testid="price-source-summary">
          <h4>Tổng hợp theo nguồn giá</h4>
          <table className="table compact">
            <thead>
              <tr>
                <th>Nguồn giá</th>
                <th className="num">Số công việc</th>
                <th className="num">Giá trị (đ)</th>
              </tr>
            </thead>
            <tbody>
              {r.priceSourceSummary.map((s) => (
                <tr key={s.kind}>
                  <td>{PRICE_SOURCE_LABELS[s.kind] ?? s.kind}</td>
                  <td className="num">{s.count}</td>
                  <td className="num">{money(s.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {r.checks.map((c) => (
        <section key={c.id} className={`vcheck v-${c.status}`}>
          <h4 onClick={() => setOpen({ ...open, [c.id]: !open[c.id] })}>
            <span className={`vbadge ${c.status}`}>{STATUS[c.status]}</span> {c.title} <span className="hint">({c.findings.length})</span>
          </h4>
          {open[c.id] && (
            <>
              <p className="hint">Quy tắc: {c.rule}</p>
              {c.findings.length === 0 ? (
                <p className="ok">Không có vấn đề.</p>
              ) : (
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Mức</th>
                      <th>Dòng</th>
                      <th>Hạng mục</th>
                      <th>Mã</th>
                      <th>Nội dung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.findings.map((f, i) => (
                      <tr key={i}>
                        <td>
                          <span className={`vbadge ${f.severity === 'error' ? 'fail' : f.severity}`}>{SEV[f.severity]}</span>
                        </td>
                        <td>{f.line ?? ''}</td>
                        <td>{f.category ?? ''}</td>
                        <td>{f.code ?? ''}</td>
                        <td>{f.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </section>
      ))}
    </div>
  );
}

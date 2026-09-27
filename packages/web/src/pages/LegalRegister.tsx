import { useEffect, useState } from 'react';
import type { LegalSet, RateTable } from '@dutoan/core';
import { api, type LegalRegister as Register, type User } from '../api';
import { rate } from '../format';

const DOC_STATUS: Record<string, string> = { active: 'Còn hiệu lực', repealed: 'Hết hiệu lực' };
const fmtDate = (d: string | null | undefined) => (d ? d.split('-').reverse().join('/') : '—');
const tỷ = (v: number) => `${(v / 1e9).toLocaleString('vi-VN')} tỷ`;

function TableCard({ set, table, user, onChanged }: { set: LegalSet; table: RateTable; user: User; onChanged: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const isAdmin = user.role === 'admin';
  const patch = async (p: { status?: 'verified' | 'provisional'; interpolation?: 'none' | 'linear' }) => {
    setError('');
    try {
      await api.setRateTable(set.id, table.id, p);
      setConfirm(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const bracketed = !!table.brackets?.length;
  return (
    <div className="rate-table">
      <h4>
        {set.method === 'TT36_2026' ? `Bảng ${table.id}` : table.id} – {table.title}
        <span className={`status ${table.status}`}>{table.status === 'verified' ? '✓ Đã xác minh' : '⚠ TẠM (provisional)'}</span>
      </h4>
      <p className="hint">
        Nguồn: {table.source}. Cơ sở tra: <b>{table.basis}</b>
        {bracketed && (
          <>
            {' '}
            · Tra theo khoảng: <b>{table.interpolation === 'linear' ? 'nội suy tuyến tính' : 'không nội suy (lấy theo khoảng)'}</b>
          </>
        )}
        {table.status === 'verified' && table.verifiedBy && (
          <>
            {' '}
            · Xác minh bởi {table.verifiedBy} lúc {new Date(table.verifiedAt ?? '').toLocaleString('vi-VN')}
          </>
        )}
      </p>
      <div className="table-scroll">
        <table className="table compact">
          <thead>
            <tr>
              <th>Loại</th>
              {bracketed ? table.bracketLabels!.map((b) => <th key={b} className="num">{b}</th>) : <th className="num">Tỷ lệ (%)</th>}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                {r.values.map((v, i) => (
                  <td key={i} className="num">
                    {rate(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {bracketed && <p className="hint">Biên khoảng (≤): {table.brackets!.map(tỷ).join(' · ')}</p>}
      {error && <div className="error">{error}</div>}
      {isAdmin && (
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          {table.status === 'provisional' ? (
            confirm ? (
              <span className="warn-box">
                Tôi đã đối chiếu từng giá trị của bảng này với bản PDF đã ký (và phụ lục thay thế nếu có).{' '}
                <button className="primary small" onClick={() => patch({ status: 'verified' })}>
                  Xác nhận đã xác minh
                </button>{' '}
                <button className="small" onClick={() => setConfirm(false)}>
                  Hủy
                </button>
              </span>
            ) : (
              <button onClick={() => setConfirm(true)}>Đánh dấu đã xác minh…</button>
            )
          ) : (
            <button onClick={() => patch({ status: 'provisional' })}>Chuyển về TẠM</button>
          )}
          {bracketed && (
            <label className="check">
              <input
                type="checkbox"
                checked={table.interpolation === 'linear'}
                onChange={(e) => patch({ interpolation: e.target.checked ? 'linear' : 'none' })}
              />{' '}
              Nội suy giữa các khoảng (không có căn cứ trong TT 36/2026 – chỉ tra theo khoảng)
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/** Sổ đăng ký căn cứ pháp lý: văn bản, bộ pháp lý và bảng tỷ lệ kèm trạng thái xác minh. */
export function LegalRegister({ user }: { user: User }) {
  const [reg, setReg] = useState<Register | null>(null);
  const [error, setError] = useState('');
  const load = () =>
    api
      .legal()
      .then(setReg)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  if (error) return <main className="page error">{error}</main>;
  if (!reg) return <main className="page">Đang tải…</main>;

  return (
    <main className="page legal-page">
      <div className="page-head">
        <h2>Căn cứ pháp lý</h2>
        <span className="hint">Kiểm tra lần cuối: {fmtDate(reg.checkedAt)}</span>
      </div>
      <p className="hint">{reg.note}</p>

      <section>
        <h3>Văn bản pháp lý</h3>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Số hiệu</th>
                <th>Tên / vai trò</th>
                <th>Ban hành</th>
                <th>Hiệu lực</th>
                <th>Tình trạng</th>
                <th>Nguồn</th>
              </tr>
            </thead>
            <tbody>
              {reg.documents.map((d) => (
                <tr key={d.id}>
                  <td>
                    <b>
                      {d.type} {d.number}
                    </b>
                    <div className="hint">{d.issuer}</div>
                  </td>
                  <td>
                    {d.title}
                    <div className="hint">{d.role}</div>
                  </td>
                  <td>{fmtDate(d.issued)}</td>
                  <td>{fmtDate(d.effective)}</td>
                  <td>
                    <span className={`status ${d.status}`}>{DOC_STATUS[d.status]}</span>
                    {!d.verified && <div className="hint">chưa xác minh metadata</div>}
                  </td>
                  <td>
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noreferrer">
                        {new URL(d.url).hostname}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {reg.sets.map((set) => (
        <section key={set.id}>
          <h3>
            Bộ pháp lý: {set.label} {set.status === 'historical' ? <span className="status repealed">Lịch sử</span> : <span className="status active">Hiện hành</span>}
          </h3>
          <p className="hint">
            Áp dụng: {set.effectiveFrom ? `từ ${fmtDate(set.effectiveFrom)}` : ''}
            {set.effectiveTo ? ` đến ${fmtDate(set.effectiveTo)}` : ''} · Bộ định mức: {set.normDataset} · Văn bản:{' '}
            {set.documents.map((id) => reg.documents.find((d) => d.id === id)?.number ?? id).join(', ')}
          </p>
          <p className="warn-box">{set.note}</p>
          {Object.values(set.tables).map((t) => (
            <TableCard key={t.id} set={set} table={t} user={user} onChanged={load} />
          ))}
        </section>
      ))}
    </main>
  );
}

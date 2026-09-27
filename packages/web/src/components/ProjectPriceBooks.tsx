import { useEffect, useState } from 'react';
import { BOOK_TYPE_LABELS } from '@dutoan/core';
import { api, type AppConfig, type BookSel, type PriceBookInfo, type Project } from '../api';
import { money } from '../format';
import { Modal } from './Modal';

type Preview = Awaited<ReturnType<typeof api.previewPriceBooks>>;
const TYPES: BookSel['resourceType'][] = ['VL', 'NC', 'M'];

/** Region / period → proposed price books → selection per resource type with priority → diff preview → apply. */
export function ProjectPriceBooks({ project, config, onChanged }: { project: Project; config: AppConfig; onChanged: () => void }) {
  const [region, setRegion] = useState(project.region ?? '');
  const [subArea, setSubArea] = useState(project.subArea ?? '');
  const [data, setData] = useState<Awaited<ReturnType<typeof api.projectPriceBooks>> | null>(null);
  const [sel, setSel] = useState<BookSel[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = () =>
    api.projectPriceBooks(project.id).then((d) => {
      setData(d);
      setSel(d.selection);
    });
  useEffect(() => {
    load();
  }, [project.id]);

  const saveRegion = async () => {
    setError('');
    try {
      await api.updateProject(project.id, { region: region || null, subArea: subArea || null });
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const books = new Map((data?.books ?? []).map((b) => [b.id, b]));
  const add = (b: PriceBookInfo, t: BookSel['resourceType']) => {
    if (sel.some((s) => s.bookId === b.id && s.resourceType === t)) return;
    const priority = Math.max(0, ...sel.filter((s) => s.resourceType === t).map((s) => s.priority)) + 1;
    setSel([...sel, { bookId: b.id, resourceType: t, priority }]);
  };
  const move = (s: BookSel, dir: -1 | 1) => {
    const same = sel.filter((x) => x.resourceType === s.resourceType).sort((a, b) => a.priority - b.priority);
    const i = same.indexOf(s);
    const j = i + dir;
    if (j < 0 || j >= same.length) return;
    [same[i], same[j]] = [same[j], same[i]];
    const renum = new Map(same.map((x, k) => [x, k + 1]));
    setSel(sel.map((x) => (renum.has(x) ? { ...x, priority: renum.get(x)! } : x)));
  };
  const changed = JSON.stringify(sel) !== JSON.stringify(data?.selection ?? []);

  const doPreview = async () => {
    setError('');
    try {
      setPreview(await api.previewPriceBooks(project.id, sel));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const apply = async () => {
    setError('');
    try {
      await api.saveProjectPriceBooks(project.id, sel);
      setPreview(null);
      setMsg('Đã áp dụng bộ đơn giá – dự toán đã tính lại.');
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="pricebook-select">
      <h3>Bộ đơn giá áp dụng</h3>
      <div className="toolbar">
        <label>
          Tỉnh/thành&nbsp;
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">— chọn —</option>
            {config.regions.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label>
          Khu vực&nbsp;
          <input style={{ width: 140 }} value={subArea} onChange={(e) => setSubArea(e.target.value)} />
        </label>
        {(region !== (project.region ?? '') || subArea !== (project.subArea ?? '')) && (
          <button className="small primary" onClick={saveRegion}>
            Lưu khu vực
          </button>
        )}
        <span className="hint">Kỳ giá đề xuất theo ngày lập giá: {project.priceDate ?? 'hôm nay'}. Thứ tự áp giá: giá nhập tay → bộ giá theo ưu tiên → giá gốc (MẪU).</span>
      </div>
      {error && <div className="error">{error}</div>}
      {msg && <p className="ok">{msg}</p>}
      {data && (
        <div className="pb-grid">
          <div>
            <h4>Đề xuất (cùng tỉnh, kỳ giá ≤ ngày lập giá)</h4>
            {!project.region && <p className="hint">Chọn tỉnh/thành để xem đề xuất.</p>}
            {project.region && data.proposals.books.length === 0 && <p className="hint">Chưa có bộ đơn giá phù hợp. Thêm tại mục “Bộ đơn giá”.</p>}
            {data.proposals.books.map((b) => (
              <div key={b.id} className="pb-card">
                <div>
                  <b>{b.title}</b>{' '}
                  <span className={`status ${b.status === 'verified' ? 'verified' : 'provisional'}`}>{b.status === 'verified' ? 'đã xác minh' : 'nháp'}</span>
                  <div className="hint">
                    {BOOK_TYPE_LABELS[b.bookType]} · {b.rowCount} dòng · {b.vat === 'included' ? 'đã gồm VAT' : b.vat === 'excluded' ? 'chưa gồm VAT' : 'chưa rõ VAT'}
                  </div>
                </div>
                {b.bookType === 'TH' ? (
                  <span className="hint">đơn giá tổng hợp – chỉ tham khảo</span>
                ) : (
                  <button className="small" disabled={!b.rowCount} onClick={() => add(b, b.bookType as BookSel['resourceType'])} title={b.rowCount ? '' : 'Bộ chưa có dòng giá'}>
                    + Dùng cho {BOOK_TYPE_LABELS[b.bookType]}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div>
            <h4>Đang chọn</h4>
            {TYPES.map((t) => {
              const list = sel.filter((s) => s.resourceType === t).sort((a, b) => a.priority - b.priority);
              return (
                <div key={t} className="pb-type">
                  <b>{BOOK_TYPE_LABELS[t]}</b>
                  {list.length === 0 && <span className="hint"> – chưa chọn (dùng giá gốc)</span>}
                  <ol>
                    {list.map((s) => (
                      <li key={s.bookId}>
                        {books.get(s.bookId)?.title ?? s.bookId}{' '}
                        <button className="icon tiny" onClick={() => move(s, -1)} title="Ưu tiên cao hơn">
                          ▲
                        </button>
                        <button className="icon tiny" onClick={() => move(s, 1)} title="Ưu tiên thấp hơn">
                          ▼
                        </button>
                        <button className="icon tiny" onClick={() => setSel(sel.filter((x) => x !== s))} title="Bỏ">
                          ×
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
            {changed && (
              <div className="actions" style={{ justifyContent: 'flex-start' }}>
                <button onClick={() => setSel(data.selection)}>Hoàn lại</button>
                <button className="primary" onClick={doPreview}>
                  Xem chênh lệch giá
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {preview && (
        <Modal title="Chênh lệch giá khi đổi bộ đơn giá" onClose={() => setPreview(null)} wide>
          <p>
            {preview.rows.length} tài nguyên đổi giá · Tổng chênh lệch chi phí trực tiếp (trước hệ số):{' '}
            <b className={preview.totalDelta >= 0 ? 'up' : 'down'}>{money(preview.totalDelta)} đ</b>
          </p>
          <div className="table-scroll" style={{ maxHeight: 380 }}>
            <table className="table compact">
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Tên</th>
                  <th className="num">KL</th>
                  <th className="num">Giá cũ</th>
                  <th className="num">Giá mới</th>
                  <th className="num">Chênh lệch</th>
                  <th>Nguồn mới</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.code}>
                    <td>{r.code}</td>
                    <td>{r.name}</td>
                    <td className="num">{r.quantity.toLocaleString('vi-VN', { maximumFractionDigits: 3 })}</td>
                    <td className="num">{money(r.oldPrice)}</td>
                    <td className="num">{money(r.newPrice)}</td>
                    <td className={`num ${r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : ''}`}>{money(r.delta)}</td>
                    <td className="source-cell">{r.newSource}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <button onClick={() => setPreview(null)}>Hủy</button>
            <button className="primary" onClick={apply}>
              Áp dụng
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

/** So sánh giá của một tài nguyên theo kỳ / khu vực. */
export function PriceHistory({ code, onClose }: { code: string; onClose: () => void }) {
  const [h, setH] = useState<Awaited<ReturnType<typeof api.priceHistory>> | null>(null);
  useEffect(() => {
    api.priceHistory(code).then(setH);
  }, [code]);
  return (
    <Modal title={`Lịch sử giá ${code}`} onClose={onClose} wide>
      {!h ? (
        <p>Đang tải…</p>
      ) : (
        <>
          <p>
            {h.resource.name} ({h.resource.unit}) – giá gốc thư viện {money(h.resource.basePrice)} đ
          </p>
          {h.points.length === 0 ? (
            <p className="hint">Chưa có bộ đơn giá nào chứa tài nguyên này.</p>
          ) : (
            <table className="table compact">
              <thead>
                <tr>
                  <th>Kỳ</th>
                  <th>Bộ đơn giá</th>
                  <th>Tỉnh/thành – khu vực</th>
                  <th>VAT</th>
                  <th>ĐV</th>
                  <th className="num">Giá</th>
                  <th className="num">So với kỳ trước</th>
                </tr>
              </thead>
              <tbody>
                {h.points.map((p, i) => {
                  const prev = h.points[i - 1];
                  const d = prev && prev.unit === p.unit ? ((p.price - prev.price) / prev.price) * 100 : null;
                  return (
                    <tr key={i}>
                      <td>{p.periodStart}</td>
                      <td>{p.title}</td>
                      <td>
                        {p.region}
                        {p.subArea ? ` – ${p.subArea}` : ''}
                      </td>
                      <td>{p.vat === 'included' ? 'gồm' : p.vat === 'excluded' ? 'chưa gồm' : '?'}</td>
                      <td>{p.unit}</td>
                      <td className="num">{money(p.price)}</td>
                      <td className={`num ${d && d > 0 ? 'up' : d && d < 0 ? 'down' : ''}`}>{d === null ? '' : `${d > 0 ? '+' : ''}${d.toFixed(1).replace('.', ',')}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </Modal>
  );
}

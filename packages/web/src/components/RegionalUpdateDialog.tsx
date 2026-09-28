import { useEffect, useState } from 'react';
import { api, type AppConfig, type RegionalPreview, type RevisionDTO } from '../api';
import { money, qty } from '../format';
import { Modal } from './Modal';

type T = 'VL' | 'NC' | 'M';
const TYPE_LABEL: Record<T, string> = { VL: 'Vật liệu', NC: 'Nhân công', M: 'Ca máy' };

/** "Cập nhật định mức & đơn giá theo khu vực": choose region/period/types, preview, apply as an undoable revision. */
export function RegionalUpdateDialog({
  projectId,
  config,
  initialRegion,
  initialSubArea,
  approved,
  autoUpdate,
  onClose,
  onApplied,
}: {
  projectId: number;
  config: AppConfig;
  initialRegion: string | null;
  initialSubArea: string | null;
  approved: boolean;
  autoUpdate: boolean;
  onClose: () => void;
  onApplied: (message: string) => void;
}) {
  const year = new Date().getFullYear();
  const [region, setRegion] = useState(initialRegion ?? '');
  const [subArea, setSubArea] = useState(initialSubArea ?? '');
  const [subAreas, setSubAreas] = useState<string[]>([]);
  const [auto, setAuto] = useState(true);
  const [periodType, setPeriodType] = useState<'month' | 'quarter'>('month');
  const [pYear, setPYear] = useState(year);
  const [pValue, setPValue] = useState(1);
  const [types, setTypes] = useState<Record<T, boolean>>({ VL: true, NC: true, M: true });
  const [remap, setRemap] = useState(false);
  const [choices, setChoices] = useState<Record<string, string | null>>({});
  const [preview, setPreview] = useState<RegionalPreview | null>(null);
  const [revisions, setRevisions] = useState<RevisionDTO[]>([]);
  const [autoOn, setAutoOn] = useState(autoUpdate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadRevisions = () => api.revisions(projectId).then(setRevisions).catch(() => undefined);
  useEffect(() => {
    loadRevisions();
  }, [projectId]);
  useEffect(() => {
    if (!region) return setSubAreas([]);
    api.priceBooks({ region }).then((bs) => setSubAreas([...new Set(bs.map((b) => b.subArea).filter((x): x is string => !!x))]));
  }, [region]);

  const body = () => ({
    region,
    subArea: subArea || null,
    auto,
    period: auto ? null : { type: periodType, year: pYear, value: pValue },
    types: (Object.keys(types) as T[]).filter((t) => types[t]),
    remapCodes: remap,
    codeChoices: choices,
  });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const doPreview = () =>
    run(async () => {
      const p = await api.regionalPreview(projectId, body());
      setPreview(p);
      const next: Record<string, string | null> = {};
      for (const r of p.remap) if (r.resolution.candidates[0] && r.resolution.candidates[0].confidence >= 0.5) next[String(r.itemId)] = r.resolution.candidates[0].code;
      setChoices(next);
    });
  const doApply = () =>
    run(async () => {
      const r = await api.regionalApply(projectId, body());
      onApplied(`Đã cập nhật theo khu vực ${region}: ${r.applied.resources} tài nguyên đổi giá${r.applied.codes ? `, ${r.applied.codes} công việc đổi mã` : ''}. Có thể hoàn tác trong nhật ký bên dưới.`);
      setPreview(null);
      await loadRevisions();
    });
  const undo = (id: number) =>
    run(async () => {
      await api.undoRevision(projectId, id);
      onApplied('Đã hoàn tác phiên bản cập nhật.');
      await loadRevisions();
    });
  const delta = (n: number) => (
    <span className={n > 0 ? 'warn-mark' : n < 0 ? 'ok-mark' : ''}>
      {n > 0 ? '+' : ''}
      {money(n)}
    </span>
  );

  return (
    <Modal title="Cập nhật định mức & đơn giá theo khu vực" onClose={onClose} wide>
      <div className="form" data-testid="regional-dialog">
        {approved && <div className="warn-box">Công trình đã được duyệt – không thể áp dụng cập nhật lên bản đã duyệt (vẫn xem trước được). Hãy “Hủy duyệt” hoặc nhân bản công trình.</div>}
        <div className="row2">
          <label>
            Tỉnh/thành (34 đơn vị)
            <select data-testid="regional-region" value={region} onChange={(e) => { setRegion(e.target.value); setSubArea(''); setPreview(null); }}>
              <option value="">— chọn —</option>
              {config.regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label>
            Khu vực (nếu bộ giá chia khu vực)
            <select data-testid="regional-subarea" value={subArea} onChange={(e) => { setSubArea(e.target.value); setPreview(null); }} disabled={!subAreas.length}>
              <option value="">{subAreas.length ? '— chung —' : '(bộ giá không chia khu vực)'}</option>
              {subAreas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="check">
          <input type="checkbox" data-testid="regional-auto" checked={auto} onChange={(e) => { setAuto(e.target.checked); setPreview(null); }} /> Tự động chọn bộ giá mới nhất ≤ ngày lập giá của công trình
        </label>
        {!auto && (
          <div className="row3">
            <label>
              Kỳ giá
              <select value={periodType} onChange={(e) => setPeriodType(e.target.value as 'month' | 'quarter')}>
                <option value="month">Tháng</option>
                <option value="quarter">Quý</option>
              </select>
            </label>
            <label>
              Năm
              <input type="number" value={pYear} onChange={(e) => setPYear(Number(e.target.value))} />
            </label>
            <label>
              {periodType === 'month' ? 'Tháng (1–12)' : 'Quý (1–4)'}
              <input type="number" min={1} max={periodType === 'month' ? 12 : 4} value={pValue} onChange={(e) => setPValue(Number(e.target.value))} />
            </label>
          </div>
        )}
        <div className="check-row">
          Loại giá cần cập nhật:{' '}
          {(['VL', 'NC', 'M'] as T[]).map((t) => (
            <label key={t} className="check">
              <input type="checkbox" data-testid={`regional-type-${t}`} checked={types[t]} onChange={(e) => { setTypes({ ...types, [t]: e.target.checked }); setPreview(null); }} /> {TYPE_LABEL[t]}
            </label>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" data-testid="regional-remap" checked={remap} onChange={(e) => { setRemap(e.target.checked); setPreview(null); }} /> Kiểm tra và chuyển mã định mức chưa có trong bộ TT38_2026 (mã kiểu cũ / mẫu)
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={autoOn}
            onChange={(e) => {
              setAutoOn(e.target.checked);
              run(async () => {
                await api.setAutoPriceUpdate(projectId, e.target.checked);
              });
            }}
          />{' '}
          Tự động cập nhật: báo “Có bộ giá mới – Cập nhật?” khi nhập bộ giá đã xác minh mới của khu vực (không tự áp dụng)
        </label>
        {error && <div className="error">{error}</div>}
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          <button className="primary" data-testid="regional-preview" disabled={busy || !region} onClick={doPreview}>
            Xem trước
          </button>
          <button data-testid="regional-apply" disabled={busy || !preview || !preview.canApply || approved} onClick={doApply}>
            Áp dụng (tạo phiên bản mới, có thể hoàn tác)
          </button>
        </div>

        {preview && (
          <div data-testid="regional-preview-result">
            <p className="hint">
              Bộ định mức: <b>{preview.normSet.dataset}</b> – {preview.normSet.label} · {preview.normSet.total} mã, trạng thái “cần đối chiếu”: {preview.normSet.needsReview}
              {preview.normSet.sample ? `, mã mẫu: ${preview.normSet.sample}` : ''}
            </p>
            {preview.warnings.map((w) => (
              <div key={w} className="warn-box">
                ⚠ {w}
              </div>
            ))}
            <p>
              Bộ giá được chọn:{' '}
              {preview.books.length ? preview.books.map((b) => `${TYPE_LABEL[b.type]}: ${b.title}`).join(' · ') : <i>không có</i>}
            </p>
            <table className="table compact" data-testid="regional-totals">
              <thead>
                <tr>
                  <th></th>
                  <th className="num">Hiện tại</th>
                  <th className="num">Sau cập nhật</th>
                  <th className="num">Chênh lệch</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Chi phí trực tiếp', 'direct'],
                    ['Chi phí xây dựng trước thuế (GXDTT)', 'gxdtt'],
                    ['Chi phí xây dựng sau thuế (GXD)', 'gxd'],
                  ] as const
                ).map(([label, k]) => (
                  <tr key={k}>
                    <td>{label}</td>
                    <td className="num">{money(preview.totals.before[k])}</td>
                    <td className="num">{money(preview.totals.after[k])}</td>
                    <td className="num">{delta(preview.totals.delta[k])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h4>Tài nguyên đổi giá ({preview.resources.length})</h4>
            <div className="table-scroll" style={{ maxHeight: 240 }}>
              <table className="table compact" data-testid="regional-resources">
                <thead>
                  <tr>
                    <th>Loại</th>
                    <th>Tài nguyên</th>
                    <th>ĐV</th>
                    <th className="num">Khối lượng</th>
                    <th className="num">Giá cũ</th>
                    <th className="num">Giá mới</th>
                    <th>Nguồn giá mới (văn bản/kỳ)</th>
                    <th className="num">Chênh lệch</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.resources.map((r) => (
                    <tr key={r.code}>
                      <td>{r.type}</td>
                      <td>{r.name}</td>
                      <td>{r.unit}</td>
                      <td className="num">{qty(r.quantity)}</td>
                      <td className="num">{money(r.oldPrice)}</td>
                      <td className="num">{money(r.newPrice)}</td>
                      <td title={`Cũ: ${r.oldSource}`}>
                        {r.newSource}
                        {r.note && <span className="hint"> · {r.note}</span>}
                      </td>
                      <td className="num">{delta(r.delta)}</td>
                    </tr>
                  ))}
                  {!preview.resources.length && (
                    <tr>
                      <td colSpan={8} className="hint">
                        Không có tài nguyên nào đổi giá.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {preview.unpriced.length > 0 && (
              <>
                <h4>Không có giá trong bộ đã chọn – giữ giá hiện tại ({preview.unpriced.length})</h4>
                <p className="hint">{preview.unpriced.map((u) => `${u.name} (${u.type})`).join('; ')}</p>
              </>
            )}
            <h4>Công việc bị ảnh hưởng ({preview.items.length})</h4>
            <div className="table-scroll" style={{ maxHeight: 200 }}>
              <table className="table compact" data-testid="regional-items">
                <thead>
                  <tr>
                    <th>Mã</th>
                    <th>Công việc</th>
                    <th className="num">Đơn giá cũ</th>
                    <th className="num">Đơn giá mới</th>
                    <th className="num">Chênh lệch thành tiền</th>
                    <th>Cảnh báo</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.items.map((i) => (
                    <tr key={i.itemId}>
                      <td>{i.normCode}</td>
                      <td>{i.name}</td>
                      <td className="num">{money(i.oldUnit)}</td>
                      <td className="num">{money(i.newUnit)}</td>
                      <td className="num">{delta(i.delta)}</td>
                      <td className="warn-text">{i.missingPrices ? `${i.missingPrices} tài nguyên chưa có giá trong bộ giá đã chọn` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {remap && (
              <>
                <h4>Chuyển mã định mức ({preview.remap.length})</h4>
                <table className="table compact" data-testid="regional-remap-table">
                  <thead>
                    <tr>
                      <th>Công việc</th>
                      <th>Mã hiện tại</th>
                      <th>Trạng thái</th>
                      <th>Mã đề xuất</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.remap.map((r) => (
                      <tr key={r.itemId}>
                        <td>{r.name}</td>
                        <td>{r.normCode || '(chưa có)'}</td>
                        <td title={r.resolution.message}>{r.resolution.label}</td>
                        <td>
                          <select
                            value={choices[String(r.itemId)] ?? ''}
                            onChange={(e) => setChoices({ ...choices, [String(r.itemId)]: e.target.value || null })}
                          >
                            <option value="">Giữ nguyên</option>
                            {r.resolution.candidates.map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.code} · {Math.round(c.confidence * 100)}% – {c.name.slice(0, 60)}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                    {!preview.remap.length && (
                      <tr>
                        <td colSpan={4} className="hint">
                          Mọi mã định mức đã có trong bộ {preview.normSet.dataset}.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        <h4>Nhật ký phiên bản</h4>
        <table className="table compact" data-testid="regional-revisions">
          <thead>
            <tr>
              <th>#</th>
              <th>Thời điểm</th>
              <th>Nội dung</th>
              <th>Người thực hiện</th>
              <th className="num">GXD trước → sau</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {revisions.map((r, i) => (
              <tr key={r.id} className={r.undone ? 'rt-row-skip' : ''}>
                <td>{r.id}</td>
                <td>{r.createdAt}</td>
                <td>{r.description}</td>
                <td>{r.createdBy}</td>
                <td className="num">
                  {r.totalBefore !== null ? money(r.totalBefore) : ''} → {r.totalAfter !== null ? money(r.totalAfter) : ''}
                </td>
                <td>
                  {r.undone ? (
                    <span className="hint">đã hoàn tác</span>
                  ) : (
                    i === revisions.findIndex((x) => !x.undone) && (
                      <button data-testid="revision-undo" disabled={busy || approved} onClick={() => undo(r.id)}>
                        Hoàn tác
                      </button>
                    )
                  )}
                </td>
              </tr>
            ))}
            {!revisions.length && (
              <tr>
                <td colSpan={6} className="hint">
                  Chưa có phiên bản cập nhật nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

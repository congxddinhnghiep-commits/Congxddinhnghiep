import { useState } from 'react';
import { api, type Analysis, type RowType } from '../api';
import { qty } from '../format';

const colName = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `C${i + 1}`);
const TYPE_OPTIONS: (RowType | 'skip')[] = ['item', 'category', 'note', 'subtotal', 'skip'];

/** Mapping review for importing an existing estimate / BOQ workbook (any layout). */
export function EstimateImportReview({
  projectId,
  initial,
  onImported,
}: {
  projectId: number;
  initial: Analysis;
  onImported: (message: string) => void;
}) {
  const [a, setA] = useState<Analysis>(initial);
  const [mapping, setMapping] = useState<Record<string, number>>(initial.header?.mapping ?? {});
  const [headerRow, setHeaderRow] = useState((initial.header?.headerRow ?? 0) + 1);
  const [headerRows, setHeaderRows] = useState<1 | 2>(initial.header?.headerRows ?? 1);
  const [overrides, setOverrides] = useState<Record<string, RowType | 'skip'>>({});
  const [onlyItems, setOnlyItems] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [auto, setAuto] = useState(true);
  const [threshold, setThreshold] = useState('80');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      const r = await api.importAnalyze({ fileId: a.fileId, projectId, ...body });
      setA(r);
      setMapping(r.header?.mapping ?? {});
      setHeaderRow((r.header?.headerRow ?? 0) + 1);
      setHeaderRows(r.header?.headerRows ?? 1);
      setOverrides({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reanalyze = () => load({ sheetIndex: a.sheetIndex, headerRow: headerRow - 1, headerRows, mapping });

  const doImport = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.importEstimate(projectId, {
        fileId: a.fileId,
        sheetIndex: a.sheetIndex,
        headerRow: headerRow - 1,
        headerRows,
        mapping,
        rowTypes: overrides,
        saveTemplate: templateName.trim() || null,
        autoAssignThreshold: auto ? Number(threshold.replace(',', '.')) / 100 : null,
      });
      onImported(r.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const width = Math.max(0, ...a.preview.map((r) => r?.length ?? 0), a.header?.labels.length ?? 0);
  const typeOf = (r: Analysis['rows'][number]) => overrides[String(r.index)] ?? r.type;
  const itemCount = a.rows.filter((r) => typeOf(r) === 'item').length;
  const shown = a.rows.filter((r) => r.type !== 'empty' && (!onlyItems || typeOf(r) === 'item'));
  const warnCount = a.rows.filter((r) => typeOf(r) === 'item' && r.warnings.length).length;

  return (
    <div className="import-review">
      <div className="sheet-list">
        {a.sheets.map((s) => (
          <button key={s.index} className={s.index === a.sheetIndex ? 'active' : ''} onClick={() => load({ sheetIndex: s.index })} disabled={busy}>
            <b>{s.name}</b> <span className={`kind k-${s.kind}`}>{s.kindLabel}</span> <span className="hint">{s.rowCount} dòng</span>
          </button>
        ))}
      </div>
      {a.template && <div className="notice">✓ Đã nhận ra mẫu nhập “{a.template.name}” – ánh xạ cột được lấy từ mẫu.</div>}
      {a.warnings.map((w) => (
        <div key={w} className="warn-box">
          ⚠ {w}
        </div>
      ))}
      {error && <div className="error">{error}</div>}

      <div className="mapping">
        <label>
          Dòng tiêu đề (số dòng Excel)
          <input type="number" min={1} value={headerRow} onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value)))} />
        </label>
        <label>
          Số dòng tiêu đề
          <select value={headerRows} onChange={(e) => setHeaderRows(Number(e.target.value) === 2 ? 2 : 1)}>
            <option value={1}>1 dòng</option>
            <option value={2}>2 dòng (có ô gộp)</option>
          </select>
        </label>
        {a.fields.map((f) => (
          <label key={f.key}>
            {f.label}
            <select value={mapping[f.key] ?? -1} onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) })}>
              <option value={-1}>— không dùng —</option>
              {Array.from({ length: width }, (_, i) => (
                <option key={i} value={i}>
                  {colName(i)}
                  {a.header?.labels[i] ? ` – ${a.header.labels[i].slice(0, 30)}` : ''}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="actions" style={{ justifyContent: 'flex-start' }}>
        <button onClick={reanalyze} disabled={busy}>
          ↻ Phân tích lại với ánh xạ này
        </button>
        <button className="link" onClick={() => setShowPreview(!showPreview)}>
          {showPreview ? 'Ẩn' : 'Xem'} 30 dòng đầu của sheet
        </button>
      </div>
      {showPreview && (
        <div className="table-scroll preview-table">
          <table className="table compact">
            <thead>
              <tr>
                <th>#</th>
                {Array.from({ length: width }, (_, i) => (
                  <th key={i}>{colName(i)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {a.preview.map((r, j) => (
                <tr key={j} className={j + 1 >= headerRow && j + 1 < headerRow + headerRows ? 'hdr' : ''}>
                  <td className="muted">{j + 1}</td>
                  {Array.from({ length: width }, (_, i) => (
                    <td key={i}>{r?.[i] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="counts">
        {(Object.keys(a.rowTypeLabels) as RowType[])
          .filter((t) => a.counts[t])
          .map((t) => (
            <span key={t} className={`rt rt-${t}`}>
              {a.rowTypeLabels[t]}: {a.counts[t]}
            </span>
          ))}
        {warnCount > 0 && <span className="rt rt-warn">Có cảnh báo: {warnCount}</span>}
        <label className="check">
          <input type="checkbox" checked={onlyItems} onChange={(e) => setOnlyItems(e.target.checked)} /> Chỉ hiện công việc
        </label>
      </div>
      <div className="table-scroll review-table">
        <table className="table compact">
          <thead>
            <tr>
              <th>Dòng</th>
              <th>Loại</th>
              <th>Mã hiệu</th>
              <th>Tên công việc (gốc)</th>
              <th>ĐV</th>
              <th className="num">Khối lượng</th>
              <th>Cảnh báo</th>
              <th>Gợi ý mã</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const t = typeOf(r);
              return (
                <tr key={r.index} className={`rt-row-${t}`}>
                  <td className="muted">{r.excelRow}</td>
                  <td>
                    <select className={`rt rt-${t}`} value={t} onChange={(e) => setOverrides({ ...overrides, [r.index]: e.target.value as RowType | 'skip' })}>
                      {!TYPE_OPTIONS.includes(r.type) && <option value={r.type}>{a.rowTypeLabels[r.type]}</option>}
                      {TYPE_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o === 'skip' ? 'Bỏ qua' : a.rowTypeLabels[o]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {r.code}
                    {r.code && r.codeKnown === false && <span className="code-state review"> không có</span>}
                  </td>
                  <td>{r.name}</td>
                  <td>{r.unit}</td>
                  <td className="num">{r.quantity === null ? '' : qty(r.quantity)}</td>
                  <td className="warn-text">{r.warnings.join('; ')}</td>
                  <td>
                    {r.suggestion && (
                      <span className={`chip-sug ${r.suggestion.confidence >= 0.8 ? 'hi' : 'lo'}`} title={`${r.suggestion.name}\nVì sao: ${r.suggestion.why}`}>
                        {r.suggestion.code} · {Math.round(r.suggestion.confidence * 100)}%
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="import-options">
        <label>
          Lưu ánh xạ thành mẫu nhập (để lần sau nhập 1 bước)
          <input placeholder="Tên mẫu, ví dụ: Mẫu dự toán F1 công ty" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Gắn mã tự động cho công việc chưa có mã, ngưỡng tin cậy
          <input className="num" style={{ width: 56 }} value={threshold} onChange={(e) => setThreshold(e.target.value)} disabled={!auto} />%
        </label>
        <p className="hint">
          Mô tả, khối lượng, đơn vị và vị trí gốc (file / sheet / dòng) được lưu kèm từng công việc và không bị ghi đè. Có thể hoàn tác lần nhập bằng nút “Hoàn tác” của
          trợ lý.
        </p>
      </div>
      <div className="actions">
        <button className="primary" disabled={busy || !itemCount} onClick={doImport}>
          Nhập {itemCount} công việc
        </button>
      </div>
    </div>
  );
}

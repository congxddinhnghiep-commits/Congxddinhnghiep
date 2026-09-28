import { useState } from 'react';
import { api, type Analysis, type CodeCandidateDTO, type RowType } from '../api';
import { money, qty } from '../format';

const TYPE_OPTIONS: (RowType | 'skip')[] = ['category', 'item', 'subtotal', 'note'];
const TYPE_LABEL: Record<string, string> = { category: 'Hạng mục', item: 'Công việc', subtotal: 'Dòng cộng (bỏ qua)', note: 'Ghi chú (bỏ qua)', skip: 'Bỏ qua', header: 'Tiêu đề', empty: 'Trống' };
const STATUS_CLASS: Record<string, string> = { match: 'hi', mismatch: 'bad', propose: 'lo', suggest: 'lo', gtt: 'lo', none: 'lo' };

/** Mapping review for importing an existing estimate / BOQ workbook: the user chooses every column. */
export function EstimateImportReview({
  projectId,
  initial,
  replace,
  onImported,
}: {
  projectId: number;
  initial: Analysis;
  /** "Sửa lại cột đã nhập": replace the items of a stored import / of these categories. */
  replace?: { importId?: number; categoryIds?: number[] };
  onImported: (message: string) => void;
}) {
  const [a, setA] = useState<Analysis>(initial);
  const [mapping, setMapping] = useState<Record<string, number>>(initial.header?.mapping ?? {});
  const [lastCol, setLastCol] = useState<Record<string, number>>({});
  const [headerRow, setHeaderRow] = useState((initial.header?.headerRow ?? 0) + 1);
  const [headerRows, setHeaderRows] = useState<1 | 2>(initial.header?.headerRows ?? 1);
  const [firstRow, setFirstRow] = useState(initial.range?.first ?? 1);
  const [lastRow, setLastRow] = useState(initial.range?.last ?? 1);
  const [overrides, setOverrides] = useState<Record<string, RowType | 'skip'>>({});
  const [choices, setChoices] = useState<Record<string, string | null>>({});
  const [pricing, setPricing] = useState<'file' | 'norm'>('file');
  const [onlyItems, setOnlyItems] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [auto, setAuto] = useState(false);
  const [threshold, setThreshold] = useState('80');
  const [acceptAt, setAcceptAt] = useState('50');
  const [allowNumericName, setAllowNumericName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const apply = (r: Analysis, keepRange = false) => {
    setA(r);
    setMapping(r.header?.mapping ?? {});
    setHeaderRow((r.header?.headerRow ?? 0) + 1);
    setHeaderRows(r.header?.headerRows ?? 1);
    if (!keepRange) {
      setFirstRow(r.range?.first ?? 1);
      setLastRow(r.range?.last ?? 1);
    }
  };

  const load = async (body: Record<string, unknown>, keepRange = false, keepOverrides = false, keepChoices = false) => {
    setBusy(true);
    setError('');
    try {
      const r = await api.importAnalyze({ fileId: a.fileId, projectId, pricingOption: pricing, ...body });
      apply(r, keepRange);
      if (!keepOverrides) setOverrides({});
      if (!keepChoices) setChoices({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const current = (over: Record<string, unknown> = {}) => ({
    sheetIndex: a.sheetIndex,
    headerRow: headerRow - 1,
    headerRows,
    mapping,
    firstRow,
    lastRow,
    rowTypes: overrides,
    ...over,
  });
  const reanalyze = (over: Record<string, unknown> = {}) => load(current(over), true, true, true);

  const setField = (key: string, col: number | null) => {
    const next = { ...mapping };
    if (col === null || col < 0) delete next[key];
    else {
      next[key] = col;
      setLastCol({ ...lastCol, [key]: col });
    }
    setMapping(next);
    reanalyze({ mapping: next });
  };
  const toggleField = (key: string, on: boolean) => {
    if (!on) {
      if (mapping[key] !== undefined) setLastCol({ ...lastCol, [key]: mapping[key] });
      setField(key, null);
    } else setField(key, lastCol[key] ?? a.columns[0]?.index ?? 0);
  };
  const setType = (index: number, t: RowType | 'skip') => {
    const next = { ...overrides, [index]: t };
    setOverrides(next);
    reanalyze({ rowTypes: next });
  };

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
        firstRow,
        lastRow,
        rowTypes: overrides,
        pricingOption: pricing,
        codeChoices: choices,
        allowNumericName,
        replaceImportId: replace?.importId,
        replaceCategoryIds: replace?.categoryIds,
        saveTemplate: templateName.trim() || null,
        autoAssignThreshold: auto ? Number(threshold.replace(',', '.')) / 100 : null,
      });
      onImported(r.message + (r.zeroAmount ? ` Lưu ý: ${r.zeroAmount} công việc chưa có mã định mức nên thành tiền có thể bằng 0 nếu chưa có đơn giá.` : ''));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const width = Math.max(0, ...a.preview.map((r) => r?.length ?? 0), a.header?.labels.length ?? 0);
  const colName = (i: number) => a.columns.find((c) => c.index === i)?.letter ?? String(i + 1);
  const itemRows = a.rows.filter((r) => r.type === 'item');
  const shown = a.rows.filter((r) => r.type !== 'empty' && (!onlyItems || r.type === 'item'));
  const warnCount = itemRows.filter((r) => r.warnings.length).length;
  const recon = a.reconciliation;
  const blocking = a.columnWarnings?.find((w) => w.blocking);
  const acceptAll = () => {
    const min = Number(acceptAt.replace(',', '.')) / 100;
    const next = { ...choices };
    for (const r of itemRows) {
      const res = r.resolution;
      if (!res || res.status === 'match' || res.status === 'gtt') continue;
      const best = res.candidates[0];
      if (best && best.confidence >= min && (res.status === 'propose' || res.status === 'suggest')) next[String(r.index)] = best.code;
    }
    setChoices(next);
  };
  const choiceValue = (index: number) => (Object.prototype.hasOwnProperty.call(choices, String(index)) ? (choices[String(index)] ?? '__none') : '');
  const diffCell = (ok: boolean | null, diff: number | null) =>
    ok === null ? <span className="muted">–</span> : ok ? <span className="ok-mark">✔</span> : <span className="warn-mark">⚠ {diff !== null && diff > 0 ? '+' : ''}{money(diff ?? 0)}</span>;

  return (
    <div className="import-review" data-testid="import-review">
      <div className="sheet-list">
        {a.sheets.map((s) => (
          <button key={s.index} className={s.index === a.sheetIndex ? 'active' : ''} onClick={() => load({ sheetIndex: s.index, headerRow: undefined, mapping: undefined, rowTypes: undefined })} disabled={busy}>
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

      <h4>1. Vùng dữ liệu</h4>
      <div className="mapping">
        <label>
          Dòng tiêu đề (số dòng Excel)
          <input data-testid="header-row" type="number" min={1} value={headerRow} onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value)))} />
        </label>
        <label>
          Số dòng tiêu đề
          <select data-testid="header-rows" value={headerRows} onChange={(e) => setHeaderRows(Number(e.target.value) === 2 ? 2 : 1)}>
            <option value={1}>1 dòng</option>
            <option value={2}>2 dòng (nhóm + nhãn con, có hoặc không gộp ô)</option>
          </select>
        </label>
        <label>
          Dòng dữ liệu đầu
          <input data-testid="first-row" type="number" min={1} value={firstRow} onChange={(e) => setFirstRow(Math.max(1, Number(e.target.value)))} />
        </label>
        <label>
          Dòng dữ liệu cuối
          <input data-testid="last-row" type="number" min={1} value={lastRow} onChange={(e) => setLastRow(Math.max(1, Number(e.target.value)))} />
        </label>
      </div>
      <div className="actions" style={{ justifyContent: 'flex-start' }}>
        <button data-testid="reanalyze" onClick={() => load(current({ mapping: undefined }), true, true)} disabled={busy}>
          ↻ Nhận diện lại theo vùng này
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

      {a.detectionNotes?.length > 0 && (
        <div className="notice" data-testid="detection-notes">
          {a.detectionNotes.map((n) => (
            <div key={n}>ℹ {n}</div>
          ))}
        </div>
      )}
      {blocking && !allowNumericName && (
        <div className="error blocking" role="alert" data-testid="numeric-name-warning">
          <b>Cột {blocking.letter}: {blocking.message}</b>
          <div className="actions" style={{ justifyContent: 'flex-start' }}>
            <button data-testid="numeric-name-keep" onClick={() => setAllowNumericName(true)}>
              Vẫn dùng
            </button>
            <button className="primary" data-testid="numeric-name-choose" onClick={() => setField('name', null)}>
              Chọn lại
            </button>
          </div>
        </div>
      )}
      <h4>2. Chọn cột cho từng trường (tự nhận diện chỉ điền sẵn – bạn có thể đổi hoặc bỏ)</h4>
      <table className="table compact map-table" data-testid="map-table">
        <thead>
          <tr>
            <th>Lấy cột này</th>
            <th>Trường</th>
            <th>Cột trong file</th>
          </tr>
        </thead>
        <tbody>
          {a.fields.map((f) => {
            const on = mapping[f.key] !== undefined && mapping[f.key] >= 0;
            return (
              <tr key={f.key}>
                <td>
                  <input type="checkbox" data-testid={`take-${f.key}`} checked={on} onChange={(e) => toggleField(f.key, e.target.checked)} disabled={busy} />
                </td>
                <td>{f.label}</td>
                <td>
                  <select data-testid={`map-${f.key}`} value={on ? mapping[f.key] : -1} onChange={(e) => setField(f.key, Number(e.target.value))} disabled={busy}>
                    <option value={-1}>— Không lấy —</option>
                    {a.columns.map((c) => (
                      <option key={c.index} value={c.index}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h4>3. Đơn giá</h4>
      <div className="import-options" data-testid="pricing-options">
        <label className="check">
          <input type="radio" name="pricing" data-testid="pricing-file" checked={pricing === 'file'} onChange={() => { setPricing('file'); reanalyze({ pricingOption: 'file' }); }} /> Giữ nguyên đơn giá trong file (lưu thành đơn giá nhập tay của từng công việc, nguồn: file Excel, ô)
        </label>
        <label className="check">
          <input type="radio" name="pricing" data-testid="pricing-norm" checked={pricing === 'norm'} onChange={() => { setPricing('norm'); reanalyze({ pricingOption: 'norm' }); }} /> Tính lại theo định mức &amp; bộ giá của công trình
        </label>
      </div>

      <h4>Xem trước như sẽ hiện trong lưới dự toán (15 dòng đầu)</h4>
      <div className="table-scroll">
        <table className="table compact" data-testid="grid-preview">
          <thead>
            <tr>
              <th>STT</th>
              <th>Mã</th>
              <th>Tên công việc</th>
              <th>ĐVT</th>
              <th className="num">KL</th>
              <th className="num">Đơn giá</th>
              <th className="num">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {a.gridPreview?.map((r) =>
              r.type === 'category' ? (
                <tr key={r.excelRow} className="rt-row-category">
                  <td>{r.stt}</td>
                  <td />
                  <td colSpan={5}>{r.name.toUpperCase()}</td>
                </tr>
              ) : (
                <tr key={r.excelRow}>
                  <td>{r.stt}</td>
                  <td>{r.code}</td>
                  <td className={r.nameIsNumeric ? 'bad-cell' : ''} data-testid={r.nameIsNumeric ? 'name-numeric' : undefined}>
                    {r.name}
                  </td>
                  <td>{r.unit}</td>
                  <td className="num">{r.quantity === null ? '' : qty(r.quantity)}</td>
                  <td className="num">{r.unitPrice === null ? '' : money(r.unitPrice)}</td>
                  <td className={`num ${!r.amount ? 'bad-cell' : ''}`}>{r.amount === null ? '' : money(r.amount)}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      <h4>4. Loại dòng và mã hiệu</h4>
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
        <span className="check">
          <button data-testid="accept-all" onClick={acceptAll} disabled={busy}>
            Chấp nhận tất cả mã đề xuất ≥
          </button>
          <input className="num" style={{ width: 48 }} value={acceptAt} onChange={(e) => setAcceptAt(e.target.value)} />%
        </span>
      </div>
      <div className="table-scroll review-table">
        <table className="table compact" data-testid="review-table">
          <thead>
            <tr>
              <th>Dòng</th>
              <th>Loại dòng</th>
              <th>Mã hiệu (gốc)</th>
              <th>Tên công việc (gốc)</th>
              <th>ĐV</th>
              <th className="num">KL</th>
              <th className="num">Đơn giá file</th>
              <th className="num">Thành tiền file</th>
              <th className="num">Tính lại</th>
              <th>Mã đề xuất</th>
              <th className="num">Giá theo định mức</th>
              <th>Cảnh báo</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const t = overrides[String(r.index)] ?? r.type;
              const res = r.resolution;
              return (
                <tr key={r.index} className={`rt-row-${t}`} data-row={r.excelRow}>
                  <td className="muted">{r.excelRow}</td>
                  <td>
                    <select className={`rt rt-${t}`} data-testid={`type-${r.excelRow}`} value={t} onChange={(e) => setType(r.index, e.target.value as RowType | 'skip')} disabled={busy}>
                      {!TYPE_OPTIONS.includes(t as RowType) && <option value={t}>{TYPE_LABEL[t] ?? t}</option>}
                      {TYPE_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {TYPE_LABEL[o]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {r.code}
                    {r.normalizedCode && r.normalizedCode !== r.code.trim().toUpperCase() && <span className="hint"> → {r.normalizedCode}</span>}
                  </td>
                  <td title={r.rawName ? `Văn bản gốc: ${r.rawName}` : undefined}>
                    {r.name}
                    {r.pricingMethod === 'CUSTOM_GTT' && <span className="pm"> GTT</span>}
                    {r.flags?.length ? <span className="flag"> ⚠ {r.flags.join(', ')}</span> : null}
                  </td>
                  <td>{r.unit}</td>
                  <td className="num">{r.quantity === null ? '' : qty(r.quantity)}</td>
                  <td className="num">{r.fileUnitPrice === null || r.fileUnitPrice === undefined ? '' : money(r.fileUnitPrice)}</td>
                  <td className="num">{r.amount === null ? '' : money(r.amount)}</td>
                  <td className="num">{r.computedAmount === null || r.computedAmount === undefined ? '' : money(r.computedAmount)}</td>
                  <td>
                    {t === 'item' && res && (
                      <div className="code-cell">
                        <span className={`chip-sug ${STATUS_CLASS[res.status] ?? 'lo'}`} data-testid={`status-${r.excelRow}`} title={res.message}>
                          {res.label}
                        </span>
                        {res.status === 'mismatch' && res.normName && <div className="hint">TT38: {res.normName}</div>}
                        {res.askParams && <div className="hint">Cần biết thêm: {res.askParams.join('; ')}</div>}
                        {(res.candidates.length > 0 || res.status === 'mismatch') && (
                          <select data-testid={`code-${r.excelRow}`} value={choiceValue(r.index)} disabled={busy} onChange={(e) => {
                            const v = e.target.value;
                            const next = { ...choices };
                            if (v === '') delete next[String(r.index)];
                            else next[String(r.index)] = v === '__none' ? null : v;
                            setChoices(next);
                          }}>
                            <option value="">{res.code ? `Giữ mã ${res.code}${res.status === 'mismatch' ? ' (cần kiểm tra)' : ''}` : 'Chưa gắn mã'}</option>
                            {res.code && <option value="__none">Không gắn mã</option>}
                            {res.candidates.map((c: CodeCandidateDTO) => (
                              <option key={c.code} value={c.code} title={`${c.name}\n${c.reason}`}>
                                {c.code} · {Math.round(c.confidence * 100)}% – {c.name.slice(0, 60)}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="num">{r.normUnit === null || r.normUnit === undefined ? '' : money(r.normUnit)}</td>
                  <td className="warn-text">{r.warnings.join('; ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {recon && (
        <>
          <h4>5. Kiểm tra độ khớp với file {recon.allOk ? <span className="ok-mark">✔ tất cả khớp</span> : <span className="warn-mark">⚠ có chênh lệch</span>}</h4>
          <div className="table-scroll">
            <table className="table compact" data-testid="recon-table">
              <thead>
                <tr>
                  <th>Dòng</th>
                  <th>Nội dung</th>
                  <th className="num">KL</th>
                  <th className="num">Đơn giá</th>
                  <th className="num">Thành tiền trong file</th>
                  <th className="num">Thành tiền tính lại</th>
                  <th>Chênh lệch</th>
                </tr>
              </thead>
              <tbody>
                {recon.items.map((i) => (
                  <tr key={i.excelRow}>
                    <td>{i.excelRow}</td>
                    <td>{i.name}</td>
                    <td className="num">{i.quantity === null ? '' : qty(i.quantity)}</td>
                    <td className="num">{i.unitPrice === null ? '' : money(i.unitPrice)}</td>
                    <td className="num">{i.fileAmount === null ? '' : money(i.fileAmount)}</td>
                    <td className="num">{i.computed === null ? '' : money(i.computed)}</td>
                    <td>{diffCell(i.ok, i.diff)}</td>
                  </tr>
                ))}
                {recon.subtotals.map((s) => (
                  <tr key={`s${s.excelRow}`} className="rt-row-category">
                    <td>{s.excelRow}</td>
                    <td>{s.name} (dòng cộng)</td>
                    <td colSpan={2} />
                    <td className="num">{money(s.fileAmount)}</td>
                    <td className="num">{money(s.computed)}</td>
                    <td>{diffCell(s.ok, s.diff)}</td>
                  </tr>
                ))}
                <tr className="rt-row-category">
                  <td />
                  <td>Tổng cộng</td>
                  <td colSpan={2} />
                  <td className="num" data-testid="grand-file">{recon.grand.fileAmount === null ? '' : money(recon.grand.fileAmount)}</td>
                  <td className="num" data-testid="grand-computed">{money(recon.grand.computed)}</td>
                  <td>{diffCell(recon.grand.ok, recon.grand.diff)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="import-options">
        <label>
          Lưu ánh xạ thành mẫu nhập (để lần sau nhập 1 bước)
          <input placeholder="Tên mẫu, ví dụ: Mẫu dự toán F1 công ty" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Sau khi nhập, tự gắn mã cho công việc còn thiếu mã, ngưỡng tin cậy
          <input className="num" style={{ width: 56 }} value={threshold} onChange={(e) => setThreshold(e.target.value)} disabled={!auto} />%
        </label>
        <p className="hint">
          Mô tả, khối lượng, đơn vị, mã gốc và vị trí gốc (file / sheet / dòng / ô) được lưu kèm từng công việc và không bị ghi đè. Có thể hoàn tác lần nhập bằng nút “Hoàn tác”
          của trợ lý.
        </p>
      </div>
      <div className="actions">
        <button className="primary" data-testid="do-import" disabled={busy || !itemRows.length || (!!blocking && !allowNumericName)} onClick={doImport}>
          {replace ? 'Thay thế bằng' : 'Nhập'} {itemRows.length} công việc
        </button>
      </div>
    </div>
  );
}

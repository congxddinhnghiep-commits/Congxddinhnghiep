import { useState } from 'react';
import { api, type AnalyzeMultiResult, type BlockPlanDTO, type ImportPreview } from '../api';
import { money, qty } from '../format';
import { Modal } from './Modal';

const mark = (ok: boolean | null) => (ok === null ? <span className="muted">–</span> : ok ? <span className="ok-mark">✔</span> : <span className="warn-mark">⚠</span>);

/** One block's badges: số công việc, diễn giải, chưa giá, thiếu ĐVT, TB/VT. */
function BlockBadges({ b }: { b: BlockPlanDTO }) {
  return (
    <span className="counts">
      <span className="rt rt-item">{b.items} công việc</span>
      {b.details > 0 && <span className="rt">{b.details} dòng diễn giải</span>}
      {b.unpriced > 0 && <span className="rt rt-warn">{b.unpriced} chưa có giá</span>}
      {b.missingUnit > 0 && <span className="rt rt-warn">{b.missingUnit} thiếu ĐVT</span>}
      {b.tbvt > 0 && <span className="rt rt-item">{b.tbvt} thiết bị/vật tư theo báo giá</span>}
    </span>
  );
}

/** First 15 rows of one block exactly as it will appear in the estimate grid. */
function BlockPreview({ b }: { b: BlockPlanDTO }) {
  return (
    <div className="table-scroll">
      <table className="table compact">
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
          {b.preview.slice(0, 15).map((r) =>
            r.type === 'category' ? (
              <tr key={r.excelRow} className="rt-row-category">
                <td>{r.stt}</td>
                <td />
                <td colSpan={5}>{r.name.toUpperCase()}</td>
              </tr>
            ) : (
              <tr key={r.excelRow}>
                <td>{r.stt}</td>
                <td>{r.tbvt ? <span className="hint">TB/VT</span> : r.code}</td>
                <td className={r.nameIsNumeric ? 'bad-cell' : ''}>
                  {r.name}
                  {r.nameZh && <span className="hint"> · {r.nameZh}</span>}
                  {r.details > 0 && <span className="hint" title="Có dòng diễn giải khối lượng kèm theo"> Σ{r.details}</span>}
                </td>
                <td>{r.unit}</td>
                <td className="num">{r.quantity === null ? '' : qty(r.quantity)}</td>
                <td className="num">{r.unitPrice === null ? '' : money(r.unitPrice)}</td>
                <td className={`num ${r.unpriced ? 'bad-cell' : ''}`}>
                  {r.amount === null ? '' : money(r.amount)}
                  {r.amountMode && <span className="hint" title="Thành tiền của file khác KL×đơn giá"> {r.amountMode === 'file' ? '(theo file)' : '(tính lại)'}</span>}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Update 4 A-bis: nhập nhiều sheet một lần (mỗi sheet có thể nhiều hạng mục con / nhiều bảng) – mỗi bảng thành một hạng mục,
 * sheet ẩn không tự chọn, sheet tổng hợp (TONGHOP) chỉ dùng để đối chiếu.
 */
export function MultiSheetImport({
  projectId,
  onClose,
  onImported,
}: {
  projectId: number;
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [fileId, setFileId] = useState('');
  const [fileName, setFileName] = useState('');
  const [m, setM] = useState<AnalyzeMultiResult | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [pricingOption, setPricingOption] = useState<'file' | 'norm'>('file');
  const [equipmentAsQuote, setEquipmentAsQuote] = useState(true);
  /** Update 4 fidelity: 'file' (default) keeps a row's own Thành tiền when it disagrees with KL×đơn giá; 'calc' recomputes. */
  const [amountFidelity, setAmountFidelity] = useState<'file' | 'calc'>('file');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openPreview, setOpenPreview] = useState<Set<string>>(new Set());

  const analyze = async (sheetIndexes: number[], id = fileId, opts?: { pricingOption?: 'file' | 'norm'; equipmentAsQuote?: boolean; amountFidelity?: 'file' | 'calc' }) => {
    setBusy(true);
    setError('');
    try {
      const r = await api.importAnalyzeMulti({
        fileId: id,
        projectId,
        sheetIndexes,
        pricingOption: opts?.pricingOption ?? pricingOption,
        equipmentAsQuote: opts?.equipmentAsQuote ?? equipmentAsQuote,
        amountFidelity: opts?.amountFidelity ?? amountFidelity,
      });
      setM(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('target', 'estimate');
      const p: ImportPreview = await api.importUpload(form);
      setFileId(p.fileId);
      setFileName(file.name);
      setBusy(false);
      const r = await api.importAnalyzeMulti({ fileId: p.fileId, projectId, pricingOption, equipmentAsQuote, amountFidelity });
      setM(r);
      setSelected(new Set(r.selected));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const toggleSheet = (idx: number, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(idx);
    else next.delete(idx);
    setSelected(next);
    analyze([...next].sort((a, b) => a - b));
  };

  const changePricing = (v: 'file' | 'norm') => {
    setPricingOption(v);
    analyze([...selected], fileId, { pricingOption: v });
  };
  const changeEquipment = (v: boolean) => {
    setEquipmentAsQuote(v);
    analyze([...selected], fileId, { equipmentAsQuote: v });
  };
  const changeFidelity = (v: 'file' | 'calc') => {
    setAmountFidelity(v);
    analyze([...selected], fileId, { amountFidelity: v });
  };

  const doImport = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.importSheets(projectId, { fileId, sheetIndexes: [...selected], pricingOption, equipmentAsQuote, amountFidelity });
      onImported(r.message);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const visible = m?.sheets.filter((s) => !s.hidden) ?? [];
  const hidden = m?.sheets.filter((s) => s.hidden) ?? [];
  const blockingBlocks = m?.blocks.filter((b) => b.blocking) ?? [];
  const togglePreview = (key: string) =>
    setOpenPreview((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Modal title="Nhập nhiều sheet (mỗi sheet/khối thành một hạng mục)" onClose={onClose} wide>
      {!m && (
        <div className="form">
          <p className="hint">
            Dùng cho file Excel nhiều sheet, mỗi sheet là một nhà xưởng/hạng mục công trình (có thể có sheet ẩn và sheet tổng hợp kiểu TONGHOP). Một sheet có thể lặp lại
            dòng tiêu đề cho nhiều hạng mục con – mỗi bảng như vậy sẽ thành một hạng mục riêng.
          </p>
          <label>
            Chọn file (.xlsx, .xlsm, .xls)
            <input type="file" accept=".xlsx,.xlsm,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <div className="actions">
            <button className="primary" disabled={busy || !file} onClick={upload}>
              {busy ? 'Đang đọc…' : 'Đọc file'}
            </button>
          </div>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {m && (
        <>
          <p className="hint">
            File <b>{fileName}</b> – {m.sheets.length} sheet ({visible.length} hiển thị, {hidden.length} ẩn).
          </p>

          <h4>1. Chọn sheet cần nhập</h4>
          <table className="table compact" data-testid="sheet-picker">
            <thead>
              <tr>
                <th />
                <th>Sheet</th>
                <th className="num">Số bảng</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.index}>
                  <td>
                    <input
                      type="checkbox"
                      data-testid={`sheet-${s.index}`}
                      checked={selected.has(s.index)}
                      disabled={!s.importable || busy}
                      onChange={(e) => toggleSheet(s.index, e.target.checked)}
                    />
                  </td>
                  <td>{s.label}</td>
                  <td className="num">{s.blocks || '–'}</td>
                  <td>
                    {s.summary ? <span className="rt">Sheet tổng hợp – chỉ đối chiếu</span> : !s.importable ? <span className="hint">Không nhận diện được bảng dự toán</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hidden.length > 0 && (
            <div className="hidden-sheets">
              <button className="small" onClick={() => setShowHidden((v) => !v)}>
                {showHidden ? '▾' : '▸'} {hidden.length} sheet ẩn (không tự chọn)
              </button>
              {showHidden && (
                <table className="table compact">
                  <tbody>
                    {hidden.map((s) => (
                      <tr key={s.index}>
                        <td>
                          <input type="checkbox" checked={selected.has(s.index)} disabled={!s.importable || busy} onChange={(e) => toggleSheet(s.index, e.target.checked)} />
                        </td>
                        <td>{s.label}</td>
                        <td className="num">{s.blocks || '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div className="import-options">
            <label className="check">
              <input type="radio" name="m-pricing" checked={pricingOption === 'file'} onChange={() => changePricing('file')} /> Giữ nguyên đơn giá trong file
            </label>
            <label className="check">
              <input type="radio" name="m-pricing" checked={pricingOption === 'norm'} onChange={() => changePricing('norm')} /> Tính lại theo định mức &amp; bộ giá của công trình
            </label>
            <label className="check">
              <input type="checkbox" checked={equipmentAsQuote} onChange={(e) => changeEquipment(e.target.checked)} /> Sheet điện nước/MEP: dòng không có mã là “thiết bị/vật tư
              theo báo giá” (không bắt buộc mã định mức)
            </label>
            {pricingOption === 'file' && (
              <>
                <label className="check">
                  <input type="radio" name="m-fidelity" checked={amountFidelity === 'file'} onChange={() => changeFidelity('file')} /> Khi Thành tiền trong file khác KL×đơn giá: giữ
                  Thành tiền theo file (khuyến nghị – khớp đúng Cộng trước thuế/TONGHOP)
                </label>
                <label className="check">
                  <input type="radio" name="m-fidelity" checked={amountFidelity === 'calc'} onChange={() => changeFidelity('calc')} /> Tính lại theo KL×đơn giá (có thể khác tổng trong
                  file)
                </label>
              </>
            )}
          </div>

          <h4>
            2. Xem trước và đối chiếu {m.blocks.length} bảng{' '}
            {m.allOk ? <span className="ok-mark">✔ tất cả khớp</span> : <span className="warn-mark">⚠ có bảng chưa khớp</span>}
          </h4>
          {m.skipped.length > 0 && (
            <p className="hint">{m.skipped.length} bảng bị bỏ qua (không có công việc nào): {m.skipped.map((s) => `${s.sheetName.trim()} #${s.blockIndex + 1}`).join('; ')}.</p>
          )}
          {m.blocks.map((b) => (
            <div className="block-card" key={b.key} data-testid={`block-${b.key}`}>
              <div className="block-head">
                {mark(b.ok)}
                <b>
                  [{b.sheetName.trim()}] {b.blockCount > 1 ? `khối ${b.blockIndex + 1}/${b.blockCount} – ` : ''}
                  {b.prefix}
                </b>
                <span className="spacer" />
                <span>
                  Σ {money(b.computedTotal)} đ{b.fileTotal !== null ? ` / file ${money(b.fileTotal)} đ` : ''}
                  {b.diff ? <span className="warn-mark"> (lệch {money(b.diff)} đ)</span> : ''}
                </span>
                <button className="small" onClick={() => togglePreview(b.key)}>
                  {openPreview.has(b.key) ? 'Ẩn xem trước' : 'Xem trước'}
                </button>
              </div>
              <BlockBadges b={b} />
              {b.blocking && <div className="warn-box">⛔ {b.blocking} – bỏ chọn sheet này hoặc dùng màn hình “Nhập dữ liệu” (1 sheet) để chọn lại cột.</div>}
              {openPreview.has(b.key) && <BlockPreview b={b} />}
            </div>
          ))}

          {m.summary && (
            <>
              <h4>3. Đối chiếu với sheet tổng hợp «{m.summary.sheetName.trim()}»</h4>
              <table className="table compact" data-testid="summary-check">
                <thead>
                  <tr>
                    <th />
                    <th>Dòng trong sheet tổng hợp</th>
                    <th className="num">Số tiền</th>
                    <th>Khớp với</th>
                  </tr>
                </thead>
                <tbody>
                  {m.summary.matches.map((x, i) => (
                    <tr key={i}>
                      <td>{mark(x.ok)}</td>
                      <td>{x.line.label}</td>
                      <td className="num">{money(x.line.amount)}</td>
                      <td>{x.matched ? `${x.matched.label.trim()} (${money(x.matched.amount)})` : <span className="hint">không khớp bảng nào</span>}</td>
                    </tr>
                  ))}
                  {m.summary.totalCheck && (
                    <tr>
                      <td>{mark(m.summary.totalCheck.ok)}</td>
                      <td>
                        <b>Tổng trước thuế</b>
                      </td>
                      <td className="num">{money(m.summary.totalCheck.file)}</td>
                      <td>Σ các bảng {money(m.summary.totalCheck.computed)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          <div className="actions">
            <button
              className="primary"
              data-testid="import-sheets"
              disabled={busy || selected.size === 0 || blockingBlocks.length > 0}
              onClick={doImport}
              title={blockingBlocks.length > 0 ? 'Có bảng bị chặn (cột tên công việc không hợp lệ) – bỏ chọn sheet đó trước' : undefined}
            >
              {busy ? 'Đang nhập…' : `Nhập ${m.blocks.length} bảng vào ${selected.size} sheet đã chọn`}
            </button>
            <button onClick={onClose} disabled={busy}>
              Hủy
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

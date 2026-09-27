import { useEffect, useState } from 'react';
import { isMixResourceName, PRICING_METHOD_LABELS, type ItemResult, type MixDesign, type MixKind } from '@dutoan/core';
import { api, type MixDesignSummary, type PricingDTO, type QuantityLineDTO } from '../api';
import { money, parseInputNumber, qty } from '../format';
import { Modal } from './Modal';

const varsText = (v?: Record<string, number>) =>
  v ? Object.entries(v).map(([k, x]) => `${k}=${String(x).replace('.', ',')}`).join('; ') : '';

type Item = ItemResult & { sourceRawText?: string | null; sourceFlags?: string[] };

/** Quantity take-off lines (bóc tách khối lượng). Item quantity = Σ sign × value × unit factor. */
function QuantityLines({ projectId, item, onSaved }: { projectId: number; item: Item; onSaved: () => void }) {
  const [lines, setLines] = useState<QuantityLineDTO[]>([]);
  const [preview, setPreview] = useState<{ total: number; lines: QuantityLineDTO[]; errors: number } | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    api.quantityLines(projectId, item.id).then((ls) =>
      setLines(ls.length ? ls.map((l) => ({ ...l, variablesText: varsText(l.variables) })) : [{ description: '', expression: '', variablesText: '', sign: 1, unit: null }]),
    );
  }, [projectId, item.id]);
  const upd = (i: number, patch: Partial<QuantityLineDTO>) => {
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    setPreview(null);
  };
  const clean = () => lines.filter((l) => l.expression.trim());
  const evaluate = async () => {
    setError('');
    try {
      setPreview(await api.evaluateQuantity(clean(), item.unit));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const save = async () => {
    setError('');
    try {
      const r = await api.saveQuantityLines(projectId, item.id, clean());
      setMsg(`Đã lưu – khối lượng = ${qty(r.total)} ${item.unit}`);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div>
      <p className="hint">
        Biểu thức chỉ gồm số, biến, + − × ÷, ngoặc và % (không thực thi mã). Dòng “Trừ” dùng cho lỗ mở/phần khấu trừ. Chọn đơn vị dòng (vd. mm3) để tự quy đổi
        sang {item.unit}.
      </p>
      <table className="table compact">
        <thead>
          <tr>
            <th>Diễn giải</th>
            <th>Biểu thức</th>
            <th>Biến (L=6,6; W=…)</th>
            <th>Cộng/Trừ</th>
            <th>ĐV dòng</th>
            <th className="num">Kết quả ({item.unit})</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const p = preview?.lines[clean().indexOf(l)];
            return (
              <tr key={i}>
                <td>
                  <input value={l.description} onChange={(e) => upd(i, { description: e.target.value })} />
                </td>
                <td>
                  <input placeholder="13*5,4*0,1" value={l.expression} onChange={(e) => upd(i, { expression: e.target.value })} />
                </td>
                <td>
                  <input value={l.variablesText ?? ''} onChange={(e) => upd(i, { variablesText: e.target.value })} />
                </td>
                <td>
                  <select value={l.sign} onChange={(e) => upd(i, { sign: Number(e.target.value) === -1 ? -1 : 1 })}>
                    <option value={1}>Cộng</option>
                    <option value={-1}>Trừ</option>
                  </select>
                </td>
                <td>
                  <select value={l.unit ?? ''} onChange={(e) => upd(i, { unit: e.target.value || null })}>
                    <option value="">{item.unit}</option>
                    {['mm', 'cm', 'm', 'mm2', 'cm2', 'm2', 'mm3', 'cm3', 'm3', 'kg', 'tấn'].map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </td>
                <td className="num">
                  {p?.error ? <span className="error-text">{p.error}</span> : p ? qty(p.result ?? 0) : l.result !== undefined && l.result !== null ? qty(l.result) : ''}
                  {p?.warnings?.length ? <div className="warn-text">{p.warnings.join('; ')}</div> : null}
                </td>
                <td>
                  <button className="icon" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="actions" style={{ justifyContent: 'space-between' }}>
        <button onClick={() => setLines([...lines, { description: '', expression: '', variablesText: '', sign: 1, unit: null }])}>+ Thêm dòng</button>
        <span>
          {preview && (
            <b>
              Tổng: {qty(preview.total)} {item.unit}
              {preview.errors ? ` (${preview.errors} dòng lỗi)` : ''}
            </b>
          )}{' '}
          <button onClick={evaluate}>Tính thử</button>{' '}
          <button className="primary" onClick={save}>
            Lưu và cập nhật khối lượng
          </button>
        </span>
      </div>
      {error && <div className="error">{error}</div>}
      {msg && <p className="ok">{msg}</p>}
    </div>
  );
}

/** Pricing method of an item: norm-based, GTT (custom) or market quote with mandatory source. */
function Pricing({ projectId, item, onSaved }: { projectId: number; item: Item; onSaved: () => void }) {
  const [f, setF] = useState<PricingDTO>({
    pricingMethod: item.pricingMethod ?? 'NORM_BASED',
    custom: item.custom ?? { vl: 0, nc: 0, m: 0 },
    priceSource: item.priceSource ?? '',
    quote: item.quote ?? { supplier: '', number: '', date: '', validUntil: '', vatStatus: 'not_stated', vatRate: 10 },
  });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const num = (k: 'vl' | 'nc' | 'm') => (
    <input
      className="num"
      defaultValue={money(f.custom?.[k] ?? 0)}
      onBlur={(e) => setF({ ...f, custom: { ...f.custom, [k]: parseInputNumber(e.target.value) ?? 0 } })}
    />
  );
  const save = async () => {
    setError('');
    try {
      await api.setPricing(projectId, item.id, f);
      setMsg('Đã lưu cách tính giá.');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const q = f.quote ?? {};
  return (
    <div className="form">
      <label>
        Phương thức
        <select value={f.pricingMethod} onChange={(e) => setF({ ...f, pricingMethod: e.target.value as PricingDTO['pricingMethod'] })}>
          {Object.entries(PRICING_METHOD_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {f.pricingMethod === 'NORM_BASED' ? (
        <p className="hint">Đơn giá = Σ hao phí định mức × giá tài nguyên (mã {item.normCode || 'chưa có'}).</p>
      ) : (
        <>
          <div className="row3">
            <label>
              Đơn giá vật liệu (đ/{item.unit}){num('vl')}
            </label>
            <label>
              Đơn giá nhân công{num('nc')}
            </label>
            <label>
              Đơn giá máy{num('m')}
            </label>
          </div>
          <label>
            Nguồn / diễn giải đơn giá (bắt buộc)
            <input value={f.priceSource ?? ''} onChange={(e) => setF({ ...f, priceSource: e.target.value })} placeholder="VD: Bảng tính GTT số 03, báo giá…" />
          </label>
        </>
      )}
      {f.pricingMethod === 'MARKET_QUOTE' && (
        <>
          <div className="row2">
            <label>
              Nhà cung cấp
              <input value={q.supplier ?? ''} onChange={(e) => setF({ ...f, quote: { ...q, supplier: e.target.value } })} />
            </label>
            <label>
              Số báo giá
              <input value={q.number ?? ''} onChange={(e) => setF({ ...f, quote: { ...q, number: e.target.value } })} />
            </label>
          </div>
          <div className="row2">
            <label>
              Ngày báo giá
              <input type="date" value={q.date ?? ''} onChange={(e) => setF({ ...f, quote: { ...q, date: e.target.value } })} />
            </label>
            <label>
              Hiệu lực đến
              <input type="date" value={q.validUntil ?? ''} onChange={(e) => setF({ ...f, quote: { ...q, validUntil: e.target.value } })} />
            </label>
          </div>
          <div className="row2">
            <label>
              Thuế GTGT trong báo giá
              <select value={q.vatStatus ?? 'not_stated'} onChange={(e) => setF({ ...f, quote: { ...q, vatStatus: e.target.value } })}>
                <option value="before_vat">Chưa gồm VAT</option>
                <option value="including_vat">Đã gồm VAT (quy về trước thuế)</option>
                <option value="not_stated">Không ghi rõ</option>
              </select>
            </label>
            {q.vatStatus === 'including_vat' && (
              <label>
                Thuế suất (%)
                <input type="number" value={q.vatRate ?? 10} onChange={(e) => setF({ ...f, quote: { ...q, vatRate: Number(e.target.value) } })} />
              </label>
            )}
          </div>
        </>
      )}
      {error && <div className="error">{error}</div>}
      {msg && <p className="ok">{msg}</p>}
      <div className="actions">
        <button className="primary" onClick={save}>
          Lưu
        </button>
      </div>
    </div>
  );
}

/**
 * Cấp phối (TT 38/2026 Phụ lục VII): chọn mã cấp phối cho tài nguyên "Vữa..." của định mức, để bóc
 * tách ra xi măng/cát/đá/nước theo mác và cỡ đá thay vì để nguyên một dòng "Vữa..." chưa có giá.
 */
function MixDesignBox({ projectId, item, onSaved }: { projectId: number; item: Item; onSaved: () => void }) {
  const [kind, setKind] = useState<MixKind>('concrete');
  const [grade, setGrade] = useState('');
  const [options, setOptions] = useState<MixDesignSummary[]>([]);
  const [detail, setDetail] = useState<MixDesign | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (item.mixCode) api.mixDesign(item.mixCode).then(setDetail);
    else setDetail(null);
  }, [item.mixCode]);

  useEffect(() => {
    const t = setTimeout(() => api.mixDesigns({ kind, grade: grade.trim() || undefined }).then(setOptions), 200);
    return () => clearTimeout(t);
  }, [kind, grade]);

  const choose = async (code: string | null) => {
    setError('');
    setMsg('');
    try {
      await api.setMix(projectId, item.id, code);
      setMsg(code ? `Đã chọn cấp phối ${code}.` : 'Đã bỏ chọn cấp phối.');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="form">
      <p className="hint">
        Định mức {item.normCode} dùng tài nguyên "Vữa..." (cấp phối vật liệu) – hao phí xi măng/cát/đá/nước phụ thuộc mác và cỡ đá, chọn theo Phụ lục VII TT
        38/2026.
      </p>
      {item.mixCode && (
        <p>
          Đang dùng mã cấp phối: <b>{item.mixCode}</b>{' '}
          <button onClick={() => choose(null)}>Bỏ chọn</button>
        </p>
      )}
      <div className="row2">
        <label>
          Loại
          <select value={kind} onChange={(e) => setKind(e.target.value as MixKind)}>
            <option value="concrete">Bê tông</option>
            <option value="mortar">Vữa xây, trát</option>
          </select>
        </label>
        <label>
          Mác (VD: 250)
          <input value={grade} onChange={(e) => setGrade(e.target.value)} />
        </label>
      </div>
      <table className="table compact">
        <thead>
          <tr>
            <th>Mã</th>
            <th>Mục</th>
            <th>Quy cách</th>
            <th>Trang</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {options.map((o) => (
            <tr key={o.code} className={o.code === item.mixCode ? 'sel' : ''}>
              <td>{o.code}</td>
              <td>{o.section}</td>
              <td>{o.spec}</td>
              <td>{o.page}</td>
              <td>
                <button className={o.code === item.mixCode ? '' : 'primary'} disabled={o.code === item.mixCode} onClick={() => choose(o.code)}>
                  {o.code === item.mixCode ? 'Đang dùng' : 'Chọn'}
                </button>
              </td>
            </tr>
          ))}
          {!options.length && (
            <tr>
              <td colSpan={5} className="hint">
                Không có mã cấp phối phù hợp.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {detail && (
        <table className="table compact">
          <thead>
            <tr>
              <th>Vật liệu (cấp phối {detail.code})</th>
              <th>ĐV</th>
              <th className="num">Định mức /1m3</th>
            </tr>
          </thead>
          <tbody>
            {detail.materials.map((m) => (
              <tr key={`${m.material}-${m.unit}`}>
                <td>{m.material}</td>
                <td>{m.unit}</td>
                <td className="num">{qty(m.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <div className="error">{error}</div>}
      {msg && <p className="ok">{msg}</p>}
    </div>
  );
}

export function ItemDialog({ projectId, item, onClose, onSaved }: { projectId: number; item: Item; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<'qty' | 'price' | 'mix' | 'source'>('qty');
  const hasMixResource = item.mixCode || item.analysis.some((a) => isMixResourceName(a.name));
  return (
    <Modal title={`${item.normCode || '(chưa có mã)'} – ${item.name}`} onClose={onClose} wide>
      <div className="tabs small">
        <button className={tab === 'qty' ? 'active' : ''} onClick={() => setTab('qty')}>
          Bóc tách khối lượng
        </button>
        <button className={tab === 'price' ? 'active' : ''} onClick={() => setTab('price')}>
          Cách tính giá
        </button>
        {hasMixResource && (
          <button className={tab === 'mix' ? 'active' : ''} onClick={() => setTab('mix')}>
            Cấp phối
          </button>
        )}
        <button className={tab === 'source' ? 'active' : ''} onClick={() => setTab('source')}>
          Nguồn gốc
        </button>
      </div>
      {tab === 'qty' && <QuantityLines projectId={projectId} item={item} onSaved={onSaved} />}
      {tab === 'price' && <Pricing projectId={projectId} item={item} onSaved={onSaved} />}
      {tab === 'mix' && hasMixResource && <MixDesignBox projectId={projectId} item={item} onSaved={onSaved} />}
      {tab === 'source' && (
        <table className="table compact">
          <tbody>
            <tr>
              <th>File / sheet / dòng</th>
              <td>{item.source?.file ? `${item.source.file} / ${item.source.sheet} / dòng ${item.source.row}` : 'Nhập tay'}</td>
            </tr>
            <tr>
              <th>Mô tả gốc</th>
              <td>{item.source?.description ?? item.name}</td>
            </tr>
            {item.sourceRawText && (
              <tr>
                <th>Văn bản gốc (bảng mã cũ)</th>
                <td>
                  <code>{item.sourceRawText}</code>
                </td>
              </tr>
            )}
            <tr>
              <th>Mã gốc</th>
              <td>{item.source?.code ?? item.normCode}</td>
            </tr>
            <tr>
              <th>KL / ĐV gốc</th>
              <td>
                {item.source?.quantity ?? item.quantity} {item.source?.unit ?? item.unit}
              </td>
            </tr>
            <tr>
              <th>Nguồn khối lượng</th>
              <td>{item.quantitySource}</td>
            </tr>
            {item.sourceFlags?.length ? (
              <tr>
                <th>Cờ cảnh báo</th>
                <td className="error-text">{item.sourceFlags.join(', ')}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

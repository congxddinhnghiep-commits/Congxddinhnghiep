import { useEffect, useState } from 'react';
import {
  defaultLegalSetFor,
  defaultTt36Settings,
  knc,
  km,
  legalSetDateWarning,
  type BuildingType,
  type LegalSetId,
  type ProjectCostSettings,
} from '@dutoan/core';
import { api, type AppConfig, type EstimateResponse } from '../api';
import { parseInputNumber } from '../format';

type NumKey =
  | 'cRate'
  | 'ltRate'
  | 'ttRate'
  | 'gtkRate'
  | 'tlRate'
  | 'ntRate'
  | 'equipment'
  | 'qlda'
  | 'tuVan'
  | 'other'
  | 'contingencyQtyRate'
  | 'contingencyPriceRate'
  | 'nightShare'
  | 'nightPremium'
  | 'machineLaborShare'
  | 'priceIndexRate'
  | 'durationYears'
  | 'contingencyPeriods'
  | 'priceIndexAvg'
  | 'priceIndexDelta';

const TT11_RATES: [NumKey, string][] = [
  ['cRate', 'Chi phí chung C (%)'],
  ['ltRate', 'Chi phí nhà tạm LT (%)'],
  ['ttRate', 'Chi phí một số công việc không xác định KL từ thiết kế TT (%)'],
  ['gtkRate', 'Chi phí gián tiếp khác GTk (%)'],
  ['tlRate', 'Thu nhập chịu thuế tính trước TL (%)'],
];
const TT36_RATES: [NumKey, string][] = [
  ['cRate', 'Chi phí chung C (%) – Bảng 3.3 / 3.4'],
  ['ttRate', 'Công việc không xác định KL từ thiết kế TT (%) – Bảng 3.5'],
  ['tlRate', 'Thu nhập chịu thuế tính trước TL (%) – Bảng 3.6'],
  ['ntRate', 'Nhà tạm để ở và điều hành thi công (%) – Bảng 3.7'],
];
const COST_INPUTS: [NumKey, string][] = [
  ['equipment', 'Chi phí thiết bị (đ)'],
  ['qlda', 'Chi phí quản lý dự án (đ)'],
  ['tuVan', 'Chi phí tư vấn đầu tư xây dựng (đ)'],
  ['other', 'Chi phí khác (đ)'],
  ['contingencyQtyRate', 'Dự phòng khối lượng, công việc phát sinh kps (%, ≤ 5%)'],
];

export function SettingsTab({ data, config, onSaved }: { data: EstimateResponse; config: AppConfig; onSaved: () => void }) {
  const p = data.project;
  const [info, setInfo] = useState({
    name: p.name,
    ownerName: p.ownerName,
    location: p.location,
    buildingType: p.buildingType,
    priceBaseDate: p.priceBaseDate,
    priceDate: p.priceDate ?? '',
    gxdttTmdt: p.gxdttTmdt === null ? '' : String(p.gxdttTmdt).replace('.', ','),
  });
  const [ttOverrides, setTtOverrides] = useState<Record<number, string>>(
    Object.fromEntries(data.categories.map((c) => [c.id, c.ttRate === null || c.ttRate === undefined ? '' : String(c.ttRate).replace('.', ',')])),
  );
  const [vat, setVat] = useState(p.vatRate);
  const [s, setS] = useState<ProjectCostSettings>(data.settings);
  const [text, setText] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [switchTo, setSwitchTo] = useState<LegalSetId | null>(null);

  useEffect(() => {
    setS(data.settings);
    setText({});
  }, [data.settings]);

  const set = config.legalSets.find((x) => x.id === p.legalSet)!;
  const isTt36 = set.method === 'TT36_2026';
  const dateWarning = legalSetDateWarning(p.legalSet, info.priceDate || null);
  const suggested = defaultLegalSetFor(info.priceDate || null);

  const setNum = (k: NumKey, v: string) => {
    setText({ ...text, [k]: v });
    const n = parseInputNumber(v);
    if (n !== null) setS({ ...s, [k]: n });
  };

  const save = async () => {
    setMsg('');
    try {
      if (isTt36 && (s.contingencyQtyRate ?? 0) > 5) throw new Error('kps không vượt quá 5% (TT 36/2026, công thức 2.8).');
      const tmdt = info.gxdttTmdt.trim() === '' ? null : parseInputNumber(info.gxdttTmdt);
      if (info.gxdttTmdt.trim() !== '' && tmdt === null) throw new Error('Chi phí XD trong TMĐT không hợp lệ');
      await api.updateProject(p.id, { ...info, gxdttTmdt: tmdt, priceDate: info.priceDate || null });
      await api.saveSettings(p.id, s, vat);
      for (const c of data.categories) {
        const raw = ttOverrides[c.id] ?? '';
        const v = raw.trim() === '' ? null : parseInputNumber(raw);
        if ((c.ttRate ?? null) !== v) await api.updateCategory(p.id, c.id, { ttRate: v });
      }
      setMsg('Đã lưu cài đặt.');
      onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const changeLegalSet = async (id: LegalSetId) => {
    setMsg('');
    try {
      const target = config.legalSets.find((x) => x.id === id)!;
      // Settings shapes differ between methods – start the new set from its defaults, keep cost inputs.
      const keep = { equipment: s.equipment, qlda: s.qlda, tuVan: s.tuVan, other: s.other, contingencyQtyRate: s.contingencyQtyRate };
      await api.updateProject(p.id, { legalSet: id, confirmLegalSetChange: true });
      await api.saveSettings(p.id, target.method === 'TT36_2026' ? { ...defaultTt36Settings(info.buildingType), ...keep } : { autoRates: true, ...keep }, vat);
      setSwitchTo(null);
      setMsg(`Đã chuyển sang ${target.label} và tính lại dự toán.`);
      onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const num = (k: NumKey, disabled = false) => (
    <input className="num" disabled={disabled} value={text[k] ?? String(s[k] ?? 0).replace('.', ',')} onChange={(e) => setNum(k, e.target.value)} />
  );
  const t = set.tables;

  return (
    <div className="settings">
      <section>
        <h3>Thông tin công trình</h3>
        <div className="form">
          <label>
            Tên công trình
            <input value={info.name} onChange={(e) => setInfo({ ...info, name: e.target.value })} />
          </label>
          <label>
            Chủ đầu tư
            <input value={info.ownerName} onChange={(e) => setInfo({ ...info, ownerName: e.target.value })} />
          </label>
          <label>
            Địa điểm
            <input value={info.location} onChange={(e) => setInfo({ ...info, location: e.target.value })} />
          </label>
          <div className="row2">
            <label>
              Loại công trình
              <select value={info.buildingType} onChange={(e) => setInfo({ ...info, buildingType: e.target.value as BuildingType })}>
                {Object.entries(config.buildingTypes).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Thuế suất GTGT
              <select value={vat} onChange={(e) => setVat(Number(e.target.value))}>
                <option value={8}>8%</option>
                <option value={10}>10%</option>
                {![8, 10].includes(vat) && <option value={vat}>{vat}%</option>}
              </select>
            </label>
          </div>
          <div className="row2">
            <label>
              Ngày lập giá
              <input type="date" value={info.priceDate} onChange={(e) => setInfo({ ...info, priceDate: e.target.value })} />
            </label>
            <label>
              Ghi chú thời điểm giá
              <input placeholder="VD: Quý III/2026" value={info.priceBaseDate} onChange={(e) => setInfo({ ...info, priceBaseDate: e.target.value })} />
            </label>
          </div>
        </div>
      </section>

      <section>
        <h3>Bộ căn cứ pháp lý</h3>
        <p>
          Công trình đang dùng: <b>{set.label}</b> {set.status === 'historical' && <span className="tag">lịch sử</span>}
        </p>
        <p className="hint">Bộ pháp lý được lưu cùng công trình và không tự thay đổi khi có văn bản mới. Định mức dùng bộ {set.normDataset}.</p>
        {dateWarning && <p className="warn-box">⚠ {dateWarning}</p>}
        {switchTo ? (
          <div className="warn-box">
            Chuyển sang <b>{config.legalSets.find((x) => x.id === switchTo)!.label}</b> sẽ <b>tính lại toàn bộ dự toán</b> theo phương pháp và định mức của bộ mới
            (các hệ số hiện tại được thay bằng mặc định của bộ mới). Tiếp tục?
            <div className="actions">
              <button onClick={() => setSwitchTo(null)}>Hủy</button>
              <button className="danger" onClick={() => changeLegalSet(switchTo)}>
                Xác nhận chuyển
              </button>
            </div>
          </div>
        ) : (
          <div className="actions" style={{ justifyContent: 'flex-start' }}>
            {config.legalSets
              .filter((x) => x.id !== p.legalSet)
              .map((x) => (
                <button key={x.id} onClick={() => setSwitchTo(x.id)}>
                  Chuyển sang {x.label}
                  {x.id === suggested ? ' (khuyến nghị theo ngày lập giá)' : ''}
                </button>
              ))}
          </div>
        )}
      </section>

      {isTt36 ? (
        <section>
          <h3>Hệ số chi phí theo TT 36/2026 (Bảng 3.8)</h3>
          <label>
            Chi phí XD trước thuế của công trình trong TMĐT được duyệt (tỷ đồng) – dùng tra khoảng Bảng 3.3, 3.7
            <input className="num" placeholder="Để trống: dùng giá trị dự toán" value={info.gxdttTmdt} onChange={(e) => setInfo({ ...info, gxdttTmdt: e.target.value })} />
          </label>
          {data.costSummary.bracketBase && (
            <p className="hint">
              Đang tra khoảng theo: <b>{(data.costSummary.bracketBase.value / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 3 })} tỷ đồng</b> (
              {data.costSummary.bracketBase.from === 'tmdt' ? 'TMĐT được duyệt' : 'giá trị dự toán – chưa nhập TMĐT'}). Nếu dự án có nhiều công trình, mỗi
              công trình lập thành một công trình riêng trong phần mềm với giá trị TMĐT của chính nó.
            </p>
          )}
          <label className="check">
            <input type="checkbox" checked={!!s.autoRates} onChange={(e) => setS({ ...s, autoRates: e.target.checked })} /> Tự động tra Bảng 3.3–3.7 theo
            loại công trình và quy mô chi phí
          </label>
          {data.provisionalRates && <p className="hint warn-text">Bảng tỷ lệ đang ở trạng thái TẠM – xem mục “Căn cứ pháp lý”.</p>}
          <div className="form">
            <label>
              Loại công trình (Bảng 3.3, 3.5)
              <select value={s.workCategory} onChange={(e) => setS({ ...s, workCategory: e.target.value })}>
                {Object.entries(config.tt36WorkCategories).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cơ sở tính chi phí chung
              <select value={s.cMode} onChange={(e) => setS({ ...s, cMode: e.target.value as 'T' | 'NC' })}>
                <option value="T">Chi phí trực tiếp T (Bảng 3.3)</option>
                <option value="NC">Chi phí nhân công NC – công tác được liệt kê (Bảng 3.4)</option>
              </select>
            </label>
            {s.cMode === 'NC' && (
              <label>
                Loại công tác (Bảng 3.4)
                <select value={s.ncWorkType} onChange={(e) => setS({ ...s, ncWorkType: e.target.value })}>
                  {t['3.4'].rows.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Dòng thu nhập chịu thuế tính trước (Bảng 3.6)
              <select value={s.tlCategory ?? ''} onChange={(e) => setS({ ...s, tlCategory: e.target.value || undefined })}>
                <option value="">Theo loại công trình</option>
                {t['3.6'].rows.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={!!s.linearWorks} onChange={(e) => setS({ ...s, linearWorks: e.target.checked })} /> Công trình theo tuyến (Bảng 3.7)
            </label>
            {TT36_RATES.map(([k, label]) => (
              <label key={k}>
                {label}
                {num(k, !!s.autoRates)}
              </label>
            ))}
          </div>
          <h3>Tỷ lệ TT riêng theo hạng mục</h3>
          <p className="hint">Bảng 3.5: tỷ lệ 6,5% áp dụng cho công tác xây dựng trong đường hầm. Để trống = dùng tỷ lệ chung của công trình.</p>
          <div className="form">
            {data.categories.map((c) => (
              <label key={c.id}>
                {c.name} (%)
                <input className="num" placeholder="chung" value={ttOverrides[c.id] ?? ''} onChange={(e) => setTtOverrides({ ...ttOverrides, [c.id]: e.target.value })} />
              </label>
            ))}
          </div>
          <h3>Hệ số làm đêm (Knc, Km)</h3>
          <div className="form">
            <label>
              Tỷ lệ khối lượng làm đêm (%)
              {num('nightShare')}
            </label>
            <label>
              Tỷ lệ chênh lệch đơn giá nhân công làm đêm (%)
              {num('nightPremium')}
            </label>
            <label>
              Tỷ trọng tiền lương trong giá ca máy g (%)
              {num('machineLaborShare')}
            </label>
            <p className="hint">
              Knc = 1 + tỷ lệ làm đêm × chênh lệch = <b>{knc({ nightShare: s.nightShare ?? 0, nightPremium: s.nightPremium ?? 0 }).toFixed(4).replace('.', ',')}</b>
              ; Km = 1 + g × (Knc − 1) ={' '}
              <b>
                {km({ nightShare: s.nightShare ?? 0, nightPremium: s.nightPremium ?? 0, machineLaborShare: s.machineLaborShare ?? 0 })
                  .toFixed(4)
                  .replace('.', ',')}
              </b>
            </p>
          </div>
        </section>
      ) : (
        <section>
          <h3>Hệ số chi phí (bộ lịch sử TT 11/2021)</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={!!s.autoRates}
              onChange={(e) => setS(e.target.checked ? { ...s, autoRates: true } : { ...s, ...data.settings, autoRates: false })}
            />{' '}
            Tự động lấy theo loại công trình và quy mô chi phí
          </label>
          <p className="hint warn-text">{set.note}</p>
          <div className="form">
            <label>
              Cơ sở tính chi phí chung
              <select disabled={!!s.autoRates} value={s.cBase} onChange={(e) => setS({ ...s, cBase: e.target.value as 'T' | 'NC' })}>
                <option value="T">Chi phí trực tiếp (T)</option>
                <option value="NC">Chi phí nhân công (NC)</option>
              </select>
            </label>
            {TT11_RATES.map(([k, label]) => (
              <label key={k}>
                {label}
                {num(k, !!s.autoRates)}
              </label>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3>Tổng dự toán và dự phòng</h3>
        <div className="form">
          {COST_INPUTS.map(([k, label]) => (
            <label key={k}>
              {label}
              {num(k)}
            </label>
          ))}
          {isTt36 && (
            <label>
              Cách tính dự phòng trượt giá
              <select
                value={s.contingencyPriceMode === 'percent' ? 'percent' : 'formula'}
                onChange={(e) => setS({ ...s, contingencyPriceMode: e.target.value as 'percent' | 'formula' })}
              >
                <option value="formula">Công thức 2.9 TT 36/2026 (thời gian XD, chỉ số giá)</option>
                <option value="percent">Tỷ lệ % nhập tay (không theo công thức 2.9)</option>
              </select>
            </label>
          )}
          {isTt36 && s.contingencyPriceMode !== 'percent' ? (
            <ContingencySchedule s={s} setS={setS} num={num} />
          ) : (
            <label>
              Dự phòng trượt giá (%)
              {num('contingencyPriceRate')}
            </label>
          )}
        </div>
      </section>

      <div className="actions sticky">
        {msg && <span className="hint">{msg}</span>}
        <button className="primary" onClick={save}>
          Lưu cài đặt
        </button>
      </div>
    </div>
  );
}

/** Inputs of công thức 2.9: GDP2 = Σ G_TDP,t × [(I_bq + ΔI)^t − 1]. */
function ContingencySchedule({
  s,
  setS,
  num,
}: {
  s: ProjectCostSettings;
  setS: (s: ProjectCostSettings) => void;
  num: (k: NumKey) => JSX.Element;
}) {
  const periods = Math.max(1, Math.round(s.contingencyPeriods ?? 1));
  const sched = s.contingencySchedule && s.contingencySchedule.length === periods ? s.contingencySchedule : Array.from({ length: periods }, () => 100 / periods);
  const sum = sched.reduce((a, b) => a + b, 0);
  const unit = s.contingencyPeriodUnit === 'quy' ? 'Quý' : 'Năm';
  return (
    <>
      <div className="row2">
        <label>
          Thời gian xây dựng T (số kỳ)
          {num('contingencyPeriods')}
        </label>
        <label>
          Đơn vị kỳ
          <select value={s.contingencyPeriodUnit ?? 'nam'} onChange={(e) => setS({ ...s, contingencyPeriodUnit: e.target.value as 'nam' | 'quy' })}>
            <option value="nam">Năm</option>
            <option value="quy">Quý</option>
          </select>
        </label>
      </div>
      <div className="row2">
        <label>
          I_bq – chỉ số giá XD bình quân (VD 1,03)
          {num('priceIndexAvg')}
        </label>
        <label>
          ΔI – mức biến động bình quân (VD 0,005)
          {num('priceIndexDelta')}
        </label>
      </div>
      <div className="schedule">
        <span className="hint">Phân bổ G_TDP theo kỳ (%):</span>
        {sched.map((v, i) => (
          <label key={i}>
            {unit} {i + 1}
            <input
              className="num"
              value={String(+v.toFixed(4)).replace('.', ',')}
              onChange={(e) => {
                const n = Number(e.target.value.replace(',', '.'));
                if (!Number.isFinite(n)) return;
                const next = [...sched];
                next[i] = n;
                setS({ ...s, contingencySchedule: next });
              }}
            />
          </label>
        ))}
        <button type="button" className="small" onClick={() => setS({ ...s, contingencySchedule: Array.from({ length: periods }, () => 100 / periods) })}>
          Chia đều
        </button>
        {Math.abs(sum - 100) > 0.01 && <span className="error">Tổng phân bổ = {sum.toFixed(2)}% (phải bằng 100%)</span>}
      </div>
      <p className="hint">GDP2 = Σ G_TDP,t × [(I_bq + ΔI)^t − 1] – TT 36/2026/TT-BXD, Phụ lục II, công thức 2.9.</p>
    </>
  );
}

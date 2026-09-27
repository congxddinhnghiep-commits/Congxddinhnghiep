import { useEffect, useState } from 'react';
import { resolveDefaultRates, type BuildingType, type CostSettings } from '@dutoan/core';
import { api, type AppConfig, type EstimateResponse } from '../api';
import { parseInputNumber } from '../format';

type NumKey = 'cRate' | 'ltRate' | 'ttRate' | 'gtkRate' | 'tlRate' | 'equipment' | 'qlda' | 'tuVan' | 'other' | 'contingencyQtyRate' | 'contingencyPriceRate';

const RATE_FIELDS: [NumKey, string][] = [
  ['cRate', 'Chi phí chung C (%)'],
  ['ltRate', 'Chi phí nhà tạm LT (%)'],
  ['ttRate', 'Chi phí một số công việc không xác định KL từ thiết kế TT (%)'],
  ['gtkRate', 'Chi phí gián tiếp khác GTk (%)'],
  ['tlRate', 'Thu nhập chịu thuế tính trước TL (%)'],
];
const TDT_FIELDS: [NumKey, string][] = [
  ['equipment', 'Chi phí thiết bị (đ)'],
  ['qlda', 'Chi phí quản lý dự án (đ)'],
  ['tuVan', 'Chi phí tư vấn đầu tư xây dựng (đ)'],
  ['other', 'Chi phí khác (đ)'],
  ['contingencyQtyRate', 'Dự phòng khối lượng phát sinh (%)'],
  ['contingencyPriceRate', 'Dự phòng trượt giá (%)'],
];

export function SettingsTab({ data, config, onSaved }: { data: EstimateResponse; config: AppConfig; onSaved: () => void }) {
  const p = data.project;
  const [info, setInfo] = useState({ name: p.name, ownerName: p.ownerName, location: p.location, buildingType: p.buildingType, priceBaseDate: p.priceBaseDate });
  const [vat, setVat] = useState(p.vatRate);
  const [s, setS] = useState<CostSettings>(data.settings);
  const [text, setText] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');

  useEffect(() => {
    setS(data.settings);
    setText({});
  }, [data.settings]);

  const defaults = resolveDefaultRates(config.rates, info.buildingType, data.total.total);
  const shown = s.autoRates ? { ...s, ...defaults } : s;

  const setNum = (k: NumKey, v: string) => {
    setText({ ...text, [k]: v });
    const n = parseInputNumber(v);
    if (n !== null) setS({ ...s, [k]: n });
  };

  const save = async () => {
    setMsg('');
    try {
      await api.updateProject(p.id, info);
      await api.saveSettings(p.id, s, vat);
      setMsg('Đã lưu cài đặt.');
      onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const numInput = (k: NumKey, disabled = false) => (
    <input
      className="num"
      disabled={disabled}
      value={text[k] ?? String(shown[k] ?? 0).replace('.', ',')}
      onChange={(e) => setNum(k, e.target.value)}
    />
  );

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
              Thời điểm lập giá
              <input value={info.priceBaseDate} onChange={(e) => setInfo({ ...info, priceBaseDate: e.target.value })} />
            </label>
          </div>
          <label>
            Thuế suất GTGT
            <select value={vat} onChange={(e) => setVat(Number(e.target.value))}>
              <option value={8}>8%</option>
              <option value={10}>10%</option>
              {![8, 10].includes(vat) && <option value={vat}>{vat}%</option>}
            </select>
          </label>
        </div>
      </section>

      <section>
        <h3>Hệ số chi phí (Bảng tổng hợp chi phí)</h3>
        <label className="check">
          <input type="checkbox" checked={s.autoRates} onChange={(e) =>
              // Switching to manual starts from the current default rates.
              setS(e.target.checked ? { ...s, autoRates: true } : { ...s, ...shown, autoRates: false })
            }
          /> Tự động lấy theo loại công trình và
          quy mô chi phí
        </label>
        <p className="hint warn-text">{config.rates._note}</p>
        {s.autoRates && <p className="hint">Nguồn: {defaults.source}</p>}
        <div className="form">
          <label>
            Cơ sở tính chi phí chung
            <select disabled={s.autoRates} value={shown.cBase} onChange={(e) => setS({ ...s, cBase: e.target.value as 'T' | 'NC' })}>
              <option value="T">Chi phí trực tiếp (T)</option>
              <option value="NC">Chi phí nhân công (NC)</option>
            </select>
          </label>
          {RATE_FIELDS.map(([k, label]) => (
            <label key={k}>
              {label}
              {numInput(k, s.autoRates)}
            </label>
          ))}
        </div>
      </section>

      <section>
        <h3>Tổng dự toán</h3>
        <div className="form">
          {TDT_FIELDS.map(([k, label]) => (
            <label key={k}>
              {label}
              {numInput(k)}
            </label>
          ))}
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

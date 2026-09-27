import { amountInWords } from '@dutoan/core';
import type { EstimateResponse } from '../api';
import { money, rate } from '../format';

/** Bảng tổng hợp dự toán chi phí xây dựng theo bộ pháp lý của công trình, và Tổng dự toán. */
export function CostSummaryTab({ data }: { data: EstimateResponse }) {
  const cs = data.costSummary;
  const total = cs.total ?? cs.Gxd;
  const tt36 = data.legalSet.id === 'TT36_2026';
  return (
    <div className="summary">
      <h3>Bảng tổng hợp dự toán chi phí xây dựng</h3>
      <p className="hint">
        Căn cứ: <b>{data.legalSet.label}</b>
        {tt36 ? ' – TT 36/2026/TT-BXD Phụ lục III, Bảng 3.8 (đính chính theo QĐ 1538/QĐ-BXD).' : ' – bộ lịch sử.'} Nguồn tỷ lệ: {data.ratesSource}
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>STT</th>
            <th>Khoản mục chi phí</th>
            <th>Cách tính</th>
            <th className="num">Tỷ lệ (%) / hệ số</th>
            <th className="num">Giá trị (đ)</th>
            <th>Ký hiệu</th>
            <th>Nguồn / căn cứ</th>
          </tr>
        </thead>
        <tbody>
          {cs.lines.map((l) => (
            <tr key={l.code} className={l.level === 0 ? 'strong' : ''}>
              <td>{l.stt}</td>
              <td className={l.level === 1 ? 'indent' : ''}>{l.name}</td>
              <td className="formula">{l.formula}</td>
              <td className="num">{l.coef !== undefined ? l.coef.toFixed(4).replace('.', ',') : l.rate !== undefined ? rate(l.rate) : ''}</td>
              <td className="num">{money(l.value)}</td>
              <td>{l.code}</td>
              <td className={`source ${/TẠM|MẪU|chưa/.test(l.source ?? '') ? 'provisional' : ''}`}>{l.source}</td>
            </tr>
          ))}
        </tbody>
        {tt36 && (
          <tfoot>
            <tr className="total-row">
              <td />
              <td colSpan={3}>Tổng chi phí xây dựng (GXD + GXDNT)</td>
              <td className="num">{money(total)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        )}
      </table>
      <p className="words">
        Bằng chữ: <i>{amountInWords(total)}</i>.
      </p>

      <h3>Tổng dự toán</h3>
      <table className="table">
        <thead>
          <tr>
            <th>STT</th>
            <th>Khoản mục</th>
            <th>Cách tính</th>
            <th className="num">Giá trị (đ)</th>
          </tr>
        </thead>
        <tbody>
          {data.totalEstimate.lines.map((l, i) => (
            <tr key={l.code} className={l.code === 'TDT' ? 'strong' : ''}>
              <td>{l.code === 'TDT' ? '' : i + 1}</td>
              <td>{l.name}</td>
              <td className="formula">{l.formula}</td>
              <td className="num">{money(l.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="words">
        Bằng chữ: <i>{amountInWords(data.totalEstimate.total)}</i>.
      </p>
      <p className="hint">Nhập chi phí thiết bị, QLDA, tư vấn, chi phí khác, dự phòng và hệ số làm đêm ở tab “Cài đặt hệ số”.</p>
    </div>
  );
}

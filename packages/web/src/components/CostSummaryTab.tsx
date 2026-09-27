import { amountInWords } from '@dutoan/core';
import type { EstimateResponse } from '../api';
import { money, rate, ROMAN } from '../format';

/** Bảng tổng hợp chi phí xây dựng (TT11/2021, TT09/2024) và Tổng dự toán. */
export function CostSummaryTab({ data }: { data: EstimateResponse }) {
  let n = 0;
  return (
    <div className="summary">
      <h3>Bảng tổng hợp chi phí xây dựng</h3>
      <p className="hint">
        Căn cứ Thông tư 11/2021/TT-BXD (sửa đổi bởi TT 09/2024/TT-BXD). Nguồn hệ số: {data.ratesSource}
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>STT</th>
            <th>Khoản mục chi phí</th>
            <th>Cách tính</th>
            <th className="num">Tỷ lệ (%)</th>
            <th className="num">Giá trị (đ)</th>
            <th>Ký hiệu</th>
          </tr>
        </thead>
        <tbody>
          {data.costSummary.lines.map((l) => (
            <tr key={l.code} className={l.level === 0 ? 'strong' : ''}>
              <td>{l.level === 0 ? ROMAN[n++] : ''}</td>
              <td className={l.level === 1 ? 'indent' : ''}>{l.name}</td>
              <td className="formula">{l.formula}</td>
              <td className="num">{l.rate !== undefined ? rate(l.rate) : ''}</td>
              <td className="num">{money(l.value)}</td>
              <td>{l.code}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="words">
        Bằng chữ: <i>{amountInWords(data.costSummary.Gxd)}</i>.
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
      <p className="hint">Nhập chi phí thiết bị, QLDA, tư vấn, chi phí khác và tỷ lệ dự phòng ở tab “Cài đặt hệ số”.</p>
    </div>
  );
}

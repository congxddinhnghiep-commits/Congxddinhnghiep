import { Fragment } from 'react';
import type { EstimateResponse } from '../api';
import { money, qty } from '../format';

/** Phân tích vật tư: hao phí từng công tác. */
export function AnalysisTab({ data }: { data: EstimateResponse }) {
  let stt = 0;
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>STT</th>
            <th>Mã hiệu</th>
            <th>Tên công tác / thành phần hao phí</th>
            <th>ĐV</th>
            <th className="num">Định mức</th>
            <th className="num">Khối lượng</th>
            <th className="num">Đơn giá (đ)</th>
            <th className="num">Thành tiền (đ)</th>
          </tr>
        </thead>
        <tbody>
          {data.categories.map((cat) => (
            <Fragment key={cat.id}>
              <tr className="cat-row">
                <td colSpan={8}>{cat.name.toUpperCase()}</td>
              </tr>
              {cat.items.map((it) => (
                <Fragment key={it.id}>
                  <tr className="item-head">
                    <td>{++stt}</td>
                    <td>{it.normCode}</td>
                    <td>
                      {it.name}
                      {it.mixCode && <span className="hint"> · cấp phối {it.mixCode}</span>}
                    </td>
                    <td>{it.unit}</td>
                    <td />
                    <td className="num">{qty(it.quantity)}</td>
                    <td />
                    <td className="num">{money(it.amount.total)}</td>
                  </tr>
                  {it.analysis.map((a) => (
                    <tr key={a.resourceCode} className="sub">
                      <td />
                      <td>{a.resourceCode}</td>
                      <td>
                        <span className={`type t-${a.type}`}>{a.type}</span> {a.name}
                      </td>
                      <td>{a.unit}</td>
                      <td className="num">{qty(a.consumption)}</td>
                      <td className="num">{qty(a.quantity)}</td>
                      <td className="num">{money(a.price)}</td>
                      <td className="num">{money(a.amount)}</td>
                    </tr>
                  ))}
                  {it.missingNorm && (
                    <tr className="sub">
                      <td />
                      <td colSpan={7} className="warn">
                        Chưa có định mức cho mã này – không phân tích được vật tư.
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

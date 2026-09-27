import { Fragment } from 'react';
import { RESOURCE_TYPE_LABELS, type ResourceType } from '@dutoan/core';
import type { EstimateResponse } from '../api';
import { money, qty } from '../format';

/** Tổng hợp vật tư theo loại, kèm chênh lệch giá. */
export function ResourceSummaryTab({ data }: { data: EstimateResponse }) {
  const types: ResourceType[] = ['VL', 'NC', 'M'];
  let stt = 0;
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>STT</th>
            <th>Mã</th>
            <th>Tên vật tư, nhân công, máy</th>
            <th>ĐV</th>
            <th className="num">Khối lượng</th>
            <th className="num">Giá gốc (đ)</th>
            <th className="num">Giá công trình (đ)</th>
            <th className="num">Thành tiền (đ)</th>
            <th className="num">Chênh lệch (đ)</th>
          </tr>
        </thead>
        <tbody>
          {types.map((t) => {
            const rows = data.resourceSummary.filter((r) => r.type === t);
            if (!rows.length) return null;
            const sum = rows.reduce((a, r) => a + r.amount, 0);
            const diff = rows.reduce((a, r) => a + r.difference, 0);
            return (
              <Fragment key={t}>
                <tr className="cat-row">
                  <td colSpan={7}>{RESOURCE_TYPE_LABELS[t].toUpperCase()}</td>
                  <td className="num">{money(sum)}</td>
                  <td className="num">{money(diff)}</td>
                </tr>
                {rows.map((r) => (
                  <tr key={r.code}>
                    <td>{++stt}</td>
                    <td>{r.code}</td>
                    <td>{r.name}</td>
                    <td>{r.unit}</td>
                    <td className="num">{qty(r.quantity)}</td>
                    <td className="num">{money(r.basePrice)}</td>
                    <td className="num">{money(r.price)}</td>
                    <td className="num">{money(r.amount)}</td>
                    <td className={`num ${r.difference > 0 ? 'up' : r.difference < 0 ? 'down' : ''}`}>{r.difference ? money(r.difference) : ''}</td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="total-row">
            <td colSpan={7}>TỔNG CỘNG</td>
            <td className="num">{money(data.total.total)}</td>
            <td className="num">{money(data.resourceSummary.reduce((a, r) => a + r.difference, 0))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

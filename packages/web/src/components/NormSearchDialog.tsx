import { useEffect, useRef, useState } from 'react';
import type { Norm, Resource } from '@dutoan/core';
import { api } from '../api';
import { money, qty } from '../format';
import { Modal } from './Modal';

/** Tìm định mức theo mã hoặc tên (có dấu/không dấu). */
export function NormSearchDialog({
  initial,
  dataset,
  onPick,
  onClose,
}: {
  initial?: string;
  /** Norm book version of the project (TT38_2026 or TT12_2021). */
  dataset: string;
  onPick: (n: Norm) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(initial ?? '');
  const [list, setList] = useState<Norm[]>([]);
  const [sel, setSel] = useState(0);
  const [detail, setDetail] = useState<(Norm & { resources: (Resource & { consumption: number })[] }) | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim()) api.searchNorms(q, dataset).then((r) => (setList(r), setSel(0)));
      else setList([]);
    }, 200);
    return () => clearTimeout(t);
  }, [q, dataset]);

  useEffect(() => {
    const n = list[sel];
    if (n) api.norm(n.code, dataset).then(setDetail);
    else setDetail(null);
    listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [list, sel]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, list.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter' && list[sel]) {
      e.preventDefault();
      onPick(list[sel]);
    }
  };

  return (
    <Modal title={`Tra cứu định mức – bộ ${dataset}`} onClose={onClose} wide>
      <input
        className="search-input"
        autoFocus
        placeholder="Nhập mã hiệu hoặc tên công tác (có dấu hoặc không dấu), ví dụ: be tong cot mac 300"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
      />
      <div className="norm-search">
        <div className="norm-list" ref={listRef}>
          {list.length === 0 && q && <p className="hint">Không có kết quả.</p>}
          {list.map((n, i) => (
            <div key={n.code} data-i={i} className={`norm-row ${i === sel ? 'sel' : ''}`} onClick={() => setSel(i)} onDoubleClick={() => onPick(n)}>
              <b>{n.code}</b>
              <span>{n.name}</span>
              <em>{n.unit}</em>
            </div>
          ))}
        </div>
        <div className="norm-detail">
          {detail ? (
            <>
              <h4>
                {detail.code} – {detail.name} ({detail.unit})
              </h4>
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Mã</th>
                    <th>Thành phần hao phí</th>
                    <th>ĐV</th>
                    <th className="num">Hao phí</th>
                    <th className="num">Giá gốc</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.resources.map((r) => (
                    <tr key={r.code}>
                      <td>{r.code}</td>
                      <td>{r.name}</td>
                      <td>{r.unit}</td>
                      <td className="num">{qty(r.consumption)}</td>
                      <td className="num">{money(r.basePrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="actions">
                <button className="primary" onClick={() => onPick(detail)}>
                  Chọn định mức này (Enter)
                </button>
              </div>
            </>
          ) : (
            <p className="hint">Dùng phím ↑ ↓ để chọn, Enter để lấy định mức.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

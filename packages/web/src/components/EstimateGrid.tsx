import { Fragment, useEffect, useRef, useState } from 'react';
import type { Norm } from '@dutoan/core';
import { api, type EstimateResponse } from '../api';
import { money, parseInputNumber, qty, ROMAN } from '../format';
import { NormSearchDialog } from './NormSearchDialog';

type Col = 'code' | 'name' | 'unit' | 'formula' | 'qty';
const COLS: Col[] = ['code', 'name', 'unit', 'formula', 'qty'];

function focusCell(r: number, c: number) {
  const el = document.querySelector<HTMLInputElement>(`.grid [data-r="${r}"][data-c="${c}"]`);
  if (el) {
    el.focus();
    el.select();
  }
}

/** Spreadsheet-like cell: Enter commits and moves down, arrows move, Esc reverts, F3 opens norm search. */
function Cell({
  value,
  r,
  col,
  onCommit,
  onSearch,
  className,
  placeholder,
  clearOnCommit,
}: {
  value: string;
  r: number;
  col: Col;
  onCommit: (v: string) => void | Promise<void>;
  onSearch?: (v: string) => void;
  className?: string;
  placeholder?: string;
  /** Used by the "new item" row: empty the cell once the value was submitted. */
  clearOnCommit?: boolean;
}) {
  const [v, setV] = useState(value);
  const committed = useRef(value);
  useEffect(() => {
    setV(value);
    committed.current = value;
  }, [value]);
  const c = COLS.indexOf(col);

  const commit = async () => {
    if (v === committed.current) return;
    committed.current = v;
    await onCommit(v);
    if (clearOnCommit) {
      setV('');
      committed.current = '';
    }
  };

  return (
    <input
      className={`cell ${className ?? ''}`}
      data-r={r}
      data-c={c}
      value={v}
      title={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={async (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          await commit();
          focusCell(r + 1, c);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          focusCell(r + 1, c);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          focusCell(r - 1, c);
        } else if (e.key === 'Escape') {
          setV(committed.current);
        } else if (e.key === 'F3' && onSearch) {
          e.preventDefault();
          onSearch(v);
        }
      }}
    />
  );
}

export function EstimateGrid({ data, reload }: { data: EstimateResponse; reload: () => Promise<void> }) {
  const pid = data.project.id;
  const [error, setError] = useState('');
  const [search, setSearch] = useState<{ q: string; apply: (n: Norm) => void } | null>(null);
  const [editingCat, setEditingCat] = useState<number | null>(null);
  const [confirmCat, setConfirmCat] = useState<number | null>(null);
  const [newCat, setNewCat] = useState('');

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const quantityPatch = (s: string): Record<string, unknown> => {
    const n = parseInputNumber(s);
    if (n !== null) return { quantity: n, quantityFormula: '' };
    return { quantityFormula: s };
  };

  let row = 0;
  let stt = 0;

  return (
    <div className="grid-wrap">
      {error && <div className="error">{error}</div>}
      <div className="grid-help">
        Gõ <b>mã hiệu</b> rồi Enter để tự điền tên, đơn vị · <b>F3</b> hoặc nút 🔍 để tra định mức · Enter xuống dòng · Diễn giải khối lượng nhập công thức như <code>2*3,5*0,3</code>
      </div>
      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th rowSpan={2} style={{ width: 44 }}>
                STT
              </th>
              <th rowSpan={2} style={{ width: 120 }}>
                Mã hiệu
              </th>
              <th rowSpan={2}>Tên công tác</th>
              <th rowSpan={2} style={{ width: 70 }}>
                Đơn vị
              </th>
              <th rowSpan={2} style={{ width: 130 }}>
                Diễn giải KL
              </th>
              <th rowSpan={2} style={{ width: 100 }}>
                Khối lượng
              </th>
              <th colSpan={3}>Đơn giá (đ)</th>
              <th rowSpan={2} style={{ width: 130 }}>
                Thành tiền (đ)
              </th>
              <th rowSpan={2} style={{ width: 40 }} />
            </tr>
            <tr>
              <th style={{ width: 100 }}>Vật liệu</th>
              <th style={{ width: 100 }}>Nhân công</th>
              <th style={{ width: 100 }}>Máy</th>
            </tr>
          </thead>
          <tbody>
            {data.categories.map((cat, ci) => {
              // Row indices drive keyboard navigation: items first, then the category's "new item" row.
              const firstRow = row;
              const newRow = row + cat.items.length;
              row = newRow + 1;
              return (
                <Fragment key={cat.id}>
                  <tr className="cat-row">
                    <td>{ROMAN[ci] ?? ci + 1}</td>
                    <td colSpan={5}>
                      {editingCat === cat.id ? (
                        <input
                          className="cell"
                          autoFocus
                          defaultValue={cat.name}
                          onBlur={(e) => {
                            setEditingCat(null);
                            if (e.target.value.trim() && e.target.value !== cat.name) run(() => api.updateCategory(pid, cat.id, { name: e.target.value.trim() }));
                          }}
                          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                        />
                      ) : (
                        <span className="cat-name" onDoubleClick={() => setEditingCat(cat.id)} title="Nhấp đúp để đổi tên">
                          {cat.name.toUpperCase()}
                        </span>
                      )}
                    </td>
                    <td className="num">{money(cat.total.vl)}</td>
                    <td className="num">{money(cat.total.nc)}</td>
                    <td className="num">{money(cat.total.m)}</td>
                    <td className="num">{money(cat.total.total)}</td>
                    <td>
                      {confirmCat === cat.id ? (
                        <span className="inline-confirm">
                          <button className="danger small" onClick={() => (setConfirmCat(null), run(() => api.deleteCategory(pid, cat.id)))}>
                            Xóa
                          </button>
                          <button className="small" onClick={() => setConfirmCat(null)}>
                            Hủy
                          </button>
                        </span>
                      ) : (
                        <button className="icon" title="Xóa hạng mục" onClick={() => setConfirmCat(cat.id)}>
                          🗑
                        </button>
                      )}
                    </td>
                  </tr>
                  {cat.items.map((it, ii) => {
                    stt++;
                    const r = firstRow + ii;
                    const upd = (patch: Record<string, unknown>) => run(() => api.updateItem(pid, it.id, patch));
                    return (
                      <tr key={it.id} className={it.missingNorm ? 'missing' : ''}>
                        <td className="center">{stt}</td>
                        <td>
                          <div className="code-cell">
                            <Cell
                              value={it.normCode}
                              r={r}
                              col="code"
                              onCommit={(v) => upd({ normCode: v })}
                              onSearch={(v) => setSearch({ q: v, apply: (n) => upd({ normCode: n.code }) })}
                            />
                            <button className="icon tiny" tabIndex={-1} title="Tra định mức (F3)" onClick={() => setSearch({ q: it.name, apply: (n) => upd({ normCode: n.code }) })}>
                              🔍
                            </button>
                          </div>
                        </td>
                        <td>
                          <Cell value={it.name} r={r} col="name" onCommit={(v) => upd({ name: v })} />
                        </td>
                        <td>
                          <Cell value={it.unit} r={r} col="unit" className="center" onCommit={(v) => upd({ unit: v })} />
                        </td>
                        <td>
                          <Cell value={it.quantityFormula ?? ''} r={r} col="formula" onCommit={(v) => upd({ quantityFormula: v })} placeholder="công thức" />
                        </td>
                        <td>
                          <Cell value={qty(it.quantity)} r={r} col="qty" className="num" onCommit={(v) => upd(quantityPatch(v))} />
                        </td>
                        <td className="num">{money(it.unitCost.vl)}</td>
                        <td className="num">{money(it.unitCost.nc)}</td>
                        <td className="num">{money(it.unitCost.m)}</td>
                        <td className="num">{money(it.amount.total)}</td>
                        <td>
                          <button className="icon" tabIndex={-1} title="Xóa dòng" onClick={() => run(() => api.deleteItem(pid, it.id))}>
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="new-row">
                    <td className="center muted">+</td>
                    <td>
                      <div className="code-cell">
                        <Cell
                          value=""
                          r={newRow}
                          col="code"
                          clearOnCommit
                          placeholder="Mã hiệu…"
                          onCommit={(v) => (v.trim() ? run(() => api.createItem(pid, { categoryId: cat.id, normCode: v.trim() })) : undefined)}
                          onSearch={(v) => setSearch({ q: v, apply: (n) => run(() => api.createItem(pid, { categoryId: cat.id, normCode: n.code })) })}
                        />
                        <button
                          className="icon tiny"
                          tabIndex={-1}
                          title="Tra định mức (F3)"
                          onClick={() => setSearch({ q: '', apply: (n) => run(() => api.createItem(pid, { categoryId: cat.id, normCode: n.code })) })}
                        >
                          🔍
                        </button>
                      </div>
                    </td>
                    <td>
                      <Cell
                        value=""
                        r={newRow}
                        col="name"
                        clearOnCommit
                        placeholder="…hoặc nhập tên công tác (không có định mức)"
                        onCommit={(v) => (v.trim() ? run(() => api.createItem(pid, { categoryId: cat.id, name: v.trim() })) : undefined)}
                      />
                    </td>
                    <td colSpan={8} />
                  </tr>
                </Fragment>
              );
            })}
            <tr className="add-cat-row">
              <td />
              <td colSpan={10}>
                <input
                  className="cell"
                  placeholder="+ Thêm hạng mục mới (gõ tên rồi Enter)"
                  value={newCat}
                  onChange={(e) => setNewCat(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newCat.trim()) {
                      const name = newCat.trim();
                      setNewCat('');
                      run(() => api.createCategory(pid, name));
                    }
                  }}
                />
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="total-row">
              <td />
              <td colSpan={5}>TỔNG CỘNG CHI PHÍ TRỰC TIẾP</td>
              <td className="num">{money(data.total.vl)}</td>
              <td className="num">{money(data.total.nc)}</td>
              <td className="num">{money(data.total.m)}</td>
              <td className="num">{money(data.total.total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {search && (
        <NormSearchDialog
          initial={search.q}
          dataset={data.legalSet.normDataset}
          onClose={() => setSearch(null)}
          onPick={(n) => {
            search.apply(n);
            setSearch(null);
          }}
        />
      )}
    </div>
  );
}

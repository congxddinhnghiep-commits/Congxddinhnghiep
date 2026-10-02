import { Fragment, useEffect, useRef, useState } from 'react';
import type { Norm } from '@dutoan/core';
import { api, type EstimateResponse, type SuggestionCandidate } from '../api';
import { AutoAssignDialog, SuggestionCell } from './CodeAssist';
import { ItemDialog } from './ItemDialog';
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

export function EstimateGrid({
  data,
  reload,
  onEditImport,
  onReimportCategory,
}: {
  data: EstimateResponse;
  reload: () => Promise<void>;
  onEditImport?: (categoryId: number) => void;
  /** "Nhập lại từ file Excel (thay thế hạng mục đã nhập)": re-upload a fresh file and replace this category's items. */
  onReimportCategory?: (categoryId: number) => void;
}) {
  const pid = data.project.id;
  const [error, setError] = useState('');
  const [search, setSearch] = useState<{ q: string; apply: (n: Norm) => void } | null>(null);
  const [editingCat, setEditingCat] = useState<number | null>(null);
  const [confirmCat, setConfirmCat] = useState<number | null>(null);
  const [newCat, setNewCat] = useState('');
  const [suggestions, setSuggestions] = useState<Map<number, SuggestionCandidate[]>>(new Map());
  const [autoOpen, setAutoOpen] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [dialogItem, setDialogItem] = useState<number | null>(null);

  useEffect(() => {
    api
      .suggestions(pid)
      .then((list) => setSuggestions(new Map(list.map((s) => [s.itemId, s.candidates]))))
      .catch(() => setSuggestions(new Map()));
  }, [pid, data]);

  const autoItems = data.categories.flatMap((c) => c.items).filter((i) => i.codeStatus === 'auto');

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
      <div className="toolbar">
        <button onClick={() => setAutoOpen(true)} disabled={suggestions.size === 0} title="Gợi ý và gắn mã cho các công việc chưa có mã">
          ⚙ Gắn mã tự động{suggestions.size ? ` (${suggestions.size} chưa có mã)` : ''}
        </button>
        {autoItems.length > 0 &&
          (confirmAll ? (
            <span className="warn-box">
              Xác nhận {autoItems.length} mã gắn tự động là đúng?{' '}
              <button
                className="small primary"
                onClick={() => (setConfirmAll(false), run(() => api.confirmCodes(pid, autoItems.map((i) => i.id))))}
              >
                Xác nhận
              </button>{' '}
              <button className="small" onClick={() => setConfirmAll(false)}>
                Hủy
              </button>
            </span>
          ) : (
            <button onClick={() => setConfirmAll(true)}>✓ Xác nhận {autoItems.length} mã tự động</button>
          ))}
      </div>
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
              <th rowSpan={2} style={{ width: 150 }}>
                Gợi ý / trạng thái mã
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
              <th rowSpan={2} style={{ width: 52 }} />
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
                    <td colSpan={6}>
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
                    <td className="nowrap">
                      {onEditImport && cat.items.some((i) => i.source?.file) && (
                        <button className="icon" data-testid={`edit-import-${cat.id}`} title="Sửa lại cột đã nhập (ánh xạ cột của file Excel)" onClick={() => onEditImport(cat.id)}>
                          ⚙
                        </button>
                      )}
                      {onReimportCategory && cat.items.some((i) => i.source?.file) && (
                        <button className="icon" data-testid={`reimport-${cat.id}`} title="Nhập lại từ file Excel (thay thế hạng mục đã nhập)" onClick={() => onReimportCategory(cat.id)}>
                          ↻
                        </button>
                      )}
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
                          {(it as { sourceFlags?: string[] }).sourceFlags?.length ? (
                            <span className="flag" title={(it as { sourceFlags?: string[] }).sourceFlags!.join(', ')}>
                              ⚠ lỗi ô nguồn{' '}
                            </span>
                          ) : null}
                          {it.codeCheck === 'mismatch' && (
                            <span className="code-state review" data-testid="code-mismatch" title={it.codeCheckNote ?? ''}>
                              ⚠ mã không khớp tên{' '}
                            </span>
                          )}
                          {it.normCodeRaw && it.normCode && it.normCodeRaw.trim().toUpperCase() !== it.normCode && (
                            <span className="hint" title={it.codeCheckNote ?? ''}>
                              mã gốc {it.normCodeRaw}{' '}
                            </span>
                          )}
                          {it.pricingMethod && it.pricingMethod !== 'NORM_BASED' ? (
                            <>
                              <button className="pm" title={it.priceSource ?? 'Chưa có nguồn giá'} onClick={() => setDialogItem(it.id)}>
                                {it.pricingMethod === 'CUSTOM_GTT' ? (it.priceSource?.startsWith('File Excel') ? 'Giá file' : 'GTT') : 'Báo giá'}
                                {!it.priceSource ? ' · thiếu nguồn' : ''}
                              </button>
                              {it.normUnitCost && (
                                <span className="hint" data-testid="norm-price" title="Giá theo định mức (chỉ để so sánh, không tính vào tổng)">
                                  {' '}ĐM {money(it.normUnitCost.total)}
                                </span>
                              )}
                              {it.amountMode && (
                                <button
                                  className="icon tiny amount-mode-flag"
                                  data-testid={`amount-mode-${it.id}`}
                                  title={
                                    it.amountMode === 'file'
                                      ? 'Thành tiền đang khoá theo file (khác KL×đơn giá) – bấm để tính lại theo KL×đơn giá'
                                      : 'Đang tính theo KL×đơn giá (khác Thành tiền trong file) – bấm để dùng lại theo file'
                                  }
                                  onClick={() => run(() => api.setAmountMode(pid, it.id, it.amountMode === 'file' ? 'calc' : 'file'))}
                                >
                                  {it.amountMode === 'file' ? '🔒' : '🧮'}
                                </button>
                              )}
                            </>
                          ) : suggestions.has(it.id) ? (
                            <SuggestionCell projectId={pid} itemId={it.id} candidates={suggestions.get(it.id)!} onDone={reload} />
                          ) : it.codeStatus === 'auto' ? (
                            <button
                              className="code-state auto"
                              title={`Gắn tự động (${Math.round((it.codeConfidence ?? 0) * 100)}%) – bấm để xác nhận`}
                              onClick={() => run(() => api.confirmCode(pid, it.id))}
                            >
                              tự động · xác nhận
                            </button>
                          ) : it.codeStatus === 'confirmed' ? (
                            <span className="code-state ok">✓ đã xác nhận</span>
                          ) : it.codeStatus === 'imported' ? (
                            <span className="code-state imported">từ file</span>
                          ) : null}
                        </td>
                        <td
                          title={
                            it.source
                              ? `Diễn giải gốc: ${it.source.description ?? ''}\nKL gốc: ${it.source.quantity ?? ''} ${it.source.unit ?? ''}${it.source.file ? `\nNguồn: ${it.source.file} / ${it.source.sheet} / dòng ${it.source.row}` : ''}`
                              : undefined
                          }
                        >
                          <Cell value={it.name} r={r} col="name" onCommit={(v) => upd({ name: v })} />
                          {it.note && (
                            <span className="hint" data-testid="item-note" title="Ghi chú">
                              {' '}
                              {it.note}
                            </span>
                          )}
                        </td>
                        <td>
                          <Cell value={it.unit} r={r} col="unit" className="center" onCommit={(v) => upd({ unit: v })} />
                        </td>
                        <td>
                          <Cell value={it.quantityFormula ?? ''} r={r} col="formula" onCommit={(v) => upd({ quantityFormula: v })} placeholder="công thức" />
                        </td>
                        <td>
                          <span className="qty-cell" title={it.quantitySource === 'LINES' ? 'Khối lượng = tổng các dòng bóc tách' : undefined}>
                            {it.quantitySource === 'LINES' && <span className="sigma">Σ</span>}
                            <Cell value={qty(it.quantity)} r={r} col="qty" className="num" onCommit={(v) => upd(quantityPatch(v))} />
                          </span>
                        </td>
                        <td className="num">{money(it.unitCost.vl)}</td>
                        <td className="num">{money(it.unitCost.nc)}</td>
                        <td className="num">{money(it.unitCost.m)}</td>
                        <td className="num">{money(it.amount.total)}</td>
                        <td className="nowrap">
                          <button className="icon tiny" tabIndex={-1} title="Bóc tách khối lượng, cách tính giá, nguồn gốc" onClick={() => setDialogItem(it.id)}>
                            ⋯
                          </button>
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
                    <td />
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
              <td colSpan={11}>
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
              <td colSpan={6}>TỔNG CỘNG CHI PHÍ TRỰC TIẾP</td>
              <td className="num">{money(data.total.vl)}</td>
              <td className="num">{money(data.total.nc)}</td>
              <td className="num">{money(data.total.m)}</td>
              <td className="num">{money(data.total.total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {dialogItem !== null && (() => {
        const item = data.categories.flatMap((c) => c.items).find((i) => i.id === dialogItem);
        return item ? <ItemDialog projectId={pid} item={item} onClose={() => setDialogItem(null)} onSaved={reload} /> : null;
      })()}
      {autoOpen && <AutoAssignDialog projectId={pid} onClose={() => setAutoOpen(false)} onDone={reload} />}
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

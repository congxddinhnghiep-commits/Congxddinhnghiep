import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ELEMENT_PARAM_META, type ElementParams, type ElementType } from '@dutoan/core';
import { DecimalInput } from './DecimalInput';
import {
  api,
  type GeneratedTaskDTO,
  type ManualSheetRowDTO,
  type PushPlanRowDTO,
  type RebarScheduleRowDTO,
  type StoryDTO,
  type TakeoffElementDTO,
} from '../api';

type SubTab = 'elements' | 'manual' | 'rebar' | 'settings';
const SUB_TABS: [SubTab, string][] = [
  ['elements', 'Cấu kiện'],
  ['manual', 'Bảng tính tay'],
  ['rebar', 'Thống kê thép'],
  ['settings', 'Thiết lập'],
];

/** True (and an error is shown) when a take-off input of the panel still holds text that is not a valid number. */
const hasInvalidInput = (el: HTMLElement | null, setError: (e: string) => void): boolean => {
  const bad = el?.querySelector<HTMLInputElement>('.decimal-input.invalid');
  if (bad) {
    setError(`Có ô số chưa hợp lệ: ${bad.title}`);
    bad.focus();
  }
  return !!bad;
};

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString('vi-VN', { maximumFractionDigits: 3 }));

/** Tab "Bóc khối lượng" (Update 5): cấu kiện → công tác sinh ra → đẩy sang dự toán; bảng tính tay; thống kê thép. */
export function TakeoffTab({ projectId, categories, onPushed }: { projectId: number; categories: { id: number; name: string }[]; onPushed: () => void }) {
  const [sub, setSub] = useState<SubTab>('elements');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [types, setTypes] = useState<{ labels: Record<ElementType, string>; defaults: Record<ElementType, ElementParams> } | null>(null);
  const [stories, setStories] = useState<StoryDTO[]>([]);
  const [elements, setElements] = useState<{ element: TakeoffElementDTO; tasks: GeneratedTaskDTO[] }[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  const [manual, setManual] = useState<ManualSheetRowDTO[]>([]);
  const [rebar, setRebar] = useState<RebarScheduleRowDTO[]>([]);
  const [rebarGroups, setRebarGroups] = useState<{ type: string; groups: Record<string, number> }[]>([]);

  const [plan, setPlan] = useState<{ rows: PushPlanRowDTO[]; conflicts: number } | null>(null);
  const [pushing, setPushing] = useState(false);
  const revisionKey = `takeoff-last-push-${projectId}`;
  const [lastRevision, setLastRevision] = useState<number | null>(() => {
    const v = sessionStorage.getItem(revisionKey);
    return v ? Number(v) : null;
  });

  const reload = useCallback(async () => {
    try {
      const [t, s, e] = await Promise.all([api.elementTypes(), api.stories(projectId), api.takeoffElements(projectId)]);
      setTypes(t);
      setStories(s);
      setElements(e);
      setSelected((cur) => cur ?? e[0]?.element.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);

  const reloadManual = useCallback(() => {
    api.manualRows(projectId).then(setManual).catch((e) => setError(e.message));
  }, [projectId]);

  const reloadRebar = useCallback(() => {
    api.rebarRows(projectId).then(setRebar).catch((e) => setError(e.message));
    api.rebarSummary(projectId).then(setRebarGroups).catch(() => undefined);
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => {
    if (sub === 'manual') reloadManual();
    if (sub === 'rebar') reloadRebar();
  }, [sub, reloadManual, reloadRebar]);

  const current = elements.find((x) => x.element.id === selected) ?? null;

  const addElement = async (type: ElementType) => {
    try {
      const label = types?.labels[type] ?? type;
      const res = await api.createElement(projectId, { type, name: label, count: 1, categoryId: categories[0]?.id ?? null });
      setElements((prev) => [...prev, res]);
      setSelected(res.element.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveElement = async (id: number, patch: Partial<TakeoffElementDTO>) => {
    try {
      const res = await api.updateElement(projectId, id, patch);
      setElements((prev) => prev.map((x) => (x.element.id === id ? res : x)));
      setPlan(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeElement = async (id: number) => {
    try {
      await api.deleteElement(projectId, id);
      setElements((prev) => prev.filter((x) => x.element.id !== id));
      if (selected === id) setSelected(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const runPreview = async () => {
    setError('');
    try {
      setPlan(await api.takeoffPushPreview(projectId, {}));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const applyPush = async (overwriteKeys: string[] = []) => {
    setPushing(true);
    setError('');
    try {
      const res = await api.takeoffPushApply(projectId, { overwriteKeys });
      setNotice(`Đã đẩy sang dự toán: thêm ${res.created}, cập nhật ${res.updated}${res.skipped ? `, giữ nguyên ${res.skipped} (xung đột)` : ''}.`);
      setPlan(null);
      if (res.revisionId) {
        setLastRevision(res.revisionId);
        sessionStorage.setItem(revisionKey, String(res.revisionId));
      }
      onPushed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPushing(false);
    }
  };

  const undoLastPush = async () => {
    if (!lastRevision) return;
    try {
      await api.takeoffUndoPush(projectId, lastRevision);
      setNotice('Đã hoàn tác lần đẩy sang dự toán.');
      setLastRevision(null);
      sessionStorage.removeItem(revisionKey);
      onPushed();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="takeoff-tab">
      {error && <div className="error">{error}</div>}
      {notice && (
        <div className="notice" onClick={() => setNotice('')}>
          ✓ {notice}
        </div>
      )}
      {lastRevision !== null && (
        <button data-testid="takeoff-undo-push" onClick={undoLastPush}>
          ↶ Hoàn tác lần đẩy gần nhất
        </button>
      )}
      <nav className="subtabs">
        {SUB_TABS.map(([k, label]) => (
          <button key={k} data-testid={`takeoff-subtab-${k}`} className={sub === k ? 'active' : ''} onClick={() => setSub(k)}>
            {label}
          </button>
        ))}
      </nav>

      {sub === 'elements' && types && (
        <div className="takeoff-elements">
          <aside className="takeoff-side">
            <h4>Thêm cấu kiện</h4>
            <select data-testid="add-element-type" onChange={(e) => e.target.value && addElement(e.target.value as ElementType)} value="">
              <option value="">— Chọn loại cấu kiện —</option>
              {Object.entries(types.labels).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <ul className="takeoff-list" data-testid="element-list">
              {elements.map(({ element }) => (
                <li key={element.id} data-testid={`element-row-${element.id}`} className={selected === element.id ? 'active' : ''} onClick={() => setSelected(element.id)}>
                  <b>{element.name}</b> <span className="hint">({types.labels[element.type]} × {element.count})</span>
                  <button className="icon" title="Xóa" onClick={(ev) => { ev.stopPropagation(); removeElement(element.id); }}>
                    ✕
                  </button>
                </li>
              ))}
              {elements.length === 0 && <li className="hint">Chưa có cấu kiện nào.</li>}
            </ul>
            <div className="takeoff-push">
              <button data-testid="push-preview-btn" onClick={runPreview}>
                Xem trước đẩy sang dự toán
              </button>
              {plan && (
                <div className="push-plan">
                  <table className="table compact">
                    <thead>
                      <tr>
                        <th>Công tác</th>
                        <th>ĐVT</th>
                        <th>KL</th>
                        <th>Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.rows.map((r) => (
                        <tr key={r.group.key} className={r.conflict ? 'conflict' : ''}>
                          <td>{r.group.name}</td>
                          <td>{r.group.unit}</td>
                          <td>{num(r.group.quantity)}</td>
                          <td>{r.kind === 'create' ? 'Thêm mới' : r.kind === 'update' ? (r.conflict ? `Xung đột (hiện ${num(r.previousQuantity ?? 0)})` : 'Cập nhật') : 'Không đổi'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button className="primary" data-testid="push-apply-btn" disabled={pushing} onClick={() => applyPush(plan.rows.filter((r) => r.conflict).map((r) => r.group.key))}>
                    {pushing ? 'Đang đẩy…' : 'Đẩy sang dự toán'}
                  </button>
                </div>
              )}
            </div>
          </aside>
          <section className="takeoff-detail">
            {current ? (
              <ElementEditor
                key={current.element.id}
                element={current.element}
                tasks={current.tasks}
                categories={categories}
                stories={stories}
                defaults={types.defaults[current.element.type]}
                typeLabel={types.labels[current.element.type]}
                onSave={(patch) => saveElement(current.element.id, patch)}
              />
            ) : (
              <p className="hint">Chọn hoặc thêm một cấu kiện để xem các công tác sinh ra.</p>
            )}
          </section>
        </div>
      )}

      {sub === 'manual' && <ManualSheetPanel projectId={projectId} rows={manual} onChanged={reloadManual} />}
      {sub === 'rebar' && <RebarPanel projectId={projectId} rows={rebar} groups={rebarGroups} onChanged={reloadRebar} />}
      {sub === 'settings' && <StoriesPanel projectId={projectId} stories={stories} onChanged={reload} />}
    </div>
  );
}

function ElementEditor({
  element,
  tasks,
  categories,
  stories,
  defaults,
  typeLabel,
  onSave,
}: {
  element: TakeoffElementDTO;
  tasks: GeneratedTaskDTO[];
  categories: { id: number; name: string }[];
  stories: StoryDTO[];
  defaults: ElementParams;
  typeLabel: string;
  onSave: (patch: Partial<TakeoffElementDTO>) => void;
}) {
  const [name, setName] = useState(element.name);
  const [count, setCount] = useState(element.count);
  const [params, setParams] = useState<ElementParams>({ ...defaults, ...element.params });
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const paramKeys = useMemo(() => Object.keys(defaults), [defaults]);
  const meta = ELEMENT_PARAM_META[element.type] ?? {};
  const setParam = (k: string, v: number, save: boolean) => {
    const next = { ...paramsRef.current, [k]: v };
    paramsRef.current = next;
    setParams(next);
    if (save) onSave({ params: next });
  };

  useEffect(() => {
    setName(element.name);
    setCount(element.count);
    setParams({ ...defaults, ...element.params });
  }, [element.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="element-editor">
      <h4>{typeLabel}</h4>
      <div className="row">
        <label>
          Tên <input data-testid="element-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => onSave({ name })} />
        </label>
        <label>
          Số lượng{' '}
          <DecimalInput testId="element-count" integer min={1} value={count} onChange={setCount} onCommit={(n) => onSave({ count: n })} title="Số cấu kiện giống nhau" />
        </label>
        <label>
          Hạng mục{' '}
          <select value={element.categoryId ?? ''} onChange={(e) => onSave({ categoryId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tầng{' '}
          <select value={element.storyId ?? ''} onChange={(e) => onSave({ storyId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">—</option>
            {stories.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row params">
        {paramKeys.map((k) => {
          const m = meta[k];
          const text = m ? `${k} – ${m.label}${m.unit ? ` (${m.unit})` : ''}` : k;
          const tip = m ? `${text}\n${m.hint}` : k;
          return m?.flag ? (
            <label key={k} className="param-flag" title={tip} data-testid={`param-label-${k}`}>
              <span>
                <input data-testid={`param-${k}`} type="checkbox" checked={!!params[k]} onChange={(e) => setParam(k, e.target.checked ? 1 : 0, true)} /> {text}
              </span>
            </label>
          ) : (
            <label key={k} title={tip} data-testid={`param-label-${k}`}>
              <span className="param-label">{text}</span>
              <DecimalInput testId={`param-${k}`} value={params[k]} title={tip} onChange={(n) => setParam(k, n, false)} onCommit={(n) => setParam(k, n, true)} />
            </label>
          );
        })}
      </div>
      <h4>Công tác sinh ra</h4>
      <table className="table compact" data-testid="generated-tasks">
        <thead>
          <tr>
            <th>Công tác</th>
            <th>ĐVT</th>
            <th>Công thức (1 cấu kiện)</th>
            <th>Khối lượng</th>
            <th>Mã gợi ý</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.key} data-testid={`task-${t.key}`}>
              <td>{t.name}</td>
              <td>{t.unit}</td>
              <td className="hint">{t.formula} × {element.count}</td>
              <td>
                {t.overrideValue !== null ? (
                  <span title={t.overrideReason ?? ''}>
                    <s className="hint">{num(t.computedValue)}</s> {num(t.overrideValue)}
                  </span>
                ) : (
                  num(t.value)
                )}
              </td>
              <td data-testid={`task-code-${t.key}`}>
                <NormCodeCell task={t} />
              </td>
            </tr>
          ))}
          {tasks.length === 0 && (
            <tr>
              <td colSpan={5} className="hint">
                Chưa sinh được công tác nào (kiểm tra tham số).
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** "Mã gợi ý": best candidate + confidence (auto-assigned when ≥ 80 %), the other top-3 in the tooltip. */
function NormCodeCell({ task }: { task: GeneratedTaskDTO }) {
  const best = task.candidates?.[0];
  if (!best) return <span className="hint">chưa có mã</span>;
  const pct = (c: number) => `${Math.round(c * 100)}%`;
  const tip = task.candidates.map((c, i) => `${i + 1}. ${c.code} (${pct(c.confidence)}) ${c.name}${c.why ? `\n   ${c.why}` : ''}`).join('\n');
  const auto = task.codeStatus === 'auto';
  return (
    <span className={`norm-suggest ${auto ? 'auto' : 'weak'}`} title={`${auto ? 'Tự gắn khi đẩy sang dự toán' : 'Chỉ là gợi ý – xác nhận trong lưới dự toán'}\n${tip}`}>
      <b>{best.code}</b> <span className="hint">{pct(best.confidence)}</span>
    </span>
  );
}

function ManualSheetPanel({ projectId, rows, onChanged }: { projectId: number; rows: ManualSheetRowDTO[]; onChanged: () => void }) {
  const [expr, setExpr] = useState('');
  const [name, setName] = useState('');
  const [result, setResult] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [quick, setQuick] = useState({ n: 1, a: 0, l: 0, h: 0 });
  const [quickResult, setQuickResult] = useState<{ area: number; length: number; volume: number; lateralArea: number } | null>(null);

  const evalExpr = async () => {
    setError('');
    try {
      const r = await api.evalManual(projectId, { mode: 'expression', expression: expr });
      setResult(r.result);
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    }
  };

  const saveExpr = async () => {
    try {
      await api.saveManual(projectId, { mode: 'expression', expression: expr, drawingName: name });
      setExpr('');
      setName('');
      setResult(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const quickRef = useRef<HTMLElement>(null);

  const evalQuick = async () => {
    setError('');
    if (hasInvalidInput(quickRef.current, setError)) return;
    try {
      const r = await api.evalManual(projectId, { mode: 'quick', quick });
      setQuickResult(r.quick);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveQuick = async () => {
    setError('');
    if (hasInvalidInput(quickRef.current, setError)) return;
    try {
      await api.saveManual(projectId, { mode: 'quick', quick, drawingName: name });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="manual-sheet">
      {error && <div className="error">{error}</div>}
      <section>
        <h4>Công thức (diễn giải khối lượng tự do)</h4>
        <p className="hint">Ví dụ: a=3,5; b=4,2; 2*(a+b)*0,2*3 // tường bao</p>
        <div className="row">
          <input data-testid="manual-drawing-name" placeholder="Tên bản vẽ / ghi chú" value={name} onChange={(e) => setName(e.target.value)} />
          <input data-testid="manual-expression" style={{ flex: 1 }} placeholder="Công thức" value={expr} onChange={(e) => setExpr(e.target.value)} />
          <button data-testid="manual-eval-btn" onClick={evalExpr}>
            Tính
          </button>
          <button onClick={saveExpr} disabled={result === null}>
            Lưu dòng
          </button>
        </div>
        {result !== null && (
          <p data-testid="manual-result">
            Kết quả = <b>{num(result)}</b>
          </p>
        )}
      </section>
      <section ref={quickRef}>
        <h4>Bảng tính nhanh</h4>
        <div className="row">
          <label>
            Số lượng n <DecimalInput testId="quick-n" value={quick.n} onChange={(v) => setQuick((q) => ({ ...q, n: v }))} />
          </label>
          <label>
            Diện tích A (m²) <DecimalInput testId="quick-a" value={quick.a} onChange={(v) => setQuick((q) => ({ ...q, a: v }))} />
          </label>
          <label>
            Chiều dài L (m) <DecimalInput testId="quick-l" value={quick.l} onChange={(v) => setQuick((q) => ({ ...q, l: v }))} />
          </label>
          <label>
            Chiều cao H (m) <DecimalInput testId="quick-h" value={quick.h} onChange={(v) => setQuick((q) => ({ ...q, h: v }))} />
          </label>
          <button onClick={evalQuick}>Tính</button>
          <button onClick={saveQuick}>Lưu dòng</button>
        </div>
        {quickResult && (
          <p>
            Tổng diện tích {num(quickResult.area)} m² · Tổng chiều dài {num(quickResult.length)} m · Tổng thể tích {num(quickResult.volume)} m³ · Diện tích xung quanh{' '}
            {num(quickResult.lateralArea)} m²
          </p>
        )}
      </section>
      <table className="table compact">
        <thead>
          <tr>
            <th>Tên</th>
            <th>Chế độ</th>
            <th>Kết quả</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.drawingName || r.expression || '—'}</td>
              <td>{r.mode === 'quick' ? 'Bảng nhanh' : 'Công thức'}</td>
              <td>{r.result !== null ? num(r.result) : ''}</td>
              <td>
                <button className="icon" onClick={() => api.deleteManualRow(projectId, r.id).then(onChanged)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RebarPanel({ projectId, rows, groups, onChanged }: { projectId: number; rows: RebarScheduleRowDTO[]; groups: { type: string; groups: Record<string, number> }[]; onChanged: () => void }) {
  const [form, setForm] = useState({ cauKien: '', diaMm: 16, chieuDai1ThanhMm: 0, soCauKien: 1, soThanh1CauKien: 1 });
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);

  const add = async () => {
    setError('');
    if (hasInvalidInput(panel.current, setError)) return;
    try {
      await api.saveRebarRow(projectId, form);
      setForm({ cauKien: '', diaMm: 16, chieuDai1ThanhMm: 0, soCauKien: 1, soThanh1CauKien: 1 });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="rebar-panel" ref={panel}>
      {error && <div className="error">{error}</div>}
      <div className="row">
        <input placeholder="Cấu kiện" value={form.cauKien} onChange={(e) => setForm({ ...form, cauKien: e.target.value })} />
        <label>
          Ø (mm) <DecimalInput testId="rebar-dia" value={form.diaMm} min={0} onChange={(v) => setForm((f) => ({ ...f, diaMm: v }))} />
        </label>
        <label>
          Chiều dài 1 thanh (mm) <DecimalInput testId="rebar-length" value={form.chieuDai1ThanhMm} min={0} onChange={(v) => setForm((f) => ({ ...f, chieuDai1ThanhMm: v }))} />
        </label>
        <label>
          Số thanh/cấu kiện <DecimalInput testId="rebar-bars" integer min={0} value={form.soThanh1CauKien} onChange={(v) => setForm((f) => ({ ...f, soThanh1CauKien: v }))} />
        </label>
        <label>
          Số cấu kiện <DecimalInput testId="rebar-count" integer min={0} value={form.soCauKien} onChange={(v) => setForm((f) => ({ ...f, soCauKien: v }))} />
        </label>
        <button data-testid="rebar-add-btn" onClick={add}>
          Thêm dòng
        </button>
      </div>
      <table className="table compact" data-testid="rebar-table">
        <thead>
          <tr>
            <th>Cấu kiện</th>
            <th>Ø</th>
            <th>Dài 1 thanh (mm)</th>
            <th>Số thanh</th>
            <th>Số cấu kiện</th>
            <th>Tổng dài (m)</th>
            <th>Tổng KL (kg)</th>
            <th>Nhóm</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.cauKien}</td>
              <td>{r.diaMm}</td>
              <td>{num(r.computed.chieuDai1ThanhMm)}</td>
              <td>{r.soThanh1CauKien}</td>
              <td>{r.soCauKien}</td>
              <td>{num(r.computed.tongChieuDaiM)}</td>
              <td>{num(r.computed.tongTrongLuongKg)}</td>
              <td>{r.computed.group === 'le10' ? 'Ø≤10' : r.computed.group === 'le18' ? '10<Ø≤18' : 'Ø>18'}</td>
              <td>
                <button className="icon" onClick={() => api.deleteRebarRow(projectId, r.id).then(onChanged)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {groups.length > 0 && (
        <table className="table compact">
          <thead>
            <tr>
              <th>Loại cấu kiện</th>
              <th>Ø≤10 (tấn)</th>
              <th>10&lt;Ø≤18 (tấn)</th>
              <th>Ø&gt;18 (tấn)</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.type}>
                <td>{g.type}</td>
                <td>{num(g.groups.le10 ?? 0)}</td>
                <td>{num(g.groups.le18 ?? 0)}</td>
                <td>{num(g.groups.gt18 ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StoriesPanel({ projectId, stories, onChanged }: { projectId: number; stories: StoryDTO[]; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [height, setHeight] = useState(3.3);
  const [error, setError] = useState('');

  const panel = useRef<HTMLDivElement>(null);

  const add = async () => {
    setError('');
    if (hasInvalidInput(panel.current, setError)) return;
    try {
      await api.createStory(projectId, { name, heightM: height });
      setName('');
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="stories-panel" ref={panel}>
      {error && <div className="error">{error}</div>}
      <p className="hint">Khai báo các tầng để nhóm cấu kiện và (tùy chọn) tách công tác theo tầng khi đẩy sang dự toán.</p>
      <div className="row">
        <input data-testid="story-name" placeholder="Tên tầng (vd. Trệt, Tầng 1)" value={name} onChange={(e) => setName(e.target.value)} />
        <label>
          Chiều cao (m) <DecimalInput testId="story-height" value={height} min={0} onChange={setHeight} />
        </label>
        <button data-testid="story-add-btn" onClick={add} disabled={!name.trim()}>
          Thêm tầng
        </button>
      </div>
      <table className="table compact">
        <thead>
          <tr>
            <th>Tầng</th>
            <th>Cao độ (m)</th>
            <th>Chiều cao (m)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {stories.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{num(s.elevationM)}</td>
              <td>{num(s.heightM)}</td>
              <td>
                <button className="icon" onClick={() => api.deleteStory(projectId, s.id).then(onChanged)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        Kết nối ETABS: chưa hỗ trợ trong bản này (xem <a href="#" onClick={(e) => e.preventDefault()}>docs/ETABS.md</a> trong mã nguồn) – dùng Nhập dữ liệu để nạp bảng xuất từ ETABS, hoặc nhập tay ở tab Cấu kiện.
      </p>
    </div>
  );
}

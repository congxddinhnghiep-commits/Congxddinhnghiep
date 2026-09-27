import { useEffect, useState, type FormEvent } from 'react';
import { BOOK_TYPE_LABELS } from '@dutoan/core';
import { api, type Analysis, type AppConfig, type PriceBookInfo, type PriceBookRowInfo, type User } from '../api';
import { Modal } from '../components/Modal';
import { money } from '../format';

const VAT_LABELS = { included: 'Đã gồm VAT', excluded: 'Chưa gồm VAT', unknown: 'Chưa rõ VAT' };
const MATCH_LABELS = { matched: 'Đã khớp', manual: 'Gán tay', unmatched: 'Cần xem lại', ignored: 'Bỏ qua' };
const colName = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `C${i + 1}`);

function BookForm({ config, onSaved, onClose }: { config: AppConfig; onSaved: (b: PriceBookInfo) => void; onClose: () => void }) {
  const [f, setF] = useState({
    region: 'TP. Hồ Chí Minh',
    subArea: '',
    issuer: '',
    docNumber: '',
    docDate: '',
    periodType: 'month' as PriceBookInfo['periodType'],
    periodYear: new Date().getFullYear(),
    periodValue: new Date().getMonth() + 1,
    bookType: 'VL' as PriceBookInfo['bookType'],
    vat: 'excluded' as PriceBookInfo['vat'],
    vatRate: 10,
    delivery: '',
    sourceUrl: '',
    note: '',
  });
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      onSaved(await api.createPriceBook({ ...f, subArea: f.subArea || null, docDate: f.docDate || null, periodValue: f.periodType === 'year' ? null : f.periodValue }));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Modal title="Thêm bộ đơn giá / công bố giá" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="row2">
          <label>
            Tỉnh/thành
            <select value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })}>
              {config.regions.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label>
            Khu vực (tùy chọn)
            <input value={f.subArea} onChange={(e) => setF({ ...f, subArea: e.target.value })} />
          </label>
        </div>
        <label>
          Cơ quan công bố
          <input placeholder="VD: Sở Xây dựng TP. Hồ Chí Minh" value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} />
        </label>
        <div className="row2">
          <label>
            Số văn bản
            <input value={f.docNumber} onChange={(e) => setF({ ...f, docNumber: e.target.value })} />
          </label>
          <label>
            Ngày văn bản
            <input type="date" value={f.docDate} onChange={(e) => setF({ ...f, docDate: e.target.value })} />
          </label>
        </div>
        <div className="row2">
          <label>
            Kỳ giá
            <select value={f.periodType} onChange={(e) => setF({ ...f, periodType: e.target.value as PriceBookInfo['periodType'] })}>
              <option value="month">Tháng</option>
              <option value="quarter">Quý</option>
              <option value="year">Năm</option>
            </select>
          </label>
          <label>
            Năm / {f.periodType === 'month' ? 'tháng' : f.periodType === 'quarter' ? 'quý' : '—'}
            <span style={{ display: 'flex', gap: 4 }}>
              <input type="number" value={f.periodYear} onChange={(e) => setF({ ...f, periodYear: Number(e.target.value) })} />
              {f.periodType !== 'year' && <input type="number" value={f.periodValue} onChange={(e) => setF({ ...f, periodValue: Number(e.target.value) })} />}
            </span>
          </label>
        </div>
        <div className="row2">
          <label>
            Loại
            <select value={f.bookType} onChange={(e) => setF({ ...f, bookType: e.target.value as PriceBookInfo['bookType'] })}>
              {Object.entries(BOOK_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Thuế GTGT trong giá
            <select value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value as PriceBookInfo['vat'] })}>
              {Object.entries(VAT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        {f.vat === 'included' && (
          <label>
            Thuế suất VAT đã gồm trong giá (%)
            <input type="number" value={f.vatRate} onChange={(e) => setF({ ...f, vatRate: Number(e.target.value) })} />
          </label>
        )}
        <label>
          Điều kiện giao hàng
          <input placeholder="VD: giá đến hiện trường trung tâm TP" value={f.delivery} onChange={(e) => setF({ ...f, delivery: e.target.value })} />
        </label>
        <label>
          Nguồn (URL trang chính thức)
          <input value={f.sourceUrl} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} />
        </label>
        <label>
          Ghi chú
          <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </label>
        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Hủy
          </button>
          <button className="primary">Tạo</button>
        </div>
      </form>
    </Modal>
  );
}

function ResourcePicker({ onPick }: { onPick: (code: string) => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<{ code: string; name: string; unit: string }[]>([]);
  useEffect(() => {
    const t = setTimeout(() => (q.trim() ? api.searchResources(q).then(setList) : setList([])), 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <span className="picker">
      <input placeholder="Tìm tài nguyên…" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.length > 0 && (
        <span className="picker-list">
          {list.slice(0, 8).map((r) => (
            <button key={r.code} className="small" onClick={() => (onPick(r.code), setQ(''), setList([]))}>
              {r.code} – {r.name} ({r.unit})
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function BookDetail({ bookId, user, onChanged }: { bookId: number; user: User; onChanged: () => void }) {
  const [book, setBook] = useState<(PriceBookInfo & { rows: PriceBookRowInfo[] }) | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<'all' | 'unmatched'>('all');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const isAdmin = user.role === 'admin';
  const load = () => api.priceBook(bookId).then(setBook);
  useEffect(() => {
    load();
  }, [bookId]);
  const wrap = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const upload = (file: File) =>
    wrap(async () => {
      const form = new FormData();
      form.append('file', file);
      const up = await api.importUpload(form);
      const a = await api.importAnalyze({ fileId: up.fileId, kind: 'pricebook' });
      setAnalysis(a);
      setMapping(a.header?.mapping ?? {});
    });
  const doImport = () =>
    wrap(async () => {
      if (!analysis) return;
      const r = await api.importPriceBook(bookId, {
        fileId: analysis.fileId,
        sheetIndex: analysis.sheetIndex,
        headerRow: analysis.header?.headerRow,
        headerRows: analysis.header?.headerRows,
        mapping,
      });
      setMsg(r.message);
      setAnalysis(null);
    });
  if (!book) return <p>Đang tải…</p>;
  const rows = book.rows.filter((r) => filter === 'all' || r.matchStatus === 'unmatched');
  const width = analysis ? Math.max(0, ...analysis.preview.map((r) => r?.length ?? 0)) : 0;
  return (
    <div>
      <h3>{book.title}</h3>
      <p className="hint">
        {book.region}
        {book.subArea ? ` – ${book.subArea}` : ''} · {BOOK_TYPE_LABELS[book.bookType]} · {VAT_LABELS[book.vat]}
        {book.vat === 'included' && book.vatRate !== null ? ` (${book.vatRate}%)` : ''} · kỳ {book.periodStart} → {book.periodEnd}
        {book.docDate ? ` · ngày VB ${book.docDate}` : ''}
        {book.delivery ? ` · ${book.delivery}` : ''}
      </p>
      {book.sourceUrl && (
        <p className="hint">
          Nguồn:{' '}
          <a href={book.sourceUrl} target="_blank" rel="noreferrer">
            {book.sourceUrl}
          </a>
          {book.sourceFile ? ` · file: ${book.sourceFile}` : ''}
        </p>
      )}
      {book.note && <p className="warn-box">{book.note}</p>}
      <p>
        <span className={`status ${book.status === 'verified' ? 'verified' : 'provisional'}`}>{book.status === 'verified' ? '✓ Đã xác minh' : 'Bản nháp'}</span>{' '}
        {book.rowCount} dòng giá · {book.unmatched} cần xem lại
      </p>
      {error && <div className="error">{error}</div>}
      {msg && <p className="ok">{msg}</p>}
      {isAdmin && (
        <div className="toolbar">
          <label className="file-btn">
            ⤓ Nhập file giá (.xlsx/.xls/.csv)
            <input type="file" accept=".xlsx,.xlsm,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          {book.status === 'draft' ? (
            <button onClick={() => wrap(() => api.setPriceBookStatus(bookId, 'verified'))} disabled={!book.rowCount}>
              Đánh dấu đã xác minh
            </button>
          ) : (
            <button onClick={() => wrap(() => api.setPriceBookStatus(bookId, 'draft'))}>Chuyển về nháp</button>
          )}
        </div>
      )}
      {analysis && (
        <div className="import-preview">
          <h4>
            {analysis.fileName} – sheet {analysis.sheets[analysis.sheetIndex]?.name}{' '}
            <span className="hint">
              ({analysis.counts.item ?? 0} dòng giá nhận diện được{analysis.template ? `, mẫu “${analysis.template.name}”` : ''})
            </span>
          </h4>
          <div className="mapping">
            {analysis.fields.map((f) => (
              <label key={f.key}>
                {f.label}
                <select value={mapping[f.key] ?? -1} onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) })}>
                  <option value={-1}>— không dùng —</option>
                  {Array.from({ length: width }, (_, i) => (
                    <option key={i} value={i}>
                      {colName(i)}
                      {analysis.header?.labels[i] ? ` – ${analysis.header.labels[i].slice(0, 28)}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="table-scroll preview-table">
            <table className="table compact">
              <tbody>
                {analysis.rows
                  .filter((r) => r.type !== 'empty')
                  .slice(0, 15)
                  .map((r) => (
                    <tr key={r.index}>
                      <td className="muted">{r.excelRow}</td>
                      <td>
                        <span className={`rt rt-${r.type}`}>{analysis.rowTypeLabels[r.type]}</span>
                      </td>
                      <td>{r.code}</td>
                      <td>{r.name}</td>
                      <td>{r.unit}</td>
                      <td className="warn-text">{r.warnings.join('; ')}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <button onClick={() => setAnalysis(null)}>Hủy</button>
            <button className="primary" onClick={doImport}>
              Nhập các dòng giá
            </button>
          </div>
        </div>
      )}
      <div className="toolbar">
        <label className="check">
          <input type="checkbox" checked={filter === 'unmatched'} onChange={(e) => setFilter(e.target.checked ? 'unmatched' : 'all')} /> Chỉ hiện dòng cần xem lại
        </label>
      </div>
      <div className="table-scroll">
        <table className="table compact">
          <thead>
            <tr>
              <th>Dòng</th>
              <th>Mã gốc</th>
              <th>Tên / quy cách</th>
              <th>ĐV</th>
              <th className="num">Giá</th>
              <th>Khu vực</th>
              <th>Khớp tài nguyên</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted">{r.sourceRow}</td>
                <td>{r.rawCode}</td>
                <td>
                  {r.name}
                  {r.spec ? <span className="hint"> – {r.spec}</span> : ''}
                </td>
                <td>{r.unit}</td>
                <td className="num">{money(r.price)}</td>
                <td>{r.subArea}</td>
                <td>
                  <span className={`match m-${r.matchStatus}`}>{MATCH_LABELS[r.matchStatus]}</span> {r.resourceCode}
                  {r.matchNote ? <span className="hint"> ({r.matchNote})</span> : ''}
                </td>
                <td>
                  {isAdmin && r.matchStatus !== 'matched' && (
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      <ResourcePicker onPick={(code) => wrap(() => api.matchPriceRow(bookId, r.id, { resourceCode: code }))} />
                      {r.matchStatus !== 'ignored' && (
                        <button className="small" onClick={() => wrap(() => api.matchPriceRow(bookId, r.id, { ignore: true }))}>
                          Bỏ qua
                        </button>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {book.rows.length === 0 && <p className="hint">Chưa có dòng giá. Tải file công bố giá chính thức và nhập vào để sử dụng.</p>}
    </div>
  );
}

/** Thư viện bộ đơn giá / công bố giá theo tỉnh thành và kỳ giá. */
export function PriceBooks({ user, config }: { user: User; config: AppConfig }) {
  const [books, setBooks] = useState<PriceBookInfo[]>([]);
  const [region, setRegion] = useState('');
  const [type, setType] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const load = () => api.priceBooks({ region, type }).then(setBooks);
  useEffect(() => {
    load();
  }, [region, type]);
  return (
    <main className="page">
      <div className="page-head">
        <h2>Bộ đơn giá / công bố giá</h2>
        <span className="spacer" />
        {user.role === 'admin' && (
          <button className="primary" onClick={() => setCreating(true)}>
            + Thêm bộ đơn giá
          </button>
        )}
      </div>
      <p className="hint">
        Mỗi bộ ghi rõ tỉnh/thành, cơ quan công bố, số văn bản, kỳ giá, tình trạng VAT và nguồn. Không có giá nào được tự tạo: hãy tải file công bố giá chính thức và nhập vào.
      </p>
      <div className="toolbar">
        <select value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">Tất cả tỉnh/thành</option>
          {config.regions.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Tất cả loại</option>
          {Object.entries(BOOK_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Bộ đơn giá</th>
            <th>Tỉnh/thành</th>
            <th>Loại</th>
            <th>Kỳ giá</th>
            <th>VAT</th>
            <th className="num">Số dòng</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {books.map((b) => (
            <tr key={b.id} className="clickable" onClick={() => setOpen(b.id)}>
              <td>
                <a
                  href="#/price-books"
                  onClick={(e) => {
                    e.preventDefault();
                    setOpen(b.id);
                  }}
                >
                  {b.title}
                </a>
              </td>
              <td>
                {b.region}
                {b.subArea ? ` – ${b.subArea}` : ''}
              </td>
              <td>{BOOK_TYPE_LABELS[b.bookType]}</td>
              <td>
                {b.periodStart} → {b.periodEnd}
              </td>
              <td>{VAT_LABELS[b.vat]}</td>
              <td className="num">
                {b.rowCount}
                {b.unmatched ? <span className="warn-text"> ({b.unmatched} cần xem lại)</span> : ''}
              </td>
              <td>
                <span className={`status ${b.status === 'verified' ? 'verified' : 'provisional'}`}>{b.status === 'verified' ? 'Đã xác minh' : 'Nháp'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {creating && (
        <BookForm
          config={config}
          onClose={() => setCreating(false)}
          onSaved={(b) => {
            setCreating(false);
            load();
            setOpen(b.id);
          }}
        />
      )}
      {open !== null && (
        <Modal title="Chi tiết bộ đơn giá" onClose={() => setOpen(null)} wide>
          <BookDetail bookId={open} user={user} onChanged={load} />
        </Modal>
      )}
    </main>
  );
}

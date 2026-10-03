import { useEffect, useState } from 'react';
import { api, type Analysis, type AppConfig, type EstimateResponse, type ImportPreview, type ImportTarget, type User } from '../api';
import { EstimateImportReview } from './EstimateImportReview';
import { pickDriveFile } from './googleDrive';
import { Modal } from './Modal';

const TARGETS: { key: ImportTarget; label: string; hint: string; admin?: boolean }[] = [
  {
    key: 'estimate',
    label: 'Dự toán / BOQ có sẵn (mọi mẫu Excel: F1, G8, Eta, GXD, mẫu công ty…)',
    hint: 'Hệ thống tự nhận diện sheet, dòng tiêu đề (kể cả tiêu đề 2 dòng, song ngữ Việt–Trung), hạng mục, công việc và bỏ qua dòng Cộng/Tổng. Bạn xem lại ánh xạ trước khi nhập.',
  },
  {
    key: 'items',
    label: 'Công tác dự toán (vào công trình này)',
    hint: 'Mỗi dòng một công tác: mã hiệu, (tên, đơn vị), khối lượng hoặc diễn giải; có thể kèm cột hạng mục.',
  },
  {
    key: 'prices',
    label: 'Bảng giá vật liệu / nhân công / máy',
    hint: 'Cột mã tài nguyên và giá. Áp dụng cho công trình này hoặc cập nhật giá gốc trong thư viện (quản trị).',
  },
  {
    key: 'norms',
    label: 'Định mức (thư viện – quản trị viên)',
    hint: 'Mỗi dòng một thành phần hao phí: mã định mức (có thể chỉ ghi ở dòng đầu), mã tài nguyên, hao phí, (loại, đơn giá). Dùng để nạp định mức chính thức TT 38/2026 (nhân công theo nhóm) hoặc bộ lịch sử TT 12/2021.',
    admin: true,
  },
];

export function ImportPanel({
  config,
  user,
  data,
  editCategoryId,
  reimportCategoryId,
  workPackageId,
  onClose,
  onImported,
}: {
  config: AppConfig;
  user: User;
  data: EstimateResponse;
  /** "Sửa lại cột đã nhập" for this imported category. */
  editCategoryId?: number;
  /** "Nhập lại từ file Excel (thay thế hạng mục đã nhập)": skip reopening stored data, go straight to a fresh upload. */
  reimportCategoryId?: number;
  /** Update 6 B: hạng mục công trình currently selected in the sidebar – a FRESH import (no edit/reimport) goes there. */
  workPackageId?: number;
  onClose: () => void;
  onImported: () => void;
}) {
  const [source, setSource] = useState<'local' | 'drive'>('local');
  const [target, setTarget] = useState<ImportTarget>('estimate');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [path, setPath] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [categoryId, setCategoryId] = useState<number>(data.categories[0]?.id ?? 0);
  const [priceScope, setPriceScope] = useState<'project' | 'base'>('project');
  const datasets = [...new Set(config.legalSets.map((s) => s.normDataset))];
  const [dataset, setDataset] = useState(data.legalSet.normDataset);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [replace, setReplace] = useState<{ importId?: number; categoryIds?: number[] } | undefined>(undefined);
  const [legacy, setLegacy] = useState<{ fileName: string } | null>(null);

  const isAdmin = user.role === 'admin';
  const loaded = async (p: ImportPreview) => {
    if (target === 'estimate') {
      setAnalysis(await api.importAnalyze({ fileId: p.fileId, projectId: data.project.id }));
      setPreview(null);
      return;
    }
    setPreview(p);
    setHeaderRow(p.headerRow);
    setMapping(p.mapping);
    setMsg('');
  };

  // "Nhập lại từ file Excel (thay thế hạng mục đã nhập)": always a fresh upload, never reopen stored data.
  useEffect(() => {
    if (reimportCategoryId) setReplace({ categoryIds: [reimportCategoryId] });
  }, [reimportCategoryId]);

  // "Sửa lại cột đã nhập": re-open the stored rows of the category's import (no upload), or ask for the file again
  useEffect(() => {
    if (!editCategoryId) return;
    (async () => {
      setBusy(true);
      try {
        const info = await api.importInfo(data.project.id, editCategoryId);
        if (!info.imported) setError('Hạng mục này không phải hạng mục nhập từ file Excel.');
        else if (info.hasRaw && info.importId) {
          setReplace({ importId: info.importId });
          setAnalysis(await api.importReopen(data.project.id, info.importId));
        } else {
          setReplace({ categoryIds: [editCategoryId] });
          setLegacy({ fileName: info.fileName });
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  }, [editCategoryId, data.project.id]);

  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const upload = () =>
    wrap(async () => {
      if (file) {
        const form = new FormData();
        form.append('file', file);
        form.append('target', target);
        await loaded(await api.importUpload(form));
      } else if (path.trim()) await loaded(await api.importPath(path.trim(), target));
    });

  const fromDrive = () =>
    wrap(async () => {
      const picked = await pickDriveFile(config.googleDrive);
      if (!picked) return;
      await loaded(await api.importDrive({ fileId: picked.id, accessToken: picked.accessToken, mimeType: picked.mimeType, name: picked.name, target }));
    });

  const changeSheet = (i: number) =>
    wrap(async () => {
      if (preview) await loaded(await api.importPreview(preview.fileId, i, target));
    });

  const apply = () =>
    wrap(async () => {
      if (!preview) return;
      const r = await api.importApply({
        fileId: preview.fileId,
        sheetIndex: preview.sheetIndex,
        headerRow,
        target,
        mapping,
        projectId: data.project.id,
        categoryId: target === 'items' ? categoryId : undefined,
        priceScope,
        dataset: target === 'norms' ? dataset : undefined,
      });
      setMsg(r.message);
      onImported();
    });

  const fields = preview?.fields[target] ?? [];
  const headers = preview ? (preview.headers.length ? preview.headers : preview.rows[0] ?? []) : [];
  const colCount = Math.max(headers.length, ...(preview?.rows.map((r) => r.length) ?? [0]));
  const colName = (i: number) => {
    const h = headers[i];
    const letter = i < 26 ? String.fromCharCode(65 + i) : `C${i + 1}`;
    return h ? `${letter} – ${h}` : letter;
  };

  return (
    <Modal title={reimportCategoryId ? 'Nhập lại từ file Excel (thay thế hạng mục đã nhập)' : editCategoryId ? 'Sửa lại cột đã nhập' : 'Nhập dữ liệu'} onClose={onClose} wide>
      {legacy && (
        <div className="warn-box" data-testid="legacy-import">
          Lần nhập này (file {legacy.fileName}) chưa lưu dữ liệu gốc. <b>Hãy tải lại file Excel</b> – việc nhập lại sẽ THAY THẾ hạng mục này (tạo phiên bản mới, hoàn tác được).
        </div>
      )}
      <div className="tabs small">
        <button className={source === 'local' ? 'active' : ''} onClick={() => setSource('local')}>
          Từ máy tính
        </button>
        <button className={source === 'drive' ? 'active' : ''} onClick={() => setSource('drive')}>
          Từ Google Drive
        </button>
      </div>

      <div className="form">
        <label>
          Loại dữ liệu
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value as ImportTarget);
              setPreview(null);
              setAnalysis(null);
            }}
          >
            {TARGETS.filter((t) => !t.admin || isAdmin).map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">{TARGETS.find((t) => t.key === target)?.hint}</p>

        {source === 'local' ? (
          <>
            <label>
              Chọn file (.xlsx, .xlsm, .xls, .csv)
              <input type="file" accept=".xlsx,.xlsm,.xls,.csv,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            {config.localMode && (
              <label>
                …hoặc đường dẫn tuyệt đối trên máy này (chỉ khi chạy cục bộ)
                <input placeholder="C:\DuLieu\DinhMuc_12_2021.xlsx" value={path} onChange={(e) => setPath(e.target.value)} disabled={!!file} />
              </label>
            )}
            <div className="actions">
              <button className="primary" disabled={busy || (!file && !path.trim())} onClick={upload}>
                Đọc file
              </button>
            </div>
          </>
        ) : config.googleDrive.configured ? (
          <div className="actions">
            <button className="primary" disabled={busy} onClick={fromDrive}>
              Chọn file trên Google Drive
            </button>
          </div>
        ) : (
          <div className="notice">
            <b>Google Drive chưa được cấu hình.</b>
            <ol>
              <li>Tạo dự án trên Google Cloud Console, bật “Google Drive API” và “Google Picker API”.</li>
              <li>Tạo OAuth Client ID (Web application), thêm địa chỉ trang web vào “Authorized JavaScript origins”.</li>
              <li>Tạo API key, giới hạn cho Picker API.</li>
              <li>
                Điền <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_API_KEY</code>, <code>GOOGLE_APP_ID</code> (số hiệu dự án) vào file <code>.env</code> rồi khởi động
                lại.
              </li>
            </ol>
            Hướng dẫn chi tiết: <code>docs/google-drive-setup.md</code>. Trong lúc chờ, bạn có thể tải file từ Drive về máy rồi dùng “Từ máy tính”.
          </div>
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {msg && !preview && <p className="ok">{msg}</p>}

      {analysis && (
        <EstimateImportReview
          key={analysis.fileId}
          projectId={data.project.id}
          initial={analysis}
          replace={replace}
          workPackageId={replace ? undefined : workPackageId}
          onImported={(m) => {
            setMsg(m);
            setAnalysis(null);
            onImported();
          }}
        />
      )}

      {preview && (
        <div className="import-preview">
          <h4>
            {preview.fileName}
            {preview.sheets.length > 1 && (
              <select value={preview.sheetIndex} onChange={(e) => changeSheet(Number(e.target.value))}>
                {preview.sheets.map((s, i) => (
                  <option key={i} value={i}>
                    Sheet {s.name} ({s.rowCount} dòng)
                  </option>
                ))}
              </select>
            )}
          </h4>
          <div className="mapping">
            <label>
              Dòng tiêu đề (số thứ tự dòng trong file)
              <input type="number" min={1} value={headerRow + 1} onChange={(e) => setHeaderRow(Math.max(0, Number(e.target.value) - 1))} />
            </label>
            {fields.map((f) => (
              <label key={f.key}>
                {f.label}
                {f.required && ' *'}
                <select value={mapping[f.key] ?? -1} onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) })}>
                  <option value={-1}>— không dùng —</option>
                  {Array.from({ length: colCount }, (_, i) => (
                    <option key={i} value={i}>
                      {colName(i)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {target === 'items' && (
              <label>
                Hạng mục mặc định (khi file không có cột hạng mục)
                <select value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
                  {data.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {target === 'norms' && (
              <label>
                Nhập vào bộ định mức
                <select value={dataset} onChange={(e) => setDataset(e.target.value)}>
                  {datasets.map((d) => (
                    <option key={d} value={d}>
                      {d} – {config.legalSets.find((s) => s.normDataset === d)?.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {target === 'prices' && (
              <label>
                Áp dụng giá cho
                <select value={priceScope} onChange={(e) => setPriceScope(e.target.value as 'project' | 'base')}>
                  <option value="project">Công trình này</option>
                  {isAdmin && <option value="base">Giá gốc trong thư viện (mọi công trình)</option>}
                </select>
              </label>
            )}
          </div>
          <div className="table-scroll preview-table">
            <table className="table compact">
              <thead>
                <tr>
                  {Array.from({ length: colCount }, (_, i) => (
                    <th key={i}>{colName(i)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 12).map((r, j) => (
                  <tr key={j}>
                    {Array.from({ length: colCount }, (_, i) => (
                      <td key={i}>{r[i] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">Xem trước 12 dòng đầu sau dòng tiêu đề đã tự nhận diện.</p>
          <div className="actions">
            {msg && <span className="ok">{msg}</span>}
            <button className="primary" disabled={busy} onClick={apply}>
              Nhập dữ liệu
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

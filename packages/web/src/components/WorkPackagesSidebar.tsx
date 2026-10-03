import { useState } from 'react';
import { api, type WorkPackageDTO } from '../api';
import { money } from '../format';

/**
 * Update 6 A: "Hạng mục công trình" (work package) list on the left of the project page. Selecting one scopes the
 * grid/take-off/analysis/cost-summary tabs to ITS OWN data (STT restarts); "Tổng hợp dự án" always sees everything.
 */
export function WorkPackagesSidebar({
  projectId,
  packages,
  totals,
  selectedId,
  onSelect,
  onChanged,
}: {
  projectId: number;
  packages: WorkPackageDTO[];
  /** Per-package value shown next to its name, e.g. chi phí xây dựng; keyed by work package id. */
  totals: Record<number, number>;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [error, setError] = useState('');
  const [undoSnapshot, setUndoSnapshot] = useState<{ wpId: number; snapshot: unknown } | null>(null);

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await api.createWorkPackage(projectId, { name });
      setNewName('');
      setAdding(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const rename = async (wp: WorkPackageDTO) => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name || name === wp.name) return;
    try {
      await api.updateWorkPackage(projectId, wp.id, { name });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const duplicate = async (wp: WorkPackageDTO) => {
    try {
      await api.duplicateWorkPackage(projectId, wp.id);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (wp: WorkPackageDTO) => {
    try {
      const r = await api.deleteWorkPackage(projectId, wp.id);
      setUndoSnapshot({ wpId: wp.id, snapshot: r.undo });
      if (selectedId === wp.id) {
        const remaining = packages.filter((p) => p.id !== wp.id);
        if (remaining[0]) onSelect(remaining[0].id);
      }
      onChanged();
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 409 && confirm(`${err.message}\n\nXác nhận xóa?`)) {
        const r = await api.deleteWorkPackage(projectId, wp.id, true);
        setUndoSnapshot({ wpId: wp.id, snapshot: r.undo });
        onChanged();
      } else if (err.status !== 409) {
        setError(err.message);
      }
    }
  };

  const undo = async () => {
    if (!undoSnapshot) return;
    try {
      await api.restoreWorkPackage(projectId, undoSnapshot.snapshot);
      setUndoSnapshot(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <aside className="wp-sidebar" data-testid="wp-sidebar">
      <div className="wp-sidebar-head">
        <b>Hạng mục công trình</b>
        <button className="icon" title="Thêm hạng mục công trình" onClick={() => setAdding(true)}>
          +
        </button>
      </div>
      {error && (
        <div className="error small" onClick={() => setError('')}>
          {error}
        </div>
      )}
      {undoSnapshot && (
        <div className="notice small" data-testid="wp-undo" onClick={undo}>
          ↶ Hoàn tác xóa hạng mục
        </div>
      )}
      {adding && (
        <div className="wp-add">
          <input
            autoFocus
            placeholder="Tên hạng mục…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
              if (e.key === 'Escape') setAdding(false);
            }}
          />
          <button className="small primary" onClick={add}>
            Thêm
          </button>
          <button className="small" onClick={() => setAdding(false)}>
            Hủy
          </button>
        </div>
      )}
      <ul className="wp-list">
        {packages.map((wp) => (
          <li key={wp.id} className={wp.id === selectedId ? 'active' : ''} data-testid={`wp-${wp.id}`}>
            {renamingId === wp.id ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => rename(wp)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') rename(wp);
                  if (e.key === 'Escape') setRenamingId(null);
                }}
              />
            ) : (
              <button className="wp-select" onClick={() => onSelect(wp.id)} title={wp.sourceSheet ? `Từ sheet "${wp.sourceSheet}"` : undefined}>
                <span className="wp-name">
                  {wp.name}
                  {wp.mode === 'bao_gia' && <span className="badge">báo giá</span>}
                </span>
                <span className="wp-value">{money(totals[wp.id] ?? 0)} đ</span>
              </button>
            )}
            <span className="wp-actions">
              <button
                className="icon small"
                title="Đổi tên"
                onClick={() => {
                  setRenamingId(wp.id);
                  setRenameValue(wp.name);
                }}
              >
                ✎
              </button>
              <button className="icon small" title="Sao chép" onClick={() => duplicate(wp)}>
                ⧉
              </button>
              <button className="icon small" title="Xóa" onClick={() => remove(wp)}>
                🗑
              </button>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

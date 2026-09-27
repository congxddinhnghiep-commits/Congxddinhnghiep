import { useEffect, useState, type FormEvent } from 'react';
import type { BuildingType } from '@dutoan/core';
import { api, type AppConfig, type Project, type User } from '../api';
import { Modal } from '../components/Modal';

function ProjectForm({ config, onSaved, onClose }: { config: AppConfig; onSaved: (p: Project) => void; onClose: () => void }) {
  const [f, setF] = useState({ name: '', ownerName: '', location: '', buildingType: 'dan_dung' as BuildingType, priceBaseDate: '', vatRate: 8 });
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      onSaved(await api.createProject(f));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Modal title="Tạo công trình mới" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Tên công trình *
          <input autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label>
          Chủ đầu tư
          <input value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} />
        </label>
        <label>
          Địa điểm xây dựng
          <input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        </label>
        <div className="row2">
          <label>
            Loại công trình
            <select value={f.buildingType} onChange={(e) => setF({ ...f, buildingType: e.target.value as BuildingType })}>
              {Object.entries(config.buildingTypes).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Thuế GTGT
            <select value={f.vatRate} onChange={(e) => setF({ ...f, vatRate: Number(e.target.value) })}>
              <option value={8}>8%</option>
              <option value={10}>10%</option>
            </select>
          </label>
        </div>
        <label>
          Thời điểm lập giá (ví dụ: Quý III/2026)
          <input value={f.priceBaseDate} onChange={(e) => setF({ ...f, priceBaseDate: e.target.value })} />
        </label>
        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Hủy
          </button>
          <button className="primary">Tạo công trình</button>
        </div>
      </form>
    </Modal>
  );
}

function UsersDialog({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [f, setF] = useState({ username: '', password: '', fullName: '', role: 'user' });
  const [msg, setMsg] = useState('');
  const load = () => api.users().then(setUsers);
  useEffect(() => {
    load();
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createUser(f);
      setMsg(`Đã tạo tài khoản ${f.username}. Người dùng sẽ phải đổi mật khẩu khi đăng nhập lần đầu.`);
      setF({ username: '', password: '', fullName: '', role: 'user' });
      load();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  return (
    <Modal title="Quản lý người dùng" onClose={onClose}>
      <table className="table compact">
        <thead>
          <tr>
            <th>Tên đăng nhập</th>
            <th>Họ tên</th>
            <th>Vai trò</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>{u.fullName}</td>
              <td>{u.role === 'admin' ? 'Quản trị' : 'Người dùng'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="form" onSubmit={submit}>
        <h4>Thêm người dùng</h4>
        <div className="row2">
          <label>
            Tên đăng nhập
            <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
          </label>
          <label>
            Họ tên
            <input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
          </label>
        </div>
        <div className="row2">
          <label>
            Mật khẩu tạm (≥ 8 ký tự)
            <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
          </label>
          <label>
            Vai trò
            <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              <option value="user">Người dùng</option>
              <option value="admin">Quản trị</option>
            </select>
          </label>
        </div>
        {msg && <div className="hint">{msg}</div>}
        <div className="actions">
          <button className="primary" disabled={!f.username || !f.password}>
            Thêm
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ProjectList({ user, config, onOpen }: { user: User; config: AppConfig; onOpen: (id: number) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = () =>
    api
      .projects()
      .then(setProjects)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const copy = async (id: number) => {
    await api.copyProject(id);
    load();
  };
  const remove = async (id: number) => {
    await api.deleteProject(id);
    setConfirmDelete(null);
    load();
  };

  return (
    <main className="page">
      <div className="page-head">
        <h2>Danh sách công trình</h2>
        <span className="spacer" />
        {user.role === 'admin' && <button onClick={() => setShowUsers(true)}>Người dùng</button>}
        <button className="primary" onClick={() => setCreating(true)}>
          + Tạo công trình
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {projects === null ? (
        <p>Đang tải…</p>
      ) : projects.length === 0 ? (
        <div className="empty">
          <p>Chưa có công trình nào.</p>
          <button className="primary" onClick={() => setCreating(true)}>
            Tạo công trình đầu tiên
          </button>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Tên công trình</th>
              <th>Chủ đầu tư</th>
              <th>Địa điểm</th>
              <th>Loại</th>
              <th>Cập nhật</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} className="clickable" onDoubleClick={() => onOpen(p.id)}>
                <td>
                  <a
                    href={`#/project/${p.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      onOpen(p.id);
                    }}
                  >
                    {p.name}
                  </a>
                </td>
                <td>{p.ownerName}</td>
                <td>{p.location}</td>
                <td>{config.buildingTypes[p.buildingType]}</td>
                <td>{new Date(p.updatedAt.replace(' ', 'T') + 'Z').toLocaleString('vi-VN')}</td>
                <td className="row-actions">
                  <button onClick={() => onOpen(p.id)}>Mở</button>
                  <button onClick={() => copy(p.id)}>Sao chép</button>
                  {confirmDelete === p.id ? (
                    <>
                      <button className="danger" onClick={() => remove(p.id)}>
                        Xác nhận xóa
                      </button>
                      <button onClick={() => setConfirmDelete(null)}>Hủy</button>
                    </>
                  ) : (
                    <button className="danger-outline" onClick={() => setConfirmDelete(p.id)}>
                      Xóa
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {creating && (
        <ProjectForm
          config={config}
          onClose={() => setCreating(false)}
          onSaved={(p) => {
            setCreating(false);
            onOpen(p.id);
          }}
        />
      )}
      {showUsers && <UsersDialog onClose={() => setShowUsers(false)} />}
    </main>
  );
}

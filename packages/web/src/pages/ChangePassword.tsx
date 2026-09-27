import { useState, type FormEvent } from 'react';
import { api, type User } from '../api';

export function ChangePassword({
  user,
  onDone,
  onLogout,
  forced,
}: {
  user: User;
  onDone: (token: string, user: User) => void;
  onLogout: () => void;
  forced?: boolean;
}) {
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirm) return setError('Mật khẩu nhập lại không khớp');
    try {
      const r = await api.changePassword(oldPassword, newPassword);
      onDone(r.token, r.user);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h2>Đổi mật khẩu</h2>
        {forced && (
          <p className="hint">
            Xin chào <b>{user.fullName || user.username}</b>. Đây là lần đăng nhập đầu tiên, vui lòng đổi mật khẩu mặc định (tối thiểu 8 ký tự).
          </p>
        )}
        <label>
          Mật khẩu hiện tại
          <input type="password" autoFocus value={oldPassword} onChange={(e) => setOld(e.target.value)} autoComplete="current-password" />
        </label>
        <label>
          Mật khẩu mới
          <input type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} autoComplete="new-password" />
        </label>
        <label>
          Nhập lại mật khẩu mới
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={!oldPassword || !newPassword}>
          Lưu mật khẩu
        </button>
        <button type="button" className="link" onClick={onLogout}>
          Đăng xuất
        </button>
      </form>
    </div>
  );
}

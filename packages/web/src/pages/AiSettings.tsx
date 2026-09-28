import { useEffect, useState } from 'react';
import { api, type AiStatus, type User } from '../api';

const PROVIDER_CHOICES: { id: 'openai' | 'anthropic' | 'offline' | 'auto'; label: string; hint: string }[] = [
  { id: 'openai', label: 'ChatGPT (OpenAI)', hint: 'Dùng OPENAI_API_KEY' },
  { id: 'anthropic', label: 'Claude (Anthropic)', hint: 'Dùng ANTHROPIC_API_KEY' },
  { id: 'offline', label: 'Ngoại tuyến', hint: 'Bộ hiểu lệnh theo quy tắc, không cần khóa, không gọi mạng' },
  { id: 'auto', label: 'Tự chọn', hint: 'Claude nếu có khóa Anthropic, ngược lại ChatGPT nếu có khóa OpenAI, ngược lại ngoại tuyến' },
];

/** Màn hình "Trợ lý AI": chọn nhà cung cấp và tên mô hình, xem trạng thái khóa, kiểm tra kết nối. Khóa API chỉ nằm ở máy chủ. */
export function AiSettings({ user, onChanged }: { user: User; onChanged: () => void }) {
  const [st, setSt] = useState<AiStatus | null>(null);
  const [provider, setProvider] = useState<'openai' | 'anthropic' | 'offline' | 'auto'>('auto');
  const [models, setModels] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const isAdmin = user.role === 'admin';

  const apply = (s: AiStatus) => {
    setSt(s);
    setProvider(s.requested);
    setModels(Object.fromEntries(s.providers.map((p) => [p.id, p.model])));
  };
  useEffect(() => {
    api.aiStatus().then(apply).catch((e) => setError((e as Error).message));
  }, []);

  const save = async () => {
    setBusy('save');
    setError('');
    setMsg('');
    try {
      const defaults = Object.fromEntries((st?.providers ?? []).map((p) => [p.id, p.defaultModel]));
      const send = Object.fromEntries(Object.entries(models).map(([k, v]) => [k, v.trim() === defaults[k] ? '' : v.trim()]));
      apply(await api.aiSaveSettings({ provider, models: send }));
      setMsg('Đã lưu cài đặt trợ lý AI.');
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const test = async (id: 'openai' | 'anthropic') => {
    setBusy(id);
    setError('');
    setMsg('');
    try {
      const r = await api.aiTest(id);
      apply(r.status);
      if (r.ok) setMsg(`✔ Kết nối ${id === 'openai' ? 'ChatGPT' : 'Claude'} hoạt động (mô hình ${r.model}, ${r.latencyMs} ms).`);
      else setError(r.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  if (!st) return <main className="page">{error ? <div className="error">{error}</div> : 'Đang tải…'}</main>;
  return (
    <main className="page" data-testid="ai-settings">
      <h2>Trợ lý AI</h2>
      <p>
        Đang dùng: <b data-testid="ai-active">{st.activeLabel}</b>
        {st.activeModel && <> · mô hình <code>{st.activeModel}</code></>}
        {st.fellBack && <span className="warn-text"> (nhà cung cấp đã chọn chưa có khóa API – đang dùng chế độ ngoại tuyến)</span>}
      </p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="notice">{msg}</div>}

      <h3>Nhà cung cấp</h3>
      <div className="form">
        {PROVIDER_CHOICES.map((c) => (
          <label key={c.id} className="check">
            <input type="radio" name="provider" data-testid={`ai-provider-${c.id}`} checked={provider === c.id} disabled={!isAdmin} onChange={() => setProvider(c.id)} />
            <b>{c.label}</b> <span className="hint">– {c.hint}</span>
          </label>
        ))}
      </div>

      <table className="table" data-testid="ai-providers">
        <thead>
          <tr>
            <th>Nhà cung cấp</th>
            <th>Trạng thái</th>
            <th>Tên mô hình</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {st.providers.map((p) => (
            <tr key={p.id}>
              <td>
                <b>{p.label}</b>
                <div className="hint">biến môi trường <code>{p.envKey}</code></div>
              </td>
              <td>
                <span className={`vbadge ${p.hasKey ? (p.tested === false ? 'fail' : 'pass') : 'warning'}`} data-testid={`ai-status-${p.id}`}>
                  {p.status}
                </span>
                <div className="hint">{p.detail}</div>
              </td>
              <td>
                <input data-testid={`ai-model-${p.id}`} value={models[p.id] ?? ''} disabled={!isAdmin} placeholder={p.defaultModel} onChange={(e) => setModels({ ...models, [p.id]: e.target.value })} />
              </td>
              <td>
                <button data-testid={`ai-test-${p.id}`} disabled={!isAdmin || !p.hasKey || !!busy} onClick={() => test(p.id)}>
                  {busy === p.id ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions" style={{ justifyContent: 'flex-start' }}>
        <button className="primary" data-testid="ai-save" disabled={!isAdmin || !!busy} onClick={save}>
          Lưu cài đặt
        </button>
        {!isAdmin && <span className="hint">Chỉ quản trị viên được đổi cài đặt.</span>}
      </div>

      <h3>Cách kết nối ChatGPT / Claude</h3>
      <ol className="guide">
        <li>
          <b>Tạo khóa API.</b> ChatGPT: <code>platform.openai.com/api-keys</code> → “Create new secret key”. Claude: <code>console.anthropic.com/settings/keys</code> → “Create Key”. Cần bật thanh toán / có số dư trên tài khoản nhà cung cấp (đăng ký ChatGPT Plus hoặc Claude Pro KHÔNG bao gồm khóa API).
        </li>
        <li>
          <b>Trên GitHub Codespaces:</b> GitHub → Settings → Codespaces → “Secrets” → New secret, tên <code>OPENAI_API_KEY</code> hoặc <code>ANTHROPIC_API_KEY</code> (chọn kho lưu trữ này) → mở lại Codespace (hoặc “Rebuild”) rồi chạy <code>npm run build &amp;&amp; npm start</code>.
        </li>
        <li>
          <b>Chạy trên máy cá nhân / máy chủ:</b> tạo file <code>.env</code> ở thư mục gốc (đã được <code>.gitignore</code>, không đưa lên Git) với dòng <code>OPENAI_API_KEY=…</code> hoặc <code>ANTHROPIC_API_KEY=…</code> (xem <code>.env.example</code>), rồi khởi động lại ứng dụng. Có thể đặt tên mô hình bằng <code>OPENAI_MODEL</code>, <code>ANTHROPIC_MODEL</code>.
        </li>
        <li>
          Quay lại trang này, bấm <b>Kiểm tra kết nối</b>, chọn nhà cung cấp rồi <b>Lưu cài đặt</b>. Khóa chỉ nằm ở máy chủ: không gửi xuống trình duyệt, không ghi log, không lưu vào cơ sở dữ liệu.
        </li>
        <li>
          Mọi thay đổi do AI đề xuất đều ở dạng <b>bản xem trước</b> – chỉ áp dụng khi bạn bấm “Áp dụng” và hoàn tác được. Nếu khóa sai, hết hạn mức hoặc mất mạng, trợ lý tự chuyển sang chế độ ngoại tuyến và báo rõ lý do.
        </li>
      </ol>
    </main>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler, type AppConfig, type User } from './api';
import { ChangePassword } from './pages/ChangePassword';
import { AiSettings } from './pages/AiSettings';
import { LegalRegister } from './pages/LegalRegister';
import { PriceBooks } from './pages/PriceBooks';
import { Login } from './pages/Login';
import { ProjectList } from './pages/ProjectList';
import { ProjectView } from './pages/ProjectView';

type Route = { name: 'projects' } | { name: 'project'; id: number } | { name: 'legal' } | { name: 'priceBooks' } | { name: 'ai' };

function parseHash(): Route {
  if (location.hash.startsWith('#/legal')) return { name: 'legal' };
  if (location.hash.startsWith('#/ai')) return { name: 'ai' };
  if (location.hash.startsWith('#/price-books')) return { name: 'priceBooks' };
  const m = /^#\/project\/(\d+)/.exec(location.hash);
  return m ? { name: 'project', id: Number(m[1]) } : { name: 'projects' };
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(!!getToken());
  const [route, setRoute] = useState<Route>(parseHash);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setConfig(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
  }, [logout]);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    api
      .me()
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (user && !user.mustChangePassword) api.config().then(setConfig).catch(() => undefined);
  }, [user]);

  const onLogin = (token: string, u: User) => {
    setToken(token);
    setUser(u);
  };

  const navigate = (r: Route) => {
    location.hash = r.name === 'project' ? `#/project/${r.id}` : '#/projects';
  };

  if (loading) return <div className="center-screen">Đang tải…</div>;
  if (!user) return <Login onLogin={onLogin} />;
  if (user.mustChangePassword) return <ChangePassword user={user} onDone={onLogin} onLogout={logout} forced />;
  if (!config) return <div className="center-screen">Đang tải cấu hình…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/projects">
          <span className="logo">D</span> DUTOAN-AI
        </a>
        <span className="subtitle">Phần mềm lập dự toán xây dựng</span>
        <a className="nav" href="#/projects">
          Công trình
        </a>
        <a className="nav" href="#/price-books">
          Bộ đơn giá
        </a>
        <a className="nav" href="#/legal">
          Căn cứ pháp lý
        </a>
        <a className="nav" href="#/ai" data-testid="nav-ai">
          Trợ lý AI
        </a>
        <span className="spacer" />
        <span className="user">
          {user.fullName || user.username}
          {user.role === 'admin' && <span className="badge">Quản trị</span>}
        </span>
        <button className="link" onClick={logout}>
          Đăng xuất
        </button>
      </header>
      {config.sampleData && (
        <div className="banner-sample">
          ⚠ Dữ liệu định mức/đơn giá MẪU – thay bằng dữ liệu chính thức (định mức TT 38/2026, đơn giá địa phương) qua chức năng <b>Nhập dữ liệu</b>.
        </div>
      )}
      {route.name === 'ai' ? (
        <AiSettings user={user} onChanged={() => api.config().then(setConfig).catch(() => undefined)} />
      ) : route.name === 'legal' ? (
        <LegalRegister user={user} />
      ) : route.name === 'priceBooks' ? (
        <PriceBooks user={user} config={config} />
      ) : route.name === 'projects' ? (
        <ProjectList user={user} config={config} onOpen={(id) => navigate({ name: 'project', id })} />
      ) : (
        <ProjectView key={route.id} projectId={route.id} user={user} config={config} onBack={() => navigate({ name: 'projects' })} />
      )}
    </div>
  );
}

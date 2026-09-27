import { useCallback, useEffect, useState } from 'react';
import { api, downloadExcel, type AppConfig, type EstimateResponse, type User } from '../api';
import { AnalysisTab } from '../components/AnalysisTab';
import { AssistantPanel } from '../components/AssistantPanel';
import { CostSummaryTab } from '../components/CostSummaryTab';
import { EstimateGrid } from '../components/EstimateGrid';
import { ImportPanel } from '../components/ImportPanel';
import { PricesTab } from '../components/PricesTab';
import { ResourceSummaryTab } from '../components/ResourceSummaryTab';
import { SettingsTab } from '../components/SettingsTab';
import { ValidationTab } from '../components/ValidationTab';
import { money } from '../format';

const TABS = [
  ['estimate', 'Dự toán chi tiết'],
  ['prices', 'Giá vật liệu/NC/Máy'],
  ['analysis', 'Phân tích vật tư'],
  ['resources', 'Tổng hợp vật tư'],
  ['summary', 'Tổng hợp chi phí'],
  ['settings', 'Cài đặt hệ số'],
  ['validation', 'Kiểm tra'],
] as const;
type Tab = (typeof TABS)[number][0];

export function ProjectView({ projectId, user, config, onBack }: { projectId: number; user: User; config: AppConfig; onBack: () => void }) {
  const [data, setData] = useState<EstimateResponse | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('estimate');
  const [showAssistant, setShowAssistant] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [exporting, setExporting] = useState(false);

  const reload = useCallback(async () => {
    try {
      setData(await api.estimate(projectId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const approve = async (on: boolean) => {
    setError('');
    try {
      if (on) await api.approve(projectId);
      else await api.unapprove(projectId);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      await downloadExcel(projectId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  if (error && !data)
    return (
      <main className="page">
        <div className="error">{error}</div>
        <button onClick={onBack}>← Danh sách công trình</button>
      </main>
    );
  if (!data) return <main className="page">Đang tải…</main>;

  return (
    <div className={`project ${showAssistant ? 'with-assistant' : ''}`}>
      <main className="project-main">
        <div className="page-head">
          <button className="link" onClick={onBack}>
            ← Công trình
          </button>
          <h2 title={data.project.name}>{data.project.name}</h2>
          <a className={`legal-badge ${data.legalSet.status}`} href="#/legal" title="Bộ căn cứ pháp lý của công trình">
            {data.legalSet.label}
          </a>
          <span className="spacer" />
          {data.project.status === 'approved' ? (
            <span className="status verified" title={`Duyệt bởi ${data.project.approvedBy} lúc ${data.project.approvedAt}`}>
              ✓ Đã duyệt
            </span>
          ) : (
            <span className="status provisional">Nháp</span>
          )}
          <span className="kpi">
            Chi phí xây dựng: <b>{money(data.costSummary.total ?? data.costSummary.Gxd)}</b> đ
          </span>
          {data.project.status === 'approved' ? (
            <button onClick={() => approve(false)}>Hủy duyệt</button>
          ) : (
            <button onClick={() => approve(true)} title="Không duyệt được khi còn mã gắn tự động chưa xác nhận">
              Duyệt dự toán
            </button>
          )}
          <button onClick={() => setShowImport(true)}>⤓ Nhập dữ liệu</button>
          <button onClick={exportExcel} disabled={exporting}>
            {exporting ? 'Đang xuất…' : '⤒ Xuất Excel'}
          </button>
          {!showAssistant && (
            <button className="primary" onClick={() => setShowAssistant(true)}>
              🤖 Trợ lý AI
            </button>
          )}
        </div>
        {error && <div className="error">{error}</div>}
        {(data.warnings.length > 0 || data.notes.length > 0) && (
          <div className={`banner-legal ${data.provisionalRates ? 'provisional' : ''}`} role="status">
            {data.warnings.map((w, i) => (
              <div key={i}>⚠ {w}</div>
            ))}
            {data.notes.map((n, i) => (
              <div key={`n${i}`} className="note">
                ℹ {n}
              </div>
            ))}
            {data.provisionalRates && (
              <div>
                Quản trị viên có thể đánh dấu “đã xác minh” sau khi đối chiếu tại mục <a href="#/legal">Căn cứ pháp lý</a>.
              </div>
            )}
          </div>
        )}
        <nav className="tabs">
          {TABS.map(([k, label]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="tab-body">
          {tab === 'estimate' && <EstimateGrid data={data} reload={reload} />}
          {tab === 'prices' && <PricesTab project={data.project} config={config} onChanged={reload} />}
          {tab === 'analysis' && <AnalysisTab data={data} />}
          {tab === 'resources' && <ResourceSummaryTab data={data} />}
          {tab === 'summary' && <CostSummaryTab data={data} />}
          {tab === 'settings' && <SettingsTab data={data} config={config} onSaved={reload} />}
          {tab === 'validation' && <ValidationTab projectId={projectId} version={data} />}
        </div>
      </main>
      {showAssistant && (
        <AssistantPanel
          projectId={projectId}
          provider={config.assistantProvider}
          onChanged={reload}
          onOpenImport={() => setShowImport(true)}
          onClose={() => setShowAssistant(false)}
        />
      )}
      {showImport && <ImportPanel config={config} user={user} data={data} onClose={() => setShowImport(false)} onImported={reload} />}
    </div>
  );
}

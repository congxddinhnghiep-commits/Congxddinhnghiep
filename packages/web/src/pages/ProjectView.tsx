import { useCallback, useEffect, useState } from 'react';
import { api, downloadExcel, type AppConfig, type EstimateResponse, type User, type WorkPackageDTO } from '../api';
import { AnalysisTab } from '../components/AnalysisTab';
import { AssistantPanel } from '../components/AssistantPanel';
import { RegionalUpdateDialog } from '../components/RegionalUpdateDialog';
import { CostSummaryTab } from '../components/CostSummaryTab';
import { EstimateGrid } from '../components/EstimateGrid';
import { ImportPanel } from '../components/ImportPanel';
import { MultiSheetImport } from '../components/MultiSheetImport';
import { PricesTab } from '../components/PricesTab';
import { ProjectSummaryTab } from '../components/ProjectSummaryTab';
import { ResourceSummaryTab } from '../components/ResourceSummaryTab';
import { SettingsTab } from '../components/SettingsTab';
import { TakeoffTab } from '../components/TakeoffTab';
import { ValidationTab } from '../components/ValidationTab';
import { WorkPackagesSidebar } from '../components/WorkPackagesSidebar';
import { money } from '../format';

const TABS = [
  ['project-summary', 'Tổng hợp dự án'],
  ['estimate', 'Dự toán chi tiết'],
  ['takeoff', 'Bóc khối lượng'],
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
  const [workPackages, setWorkPackages] = useState<WorkPackageDTO[]>([]);
  const [packageTotals, setPackageTotals] = useState<Record<number, number>>({});
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('estimate');
  const [showAssistant, setShowAssistant] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [editImportCat, setEditImportCat] = useState<number | undefined>(undefined);
  const [reimportCat, setReimportCat] = useState<number | undefined>(undefined);
  const [showMultiImport, setShowMultiImport] = useState(false);
  const [showRegional, setShowRegional] = useState(false);
  const [newBooks, setNewBooks] = useState(0);
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(false);

  const reload = useCallback(async () => {
    try {
      const wps = await api.workPackages(projectId);
      setWorkPackages(wps);
      const activeId = selectedPackageId && wps.some((w) => w.id === selectedPackageId) ? selectedPackageId : wps[0]?.id ?? null;
      setSelectedPackageId(activeId);
      setData(await api.estimate(projectId, activeId ?? undefined));
      api
        .projectSummary(projectId)
        .then((s) => setPackageTotals(Object.fromEntries(s.packages.map((p) => [p.workPackage.id, p.value]))))
        .catch(() => undefined);
    } catch (e) {
      setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const selectPackage = useCallback(
    async (id: number) => {
      setSelectedPackageId(id);
      setTab((t) => (t === 'project-summary' ? 'estimate' : t));
      try {
        setData(await api.estimate(projectId, id));
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [projectId],
  );

  const refreshBadge = useCallback(() => {
    api
      .priceUpdateStatus(projectId)
      .then((s) => setNewBooks(s.enabled ? s.count : 0))
      .catch(() => undefined);
  }, [projectId]);

  useEffect(() => {
    reload().then(refreshBadge);
  }, [reload, refreshBadge]);

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
      <WorkPackagesSidebar projectId={projectId} packages={workPackages} totals={packageTotals} selectedId={selectedPackageId} onSelect={selectPackage} onChanged={reload} />
      <main className="project-main">
        <div className="page-head">
          <button className="link" onClick={onBack}>
            ← Công trình
          </button>
          <h2 title={data.project.name}>
            {data.project.name}
            {data.workPackage && <span className="wp-current"> · {data.workPackage.name}</span>}
          </h2>
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
          <button data-testid="open-multi-import" onClick={() => setShowMultiImport(true)} title="Mỗi sheet thành một hạng mục công trình riêng (có thể nhiều bảng/khối trong một sheet)">
            ⤓ Nhập từ Excel
          </button>
          <button onClick={() => setShowImport(true)} title="Nhập 1 sheet, tự chọn cột (dùng khi tự nhận diện chưa đúng)">
            ⤓ Nhập dữ liệu (chọn cột tay)
          </button>
          <button data-testid="open-regional" onClick={() => setShowRegional(true)} title="Chọn tỉnh/thành, kỳ giá, xem trước rồi áp dụng">
            Cập nhật định mức &amp; đơn giá theo khu vực
          </button>
          {newBooks > 0 && (
            <button className="primary" data-testid="new-books-badge" onClick={() => setShowRegional(true)}>
              Có bộ giá mới – Cập nhật?
            </button>
          )}
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
        {notice && (
          <div className="notice" data-testid="notice" onClick={() => setNotice('')}>
            ✓ {notice}
          </div>
        )}
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
          {tab === 'project-summary' && <ProjectSummaryTab projectId={projectId} onSelectPackage={selectPackage} />}
          {tab === 'estimate' && (
            <EstimateGrid
              data={data}
              reload={reload}
              onEditImport={(cid) => { setEditImportCat(cid); setShowImport(true); }}
              onReimportCategory={(cid) => { setReimportCat(cid); setShowImport(true); }}
            />
          )}
          {tab === 'takeoff' && <TakeoffTab projectId={projectId} categories={data.categories.map((c) => ({ id: c.id, name: c.name }))} onPushed={reload} />}
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
          providerLabel={config.assistantLabel}
          providerModel={config.assistantModel}
          onChanged={reload}
          onOpenImport={() => setShowImport(true)}
          onOpenRegional={() => setShowRegional(true)}
          onClose={() => setShowAssistant(false)}
        />
      )}
      {showRegional && (
        <RegionalUpdateDialog
          projectId={projectId}
          config={config}
          initialRegion={data.project.region}
          initialSubArea={data.project.subArea}
          approved={data.project.status === 'approved'}
          autoUpdate={data.project.autoPriceUpdate}
          onClose={() => {
            setShowRegional(false);
            refreshBadge();
          }}
          onApplied={async (m) => {
            setNotice(m);
            await reload();
          }}
        />
      )}
      {showImport && (
        <ImportPanel
          config={config}
          user={user}
          data={data}
          editCategoryId={editImportCat}
          reimportCategoryId={reimportCat}
          workPackageId={selectedPackageId ?? undefined}
          onClose={() => { setShowImport(false); setEditImportCat(undefined); setReimportCat(undefined); }}
          onImported={reload}
        />
      )}
      {showMultiImport && (
        <MultiSheetImport
          projectId={projectId}
          onClose={() => setShowMultiImport(false)}
          onImported={(m) => { setNotice(m); setShowMultiImport(false); reload(); }}
        />
      )}
    </div>
  );
}

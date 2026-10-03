import type {
  Action,
  BuildingType,
  CategoryResult,
  CostSummary,
  ElementParams,
  ElementType,
  Intent,
  LegalDocument,
  LegalSet,
  LegalSetId,
  MixDesign,
  Norm,
  PendingField,
  PriceSourceKind,
  ProjectCostSettings,
  RateTable,
  RebarGroup,
  Reply,
  Resource,
  ResourceSummaryRow,
  TotalEstimateLine,
  UnitCost,
} from '@dutoan/core';

export interface User {
  id: number;
  username: string;
  fullName: string;
  role: 'admin' | 'user';
  mustChangePassword: boolean;
}

export interface Project {
  id: number;
  ownerId: number;
  name: string;
  ownerName: string;
  location: string;
  buildingType: BuildingType;
  priceBaseDate: string;
  vatRate: number;
  costSettings: ProjectCostSettings | null;
  legalSet: LegalSetId;
  priceDate: string | null;
  gxdttTmdt: number | null;
  status: 'draft' | 'approved';
  approvedBy: string | null;
  approvedAt: string | null;
  region: string | null;
  subArea: string | null;
  autoPriceUpdate: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EstimateResponse {
  project: Project;
  workPackage?: WorkPackageDTO | null;
  categories: CategoryResult[];
  total: UnitCost;
  resourceSummary: ResourceSummaryRow[];
  legalSet: { id: LegalSetId; label: string; status: 'current' | 'historical'; normDataset: string; documents: string[] };
  provisionalRates: boolean;
  settings: ProjectCostSettings;
  ratesSource: string;
  costSummary: CostSummary & {
    warnings?: string[];
    Knc?: number;
    Km?: number;
    bracketBase?: { value: number; from: 'tmdt' | 'estimate' };
    rates?: { c: number; tt: number; tl: number; nt: number };
  };
  totalEstimate: { lines: TotalEstimateLine[]; total: number };
  warnings: string[];
  notes: string[];
  priceSources: Record<string, PriceSourceInfo>;
  /** Update 6 E: item id → resolved price_source (current = actually applied, preferred = what priority order picks). */
  itemPriceSources?: Record<number, { current: PriceSourceKind | null; preferred: PriceSourceKind | null; available: { dia_phuong: boolean; ho_so: boolean; chiet_tinh: boolean } }>;
  priceSourcePriority?: PriceSourceKind[];
}

// ---------------------------------------------------------------------------
// Update 6 A — Hạng mục công trình (work packages)
// ---------------------------------------------------------------------------

export interface WorkPackageDTO {
  id: number;
  projectId: number;
  code: string | null;
  name: string;
  nameZh: string | null;
  order: number;
  buildingType: BuildingType | null;
  areaM2: number | null;
  mode: 'bao_gia' | 'du_toan_tt36';
  sourceFile: string | null;
  sourceSheet: string | null;
  note: string | null;
  createdAt: string;
}

export interface ProjectSummaryLineDTO {
  id: number;
  projectId: number;
  label: string;
  kind: 'rate' | 'amount';
  value: number;
  order: number;
  note: string | null;
}

export interface ProjectSummaryDTO {
  packages: { workPackage: WorkPackageDTO; itemCount: number; value: number; unitValue: number | null }[];
  lines: (ProjectSummaryLineDTO & { amount: number })[];
  packagesTotal: number;
  grandTotal: number;
}

export type MixDesignSummary = Pick<MixDesign, 'code' | 'section' | 'spec' | 'kind' | 'grade' | 'page' | 'status'>;

// ---------------------------------------------------------------------------
// Update 5 — Bóc khối lượng theo cấu kiện
// ---------------------------------------------------------------------------

export interface StoryDTO {
  id: number;
  projectId: number;
  name: string;
  heightM: number;
  elevationM: number;
  order: number;
}

export interface GeneratedTaskDTO {
  key: string;
  name: string;
  unit: string;
  formula: string;
  perUnit: number;
  value: number;
  computedValue: number;
  overrideValue: number | null;
  overrideReason: string | null;
  normCode: string;
  codeStatus: '' | 'auto';
  confidence: number | null;
}

export interface TakeoffElementDTO {
  id: number;
  projectId: number;
  categoryId: number | null;
  storyId: number | null;
  type: ElementType;
  name: string;
  count: number;
  params: ElementParams;
  enabled: Record<string, boolean>;
  overrides: Record<string, { value: number; reason?: string | null }>;
  material: string | null;
  note: string | null;
  source: 'manual' | 'excel' | 'etabs';
  sourceRef: string | null;
  order: number;
}

export interface ManualSheetRowDTO {
  id: number;
  projectId: number;
  mode: 'expression' | 'quick';
  drawingName: string;
  category: string;
  expression: string | null;
  quick: { n: number; a: number; l: number; h: number } | null;
  result: number | null;
  targetItemId: number | null;
  order: number;
}

export interface RebarScheduleRowDTO {
  id: number;
  projectId: number;
  elementId: number | null;
  cauKien: string;
  soHieu: string | null;
  shapeCode: string | null;
  lengths: (number | null)[];
  note: string | null;
  diaMm: number;
  chieuDai1ThanhMm: number | null;
  soCauKien: number;
  soThanh1CauKien: number;
  order: number;
  computed: { chieuDai1ThanhMm: number; tongChieuDaiM: number; tongTrongLuongKg: number; group: RebarGroup };
}

export interface PushPlanRowDTO {
  group: { key: string; categoryId: number; storyId: number | null; templateKey: string; name: string; unit: string; quantity: number; normCode: string; codeStatus: '' | 'auto'; confidence: number | null; lines: { description: string; result: number; sourceReference: string }[] };
  existingItemId: number | null;
  kind: 'create' | 'update' | 'unchanged';
  conflict: boolean;
  previousQuantity: number | null;
}

export interface PriceSourceInfo {
  kind: 'manual' | 'book' | 'base';
  label: string;
  bookId?: number;
  quoted?: number;
  sourcePrice?: number;
  transport?: number;
  notes?: string[];
}

export interface PriceBookInfo {
  id: number;
  region: string;
  subArea: string | null;
  issuer: string;
  docNumber: string;
  docDate: string | null;
  periodType: 'month' | 'quarter' | 'year';
  periodYear: number;
  periodValue: number | null;
  periodStart: string;
  periodEnd: string;
  bookType: 'VL' | 'NC' | 'M' | 'TH';
  vat: 'included' | 'excluded' | 'unknown';
  vatRate: number | null;
  delivery: string | null;
  sourceUrl: string | null;
  sourceFile: string | null;
  status: 'draft' | 'verified';
  note: string | null;
  title: string;
  rowCount: number;
  unmatched: number;
  verifiedBy: string | null;
  verifiedAt: string | null;
  jurisdictionAtIssue?: string | null;
  sourceFileUrl?: string | null;
  sourceSha256?: string | null;
  verificationStatus?: 'verified' | 'needs_review' | 'not_verified' | 'superseded';
  transportIncluded?: 'yes' | 'no' | 'unknown';
  workType?: string | null;
}

export interface PriceBookRowInfo {
  id: number;
  resourceCode: string | null;
  rawCode: string | null;
  name: string;
  spec: string | null;
  unit: string;
  price: number;
  subArea: string | null;
  sourceRow: number | null;
  matchStatus: 'matched' | 'unmatched' | 'manual' | 'ignored';
  matchNote: string | null;
}

export interface PriceBookSupplierInfo {
  groupNo: string;
  groupName: string;
  itemNo: string | null;
  supplier: string;
  reference: string | null;
  status: string | null;
}

export interface BookSel {
  bookId: number;
  resourceType: 'VL' | 'NC' | 'M';
  priority: number;
}

export interface SuggestionCandidate {
  code: string;
  name: string;
  unit: string;
  confidence: number;
  why: string;
  unitFactor: number;
}

export interface AutoAssignPlan {
  assign: { itemId: number; line: number; name: string; normCode: string; normName: string; confidence: number; why: string }[];
  below: number;
  review: { itemId: number; line: number; name: string; best: { code: string; confidence: number } | null }[];
}

export type RowType = 'header' | 'category' | 'item' | 'subtotal' | 'note' | 'empty';

export interface CodeCandidateDTO {
  code: string;
  name: string;
  unit: string;
  confidence: number;
  reason: string;
}
export interface CodeResolutionDTO {
  status: 'match' | 'mismatch' | 'propose' | 'suggest' | 'gtt' | 'none';
  label: string;
  rawCode: string;
  code: string | null;
  normName?: string;
  candidates: CodeCandidateDTO[];
  askParams?: string[];
  message: string;
}
export interface ReconciliationDTO {
  items: { excelRow: number; name: string; quantity: number | null; unitPrice: number | null; fileAmount: number | null; computed: number | null; diff: number | null; ok: boolean | null }[];
  subtotals: { excelRow: number; name: string; fileAmount: number; computed: number; diff: number; ok: boolean }[];
  grand: { fileAmount: number | null; computed: number; diff: number | null; ok: boolean | null };
  allOk: boolean;
}

export interface RegionalUpdateBody {
  region: string;
  subArea?: string | null;
  auto?: boolean;
  period?: { type: 'month' | 'quarter'; year: number; value: number } | null;
  types?: ('VL' | 'NC' | 'M')[];
  remapCodes?: boolean;
  codeChoices?: Record<string, string | null>;
}
export interface RegionalPreview {
  region: string;
  subArea: string | null;
  projectStatus: 'draft' | 'approved';
  canApply: boolean;
  books: { id: number; title: string; type: 'VL' | 'NC' | 'M'; status: string; verificationStatus?: string; rowCount: number }[];
  totals: { before: { direct: number; gxdtt: number; gxd: number }; after: { direct: number; gxdtt: number; gxd: number }; delta: { direct: number; gxdtt: number; gxd: number } };
  resources: { code: string; name: string; unit: string; type: 'VL' | 'NC' | 'M'; quantity: number; oldPrice: number; newPrice: number; oldSource: string; newSource: string; delta: number; note: string | null }[];
  unpriced: { code: string; name: string; unit: string; type: 'VL' | 'NC' | 'M'; price: number; source: string }[];
  items: { itemId: number; name: string; normCode: string; oldUnit: number; newUnit: number; delta: number; missingPrices: number; fixed: boolean }[];
  normSet: { dataset: string; label: string; total: number; sample: number; needsReview: number };
  remap: { itemId: number; name: string; normCode: string; unit: string; resolution: CodeResolutionDTO }[];
  warnings: string[];
}
export interface RevisionDTO {
  id: number;
  kind: string;
  description: string;
  createdBy: string;
  createdAt: string;
  totalBefore: number | null;
  totalAfter: number | null;
  undone: boolean;
}

export interface Analysis {
  fileId: string;
  fileName: string;
  kind: 'estimate' | 'pricebook';
  sheets: { index: number; name: string; rowCount: number; kind: string; kindLabel: string; detected: boolean }[];
  sheetIndex: number;
  preview: (string | number | null)[][];
  header: { headerRow: number; headerRows: 1 | 2; labels: string[]; mapping: Record<string, number>; confidence: number } | null;
  fingerprint: string | null;
  template: { id: number; name: string } | null;
  rows: {
    index: number;
    excelRow: number;
    type: RowType;
    stt: string;
    code: string;
    name: string;
    unit: string;
    quantity: number | null;
    category: string | null;
    warnings: string[];
    codeKnown?: boolean;
    normalizedCode?: string;
    pricingMethod?: string | null;
    rawName?: string | null;
    flags?: string[];
    suggestion?: { code: string; name: string; confidence: number; why: string } | null;
    amount: number | null;
    prices: { vl: number | null; nc: number | null; m: number | null; unit: number | null };
    fileUnitPrice?: number | null;
    computedAmount?: number | null;
    normUnit?: number | null;
    amountMode?: 'file' | 'calc' | null;
    appliedAmount?: number | null;
    cells?: Record<string, string>;
    resolution?: CodeResolutionDTO;
  }[];
  columns: { index: number; letter: string; header: string; samples: string[]; label: string; hidden?: boolean }[];
  gridPreview: { excelRow: number; type: string; stt: string; code: string; name: string; unit: string; quantity: number | null; unitPrice: number | null; amount: number | null; nameIsNumeric: boolean; amountMode?: 'file' | 'calc' | null }[];
  columnWarnings: { field: string; column: number; letter: string; message: string; blocking: boolean }[];
  detectionNotes: string[];
  zeroAmountRows: number[];
  range: { first: number; last: number };
  reconciliation: ReconciliationDTO | null;
  pricingOption: 'file' | 'norm';
  counts: Partial<Record<RowType, number>>;
  fields: { key: string; label: string }[];
  rowTypeLabels: Record<RowType, string>;
  warnings: string[];
  encoding?: string;
  sha256?: string | null;
}

// ---------------- Update 4 A-bis: multi-sheet import ----------------
export interface SheetOverviewDTO {
  index: number;
  name: string;
  label: string;
  hidden: boolean;
  rowCount: number;
  blocks: number;
  summary: boolean;
  importable: boolean;
  defaultPackageName: string;
  defaultPackageNameZh: string | null;
}

/** Update 6 B: where a sheet's blocks go – a new hạng mục công trình (editable name), or an existing one. */
export interface SheetTargetDTO {
  sheetIndex: number;
  mode: 'new' | 'replace' | 'add';
  name?: string;
  nameZh?: string | null;
  workPackageId?: number;
  splitBlocks?: boolean;
}
export interface BlockPreviewRowDTO {
  excelRow: number;
  type: string;
  stt: string;
  code: string;
  name: string;
  unit: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  nameIsNumeric: boolean;
  nameZh: string | null;
  details: number;
  tbvt: boolean;
  unpriced: boolean;
  amountMode: 'file' | 'calc' | null;
}
export interface BlockPlanDTO {
  key: string;
  sheetIndex: number;
  sheetName: string;
  blockIndex: number;
  blockCount: number;
  title: string;
  prefix: string;
  headerRow: number;
  first: number;
  last: number;
  mep: boolean;
  mapping: { field: string; label: string; letter: string; header: string }[];
  items: number;
  details: number;
  categories: string[];
  unpriced: number;
  missingUnit: number;
  tbvt: number;
  fileTotal: number | null;
  computedTotal: number;
  total: number;
  diff: number | null;
  ok: boolean | null;
  warnings: string[];
  blocking: string | null;
  preview: BlockPreviewRowDTO[];
}
export interface SummaryLineDTO {
  row: number;
  stt: string;
  label: string;
  amount: number | null;
  kind: 'line' | 'total' | 'tax';
}
export interface SummaryDTO {
  sheetIndex: number;
  sheetName: string;
  lines: SummaryLineDTO[];
  total: SummaryLineDTO | null;
  matches: { line: SummaryLineDTO; matched: { kind: 'block' | 'sheet'; label: string; amount: number } | null; ok: boolean | null }[];
  totalCheck: { file: number; computed: number; diff: number; ok: boolean } | null;
}
export interface AnalyzeMultiResult {
  fileId: string;
  fileName: string;
  sheets: SheetOverviewDTO[];
  selected: number[];
  blocks: BlockPlanDTO[];
  skipped: { sheetIndex: number; sheetName: string; blockIndex: number; reason: string }[];
  summary: SummaryDTO | null;
  grand: { computed: number; total: number };
  allOk: boolean;
}
export interface ImportSheetsResult {
  created: number;
  categories: number;
  blocks: { sheetName: string; title: string; prefix: string; created: number; categories: number; importId: number; workPackageId: number }[];
  withCode: number;
  withoutCode: number;
  tbvt: number;
  itemIds: number[];
  workPackageIds: number[];
  summarySaved: boolean;
  allOk: boolean;
  message: string;
}

export interface QuantityLineDTO {
  id?: number;
  description: string;
  expression: string;
  variables?: Record<string, number>;
  variablesText?: string;
  sign: 1 | -1;
  unit: string | null;
  result?: number | null;
  factor?: number | null;
  raw?: number | null;
  error?: string | null;
  warnings?: string[];
}

export interface TransportLegDTO {
  id?: number;
  fromLocation: string;
  toLocation: string;
  roadClass?: string | null;
  distance: number;
  freightRate: number;
  loadFactor: number;
  weightFactor: number;
  handling: number;
  toll: number;
  note?: string | null;
  amount?: number;
}

export interface ValidationReport {
  generatedAt: string;
  project: { id: number; name: string; legalSet: string; priceDate: string | null };
  counts: { error: number; warning: number; info: number };
  checks: {
    id: string;
    title: string;
    rule: string;
    status: 'pass' | 'warning' | 'fail';
    findings: { severity: 'error' | 'warning' | 'info'; message: string; itemId?: number; line?: number; category?: string; code?: string }[];
  }[];
  /** Update 6 E.2: count + value per price_source kind, never mixed silently. */
  priceSourceSummary: { kind: string; count: number; value: number }[];
}

export interface PricingDTO {
  pricingMethod: 'NORM_BASED' | 'CUSTOM_GTT' | 'MARKET_QUOTE';
  custom?: { vl?: number; nc?: number; m?: number } | null;
  priceSource?: string | null;
  quote?: { supplier?: string | null; number?: string | null; date?: string | null; validUntil?: string | null; vatStatus?: string | null; vatRate?: number | null } | null;
}

export interface LegalRegister {
  checkedAt: string;
  note: string;
  documents: LegalDocument[];
  sets: LegalSet[];
}

export interface AiProviderStatus {
  id: 'openai' | 'anthropic';
  label: string;
  hasKey: boolean;
  envKey: string;
  model: string;
  defaultModel: string;
  status: 'Đã kết nối' | 'Chưa có khóa API';
  detail: string;
  tested: boolean | null;
}
export interface AiStatus {
  requested: 'openai' | 'anthropic' | 'offline' | 'auto';
  active: 'openai' | 'anthropic' | 'offline';
  activeLabel: string;
  activeModel: string | null;
  fellBack: boolean;
  providers: AiProviderStatus[];
}

export interface AppConfig {
  localMode: boolean;
  sampleData: boolean;
  googleDrive: { configured: boolean; clientId: string; apiKey: string; appId: string };
  buildingTypes: Record<BuildingType, string>;
  legalSets: LegalSet[];
  tt36WorkCategories: Record<string, string>;
  regions: string[];
  assistantProvider: string;
  assistantLabel: string;
  assistantModel: string | null;
}

export interface PriceRow extends Resource {
  isSample: boolean;
  projectPrice: number | null;
  effectivePrice: number;
  source: PriceSourceInfo | null;
  used: boolean;
}

export type ImportTarget = 'norms' | 'prices' | 'items' | 'estimate';
export interface ImportPreview {
  fileId: string;
  fileName: string;
  sheets: { name: string; rowCount: number }[];
  sheetIndex: number;
  headerRow: number;
  headers: (string | number | null)[];
  rows: (string | number | null)[][];
  mapping: Record<string, number>;
  fields: Record<ImportTarget, { key: string; label: string; required?: boolean }[]>;
}

const TOKEN_KEY = 'dutoan.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(t: string | null): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${url}`, { method, headers, body: payload });
  if (res.status === 401 && !url.startsWith('/auth/login')) onUnauthorized?.();
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Lỗi ${res.status}`);
  return data as T;
}

export const api = {
  login: (username: string, password: string) => request<{ token: string; user: User }>('POST', '/auth/login', { username, password }),
  me: () => request<User>('GET', '/auth/me'),
  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ token: string; user: User }>('POST', '/auth/change-password', { oldPassword, newPassword }),
  config: () => request<AppConfig>('GET', '/config'),
  users: () => request<User[]>('GET', '/users'),
  createUser: (u: { username: string; password: string; fullName: string; role: string }) => request<User>('POST', '/users', u),

  projects: () => request<Project[]>('GET', '/projects'),
  createProject: (p: Partial<Project>) => request<Project>('POST', '/projects', p),
  updateProject: (id: number, p: Partial<Project> & { confirmLegalSetChange?: boolean }) => request<Project>('PUT', `/projects/${id}`, p),
  deleteProject: (id: number) => request('DELETE', `/projects/${id}`),
  copyProject: (id: number) => request<Project>('POST', `/projects/${id}/copy`),
  saveSettings: (id: number, costSettings: ProjectCostSettings, vatRate: number) =>
    request<Project>('PUT', `/projects/${id}/settings`, { costSettings, vatRate }),
  estimate: (id: number, workPackageId?: number) =>
    request<EstimateResponse>('GET', workPackageId ? `/projects/${id}/work-packages/${workPackageId}/estimate` : `/projects/${id}/estimate`),

  createCategory: (pid: number, name: string, workPackageId?: number) => request<{ id: number }>('POST', `/projects/${pid}/categories`, { name, workPackageId }),
  updateCategory: (pid: number, cid: number, data: { name?: string; order?: number; ttRate?: number | null }) => request('PUT', `/projects/${pid}/categories/${cid}`, data),
  deleteCategory: (pid: number, cid: number) => request('DELETE', `/projects/${pid}/categories/${cid}`),
  moveCategory: (pid: number, cid: number, workPackageId: number) => request('POST', `/projects/${pid}/categories/${cid}/move`, { workPackageId }),

  // Update 6 A — work packages ("Hạng mục công trình")
  workPackages: (pid: number) => request<WorkPackageDTO[]>('GET', `/projects/${pid}/work-packages`),
  createWorkPackage: (pid: number, data: Partial<WorkPackageDTO>) => request<WorkPackageDTO>('POST', `/projects/${pid}/work-packages`, data),
  updateWorkPackage: (pid: number, wpId: number, data: Partial<WorkPackageDTO>) => request<WorkPackageDTO>('PUT', `/projects/${pid}/work-packages/${wpId}`, data),
  duplicateWorkPackage: (pid: number, wpId: number, name?: string) => request<WorkPackageDTO>('POST', `/projects/${pid}/work-packages/${wpId}/duplicate`, { name }),
  deleteWorkPackage: (pid: number, wpId: number, confirm = false) =>
    request<{ deleted: boolean; undo: unknown }>('DELETE', `/projects/${pid}/work-packages/${wpId}${confirm ? '?confirm=1' : ''}`),
  restoreWorkPackage: (pid: number, snapshot: unknown) => request('POST', `/projects/${pid}/work-packages/restore`, snapshot as Record<string, unknown>),
  projectSummary: (pid: number) => request<ProjectSummaryDTO>('GET', `/projects/${pid}/summary`),
  createSummaryLine: (pid: number, data: { label: string; kind?: 'rate' | 'amount'; value?: number; note?: string | null }) =>
    request<ProjectSummaryLineDTO>('POST', `/projects/${pid}/summary-lines`, data),
  updateSummaryLine: (pid: number, lineId: number, data: Partial<ProjectSummaryLineDTO>) => request('PUT', `/projects/${pid}/summary-lines/${lineId}`, data),
  deleteSummaryLine: (pid: number, lineId: number) => request('DELETE', `/projects/${pid}/summary-lines/${lineId}`),

  createItem: (pid: number, data: Record<string, unknown>) => request('POST', `/projects/${pid}/items`, data),
  updateItem: (pid: number, itemId: number, data: Record<string, unknown>) => request('PUT', `/projects/${pid}/items/${itemId}`, data),
  deleteItem: (pid: number, itemId: number) => request('DELETE', `/projects/${pid}/items/${itemId}`),

  suggestions: (pid: number) => request<{ itemId: number; candidates: SuggestionCandidate[] }[]>('GET', `/projects/${pid}/suggestions`),
  autoAssignPreview: (pid: number, threshold: number) => request<AutoAssignPlan>('POST', `/projects/${pid}/auto-assign/preview`, { threshold }),
  autoAssign: (pid: number, assignments: AutoAssignPlan['assign']) => request<{ text: string }>('POST', `/projects/${pid}/auto-assign`, { assignments }),
  assignCode: (pid: number, itemId: number, normCode: string) => request('POST', `/projects/${pid}/items/${itemId}/assign-code`, { normCode }),
  confirmCode: (pid: number, itemId: number) => request('POST', `/projects/${pid}/items/${itemId}/confirm-code`),
  confirmCodes: (pid: number, itemIds: number[]) => request<{ confirmed: number }>('POST', `/projects/${pid}/confirm-codes`, { itemIds }),
  approve: (pid: number) => request<Project>('POST', `/projects/${pid}/approve`),
  unapprove: (pid: number) => request<Project>('POST', `/projects/${pid}/unapprove`),

  priceBooks: (q: { region?: string; type?: string } = {}) =>
    request<PriceBookInfo[]>('GET', `/price-books?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString()}`),
  priceBook: (bid: number) => request<PriceBookInfo & { rows: PriceBookRowInfo[]; suppliers: PriceBookSupplierInfo[] }>('GET', `/price-books/${bid}`),
  createPriceBook: (b: Partial<PriceBookInfo>) => request<PriceBookInfo>('POST', '/price-books', b),
  updatePriceBook: (bid: number, b: Partial<PriceBookInfo>) => request<PriceBookInfo>('PUT', `/price-books/${bid}`, b),
  deletePriceBook: (bid: number) => request('DELETE', `/price-books/${bid}`),
  setPriceBookStatus: (bid: number, status: 'draft' | 'verified' | 'needs_review' | 'not_verified' | 'superseded') => request<PriceBookInfo>('POST', `/price-books/${bid}/status`, { status }),
  importPriceBook: (bid: number, body: Record<string, unknown>) =>
    request<{ imported: number; matched: number; unmatched: number; message: string }>('POST', `/price-books/${bid}/import`, body),
  matchPriceRow: (bid: number, rid: number, body: { resourceCode?: string | null; ignore?: boolean }) => request('PUT', `/price-books/${bid}/rows/${rid}`, body),
  priceHistory: (code: string) =>
    request<{ resource: Resource; points: { bookId: number; title: string; region: string; subArea: string | null; periodStart: string; vat: string; status: string; unit: string; price: number }[] }>(
      'GET',
      `/resources/${encodeURIComponent(code)}/price-history`,
    ),
  projectPriceBooks: (pid: number) =>
    request<{ selection: BookSel[]; proposals: { region: string | null; subArea: string | null; priceDate: string | null; books: PriceBookInfo[] }; books: PriceBookInfo[] }>(
      'GET',
      `/projects/${pid}/price-books`,
    ),
  saveProjectPriceBooks: (pid: number, selection: BookSel[]) => request('PUT', `/projects/${pid}/price-books`, { selection }),
  previewPriceBooks: (pid: number, selection: BookSel[]) =>
    request<{
      rows: { code: string; name: string; unit: string; type: string; quantity: number; oldPrice: number; newPrice: number; oldSource: string; newSource: string; delta: number }[];
      totalDelta: number;
    }>('POST', `/projects/${pid}/price-books/preview`, { selection }),
  quantityLines: (pid: number, itemId: number) => request<QuantityLineDTO[]>('GET', `/projects/${pid}/items/${itemId}/quantity-lines`),
  saveQuantityLines: (pid: number, itemId: number, lines: QuantityLineDTO[]) =>
    request<{ total: number; lines: QuantityLineDTO[] }>('PUT', `/projects/${pid}/items/${itemId}/quantity-lines`, { lines }),
  evaluateQuantity: (lines: QuantityLineDTO[], itemUnit: string) =>
    request<{ total: number; lines: QuantityLineDTO[]; errors: number }>('POST', '/quantity/evaluate', { lines, itemUnit }),
  setPricing: (pid: number, itemId: number, body: PricingDTO) => request('PUT', `/projects/${pid}/items/${itemId}/pricing`, body),
  setAmountMode: (pid: number, itemId: number, mode: 'file' | 'calc') => request('PUT', `/projects/${pid}/items/${itemId}/amount-mode`, { mode }),
  mixDesigns: (params: { kind?: string; grade?: string; q?: string } = {}) =>
    request<MixDesignSummary[]>('GET', `/mix-designs?${new URLSearchParams(params as Record<string, string>).toString()}`),
  mixDesign: (code: string) => request<MixDesign>('GET', `/mix-designs/${encodeURIComponent(code)}`),
  setMix: (pid: number, itemId: number, mixCode: string | null) => request('PUT', `/projects/${pid}/items/${itemId}/mix`, { mixCode }),

  // Update 6 E — price sources ("Nguồn giá")
  priceSourcePriority: (pid: number) => request<PriceSourceKind[]>('GET', `/projects/${pid}/price-source-priority`),
  setPriceSourcePriority: (pid: number, order: PriceSourceKind[]) => request<PriceSourceKind[]>('PUT', `/projects/${pid}/price-source-priority`, { order }),
  setPriceSourceOverride: (pid: number, itemId: number, kind: PriceSourceKind | null) => request('PUT', `/projects/${pid}/items/${itemId}/price-source-override`, { kind }),
  applyPriceSourceKind: (pid: number, itemId: number, kind: PriceSourceKind) => request('PUT', `/projects/${pid}/items/${itemId}/price-source-apply`, { kind }),
  previewApplyPriceSourcePriority: (pid: number) =>
    request<{ changes: { itemId: number; name: string; from: { kind: PriceSourceKind | null; price: number }; to: { kind: PriceSourceKind; price: number } }[] }>(
      'GET',
      `/projects/${pid}/price-source-apply/preview`,
    ),
  applyPriceSourcePriority: (pid: number) => request<{ revisionId: number | null; changed: number }>('POST', `/projects/${pid}/price-source-apply`),
  chietTinhSheet: (pid: number, itemId: number) =>
    request<{
      item: { id: number; name: string; normCode: string; unit: string; quantity: number; note: string | null; chietTinhSpec: string | null };
      norm: { code: string; name: string; unit: string };
      resources: { resourceCode: string; name: string; unit: string; type: string; consumption: number; pctBase: string | null; price: number; source: { kind: string; label: string }; amount: number; missing: boolean }[];
      unitCost: UnitCost;
      missingResources: string[];
      flagged: boolean;
    }>('GET', `/projects/${pid}/items/${itemId}/chiet-tinh`),
  setChietTinhSpec: (pid: number, itemId: number, spec: string | null) => request('PUT', `/projects/${pid}/items/${itemId}/chiet-tinh-spec`, { spec }),
  workPackageModePreview: (pid: number, wpId: number, mode: 'bao_gia' | 'du_toan_tt36') =>
    request<{ before: { mode: string; total: number }; after: { mode: string; total: number } }>('GET', `/projects/${pid}/work-packages/${wpId}/mode-preview?mode=${mode}`),
  transport: (pid: number) => request<Record<string, TransportLegDTO[]>>('GET', `/projects/${pid}/transport`),
  saveTransport: (pid: number, code: string, legs: TransportLegDTO[]) => request<TransportLegDTO[]>('PUT', `/projects/${pid}/transport/${encodeURIComponent(code)}`, { legs }),
  validation: (pid: number) => request<ValidationReport>('GET', `/projects/${pid}/validation`),
  priceBookRecords: (bid: number) => request<Record<string, unknown>[]>('GET', `/price-books/${bid}/records`),
  provinceMergers: () => request<{ effectiveDate: string; source: string; mergers: { successor: string; predecessors: string[] }[] }>('GET', '/province-mergers'),
  searchResources: (q: string) => request<Resource[]>('GET', `/resources?q=${encodeURIComponent(q)}`),

  prices: (pid: number, all: boolean) => request<PriceRow[]>('GET', `/projects/${pid}/prices${all ? '?all=1' : ''}`),
  setPrice: (pid: number, code: string, price: number | null) => request('PUT', `/projects/${pid}/prices/${encodeURIComponent(code)}`, { price }),

  searchNorms: (q: string, dataset: string) => request<Norm[]>('GET', `/norms?q=${encodeURIComponent(q)}&dataset=${encodeURIComponent(dataset)}&limit=100`),
  norm: (code: string, dataset: string) =>
    request<Norm & { resources: (Resource & { consumption: number })[] }>('GET', `/norms/${encodeURIComponent(code)}?dataset=${encodeURIComponent(dataset)}`),

  legal: () => request<LegalRegister>('GET', '/legal'),
  setRateTable: (setId: LegalSetId, tableId: string, patch: { status?: 'verified' | 'provisional'; interpolation?: 'none' | 'linear' }) =>
    request<RateTable>('PUT', `/legal/${setId}/tables/${encodeURIComponent(tableId)}`, patch),

  assistant: (pid: number, body: { text?: string; intent?: Intent; pending?: PendingField; history?: { role: 'user' | 'assistant'; text: string }[] }) => request<Reply>('POST', `/projects/${pid}/assistant`, body),
  aiStatus: () => request<AiStatus>('GET', '/ai/status'),
  aiSaveSettings: (body: { provider?: string; models?: Record<string, string> }) => request<AiStatus>('PUT', '/ai/settings', body),
  aiTest: (provider: 'openai' | 'anthropic') => request<{ ok: boolean; model?: string; latencyMs?: number; code?: string; message: string; status: AiStatus }>('POST', '/ai/test', { provider }),
  confirmAction: (pid: number, action: Action, description: string) =>
    request<{ text: string }>('POST', `/projects/${pid}/assistant/confirm`, { action, description }),
  undo: (pid: number) => request<{ text: string }>('POST', `/projects/${pid}/assistant/undo`),

  importUpload: (form: FormData) => request<ImportPreview>('POST', '/import/upload', form),
  importPath: (path: string, target: ImportTarget) => request<ImportPreview>('POST', '/import/upload', { path, target }),
  importDrive: (body: { fileId: string; accessToken: string; mimeType: string; name: string; target: ImportTarget }) =>
    request<ImportPreview>('POST', '/import/gdrive', body),
  regionalPreview: (pid: number, body: RegionalUpdateBody) => request<RegionalPreview>('POST', `/projects/${pid}/regional-update/preview`, body),
  regionalApply: (pid: number, body: RegionalUpdateBody) => request<{ revisionId: number; applied: { resources: number; items: number; codes: number } }>('POST', `/projects/${pid}/regional-update/apply`, body),
  revisions: (pid: number) => request<RevisionDTO[]>('GET', `/projects/${pid}/revisions`),
  undoRevision: (pid: number, rid: number) => request('POST', `/projects/${pid}/revisions/${rid}/undo`),
  priceUpdateStatus: (pid: number) => request<{ enabled: boolean; count: number; books: { id: number; title: string; type: string }[] }>('GET', `/projects/${pid}/price-update-status`),
  setAutoPriceUpdate: (pid: number, enabled: boolean) => request('PUT', `/projects/${pid}/auto-price-update`, { enabled }),
  importAnalyze: (body: Record<string, unknown>) => request<Analysis>('POST', '/import/analyze', body),
  importEstimate: (pid: number, body: Record<string, unknown>) =>
    request<{ created: number; withCode: number; withoutCode: number; categories: number; skipped: number; message: string; revisionId: number | null; importId: number; zeroAmount: number }>('POST', `/projects/${pid}/import-estimate`, body),
  importInfo: (pid: number, cid: number) =>
    request<{ imported: false } | { imported: true; hasRaw: boolean; importId: number | null; fileName: string; sheetName: string | null; itemCount: number; createdAt?: string }>('GET', `/projects/${pid}/categories/${cid}/import-info`),
  importReopen: (pid: number, importId: number) => request<Analysis>('POST', `/projects/${pid}/imports/${importId}/reopen`),
  importPreview: (fileId: string, sheetIndex: number, target: ImportTarget) =>
    request<ImportPreview>('POST', '/import/preview', { fileId, sheetIndex, target }),
  importApply: (body: Record<string, unknown>) => request<{ message: string; count: number }>('POST', '/import/apply', body),
  importAnalyzeMulti: (body: { fileId: string; projectId: number; sheetIndexes?: number[]; pricingOption?: 'file' | 'norm'; equipmentAsQuote?: boolean; amountFidelity?: 'file' | 'calc' }) =>
    request<AnalyzeMultiResult>('POST', '/import/analyze-multi', body),
  importSheets: (
    pid: number,
    body: { fileId: string; sheetIndexes?: number[]; pricingOption?: 'file' | 'norm'; equipmentAsQuote?: boolean; amountFidelity?: 'file' | 'calc'; autoAssignThreshold?: number; targets?: SheetTargetDTO[] },
  ) => request<ImportSheetsResult>('POST', `/projects/${pid}/import-sheets`, body),

  // Update 5 — Bóc khối lượng theo cấu kiện
  elementTypes: () => request<{ labels: Record<ElementType, string>; defaults: Record<ElementType, ElementParams> }>('GET', '/takeoff/element-types'),
  stories: (pid: number) => request<StoryDTO[]>('GET', `/projects/${pid}/stories`),
  createStory: (pid: number, body: { name: string; heightM?: number; elevationM?: number }) => request<StoryDTO>('POST', `/projects/${pid}/stories`, body),
  updateStory: (pid: number, sid: number, body: Partial<{ name: string; heightM: number; elevationM: number; order: number }>) => request<StoryDTO>('PUT', `/projects/${pid}/stories/${sid}`, body),
  deleteStory: (pid: number, sid: number) => request('DELETE', `/projects/${pid}/stories/${sid}`),

  takeoffElements: (pid: number) => request<{ element: TakeoffElementDTO; tasks: GeneratedTaskDTO[] }[]>('GET', `/projects/${pid}/takeoff/elements`),
  createElement: (pid: number, body: { type: ElementType; name: string; count?: number; categoryId?: number | null; storyId?: number | null; params?: ElementParams; material?: string | null; note?: string | null }) =>
    request<{ element: TakeoffElementDTO; tasks: GeneratedTaskDTO[] }>('POST', `/projects/${pid}/takeoff/elements`, body),
  updateElement: (
    pid: number,
    eid: number,
    body: Partial<{ name: string; count: number; categoryId: number | null; storyId: number | null; params: ElementParams; enabled: Record<string, boolean>; overrides: Record<string, { value: number; reason?: string | null }>; material: string | null; note: string | null; order: number }>,
  ) => request<{ element: TakeoffElementDTO; tasks: GeneratedTaskDTO[] }>('PUT', `/projects/${pid}/takeoff/elements/${eid}`, body),
  deleteElement: (pid: number, eid: number) => request('DELETE', `/projects/${pid}/takeoff/elements/${eid}`),

  manualRows: (pid: number) => request<ManualSheetRowDTO[]>('GET', `/projects/${pid}/takeoff/manual`),
  evalManual: (pid: number, body: { mode: 'expression' | 'quick'; expression?: string; quick?: { n: number; a: number; l: number; h: number }; drawingName?: string; category?: string }) =>
    request<{ result: number; variables: Record<string, number>; quick: { area: number; length: number; volume: number; lateralArea: number } | null; row: ManualSheetRowDTO | null }>('POST', `/projects/${pid}/takeoff/manual/eval`, body),
  saveManual: (pid: number, body: { mode: 'expression' | 'quick'; expression?: string; quick?: { n: number; a: number; l: number; h: number }; drawingName?: string; category?: string }) =>
    request<{ result: number; variables: Record<string, number>; quick: { area: number; length: number; volume: number; lateralArea: number } | null; row: ManualSheetRowDTO | null }>('POST', `/projects/${pid}/takeoff/manual`, body),
  deleteManualRow: (pid: number, rid: number) => request('DELETE', `/projects/${pid}/takeoff/manual/${rid}`),
  sendManualRow: (pid: number, rid: number, itemId: number) => request('POST', `/projects/${pid}/takeoff/manual/${rid}/send`, { itemId }),

  rebarRows: (pid: number) => request<RebarScheduleRowDTO[]>('GET', `/projects/${pid}/takeoff/rebar`),
  rebarSummary: (pid: number) => request<{ type: string; groups: Record<RebarGroup, number> }[]>('GET', `/projects/${pid}/takeoff/rebar/summary`),
  saveRebarRow: (
    pid: number,
    body: { id?: number; elementId?: number | null; cauKien: string; soHieu?: string | null; shapeCode?: string | null; lengths?: (number | null)[]; note?: string | null; diaMm: number; chieuDai1ThanhMm?: number | null; soCauKien: number; soThanh1CauKien: number },
  ) => request<RebarScheduleRowDTO>('PUT', `/projects/${pid}/takeoff/rebar`, body),
  deleteRebarRow: (pid: number, rid: number) => request('DELETE', `/projects/${pid}/takeoff/rebar/${rid}`),

  takeoffPushPreview: (pid: number, body: { elementIds?: number[]; splitByStory?: boolean } = {}) => request<{ rows: PushPlanRowDTO[]; conflicts: number }>('POST', `/projects/${pid}/takeoff/push/preview`, body),
  takeoffPushApply: (pid: number, body: { elementIds?: number[]; splitByStory?: boolean; overwriteKeys?: string[] } = {}) =>
    request<{ created: number; updated: number; skipped: number; conflicts: number; revisionId: number }>('POST', `/projects/${pid}/takeoff/push/apply`, body),
  takeoffUndoPush: (pid: number, revisionId: number) => request('POST', `/projects/${pid}/takeoff/push/${revisionId}/undo`),
};

/** Download the Excel export (needs the auth header, so fetch → blob → link). */
export async function downloadExcel(projectId: number): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/export.xlsx`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiError(res.status, 'Không xuất được file Excel');
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'DuToan.xlsx';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

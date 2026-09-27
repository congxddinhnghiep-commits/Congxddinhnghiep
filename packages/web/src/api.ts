import type {
  Action,
  BuildingType,
  CategoryResult,
  CostSummary,
  Intent,
  LegalDocument,
  LegalSet,
  LegalSetId,
  Norm,
  PendingField,
  ProjectCostSettings,
  RateTable,
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
  createdAt: string;
  updatedAt: string;
}

export interface EstimateResponse {
  project: Project;
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
  }[];
  counts: Partial<Record<RowType, number>>;
  fields: { key: string; label: string }[];
  rowTypeLabels: Record<RowType, string>;
  warnings: string[];
  encoding?: string;
  sha256?: string | null;
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

export interface AppConfig {
  localMode: boolean;
  assistantProvider: string;
  sampleData: boolean;
  googleDrive: { configured: boolean; clientId: string; apiKey: string; appId: string };
  buildingTypes: Record<BuildingType, string>;
  legalSets: LegalSet[];
  tt36WorkCategories: Record<string, string>;
  regions: string[];
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
  estimate: (id: number) => request<EstimateResponse>('GET', `/projects/${id}/estimate`),

  createCategory: (pid: number, name: string) => request<{ id: number }>('POST', `/projects/${pid}/categories`, { name }),
  updateCategory: (pid: number, cid: number, data: { name?: string; order?: number; ttRate?: number | null }) => request('PUT', `/projects/${pid}/categories/${cid}`, data),
  deleteCategory: (pid: number, cid: number) => request('DELETE', `/projects/${pid}/categories/${cid}`),

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
  priceBook: (bid: number) => request<PriceBookInfo & { rows: PriceBookRowInfo[] }>('GET', `/price-books/${bid}`),
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

  assistant: (pid: number, body: { text?: string; intent?: Intent; pending?: PendingField }) => request<Reply>('POST', `/projects/${pid}/assistant`, body),
  confirmAction: (pid: number, action: Action, description: string) =>
    request<{ text: string }>('POST', `/projects/${pid}/assistant/confirm`, { action, description }),
  undo: (pid: number) => request<{ text: string }>('POST', `/projects/${pid}/assistant/undo`),

  importUpload: (form: FormData) => request<ImportPreview>('POST', '/import/upload', form),
  importPath: (path: string, target: ImportTarget) => request<ImportPreview>('POST', '/import/upload', { path, target }),
  importDrive: (body: { fileId: string; accessToken: string; mimeType: string; name: string; target: ImportTarget }) =>
    request<ImportPreview>('POST', '/import/gdrive', body),
  importAnalyze: (body: Record<string, unknown>) => request<Analysis>('POST', '/import/analyze', body),
  importEstimate: (pid: number, body: Record<string, unknown>) =>
    request<{ created: number; withCode: number; withoutCode: number; categories: number; skipped: number; message: string }>('POST', `/projects/${pid}/import-estimate`, body),
  importPreview: (fileId: string, sheetIndex: number, target: ImportTarget) =>
    request<ImportPreview>('POST', '/import/preview', { fileId, sheetIndex, target }),
  importApply: (body: Record<string, unknown>) => request<{ message: string; count: number }>('POST', '/import/apply', body),
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

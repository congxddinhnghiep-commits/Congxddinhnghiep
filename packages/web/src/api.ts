import type {
  Action,
  BuildingType,
  CategoryResult,
  CostSettings,
  CostSummary,
  Intent,
  Norm,
  PendingField,
  RatesTable,
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
  costSettings: Partial<CostSettings> | null;
  createdAt: string;
  updatedAt: string;
}

export interface EstimateResponse {
  project: Project;
  categories: CategoryResult[];
  total: UnitCost;
  resourceSummary: ResourceSummaryRow[];
  settings: CostSettings;
  ratesSource: string;
  costSummary: CostSummary;
  totalEstimate: { lines: TotalEstimateLine[]; total: number };
}

export interface AppConfig {
  localMode: boolean;
  assistantProvider: string;
  sampleData: boolean;
  googleDrive: { configured: boolean; clientId: string; apiKey: string; appId: string };
  buildingTypes: Record<BuildingType, string>;
  rates: RatesTable;
}

export interface PriceRow extends Resource {
  isSample: boolean;
  projectPrice: number | null;
  used: boolean;
}

export type ImportTarget = 'norms' | 'prices' | 'items';
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
  updateProject: (id: number, p: Partial<Project>) => request<Project>('PUT', `/projects/${id}`, p),
  deleteProject: (id: number) => request('DELETE', `/projects/${id}`),
  copyProject: (id: number) => request<Project>('POST', `/projects/${id}/copy`),
  saveSettings: (id: number, costSettings: Partial<CostSettings>, vatRate: number) =>
    request<Project>('PUT', `/projects/${id}/settings`, { costSettings, vatRate }),
  estimate: (id: number) => request<EstimateResponse>('GET', `/projects/${id}/estimate`),

  createCategory: (pid: number, name: string) => request<{ id: number }>('POST', `/projects/${pid}/categories`, { name }),
  updateCategory: (pid: number, cid: number, data: { name?: string; order?: number }) => request('PUT', `/projects/${pid}/categories/${cid}`, data),
  deleteCategory: (pid: number, cid: number) => request('DELETE', `/projects/${pid}/categories/${cid}`),

  createItem: (pid: number, data: Record<string, unknown>) => request('POST', `/projects/${pid}/items`, data),
  updateItem: (pid: number, itemId: number, data: Record<string, unknown>) => request('PUT', `/projects/${pid}/items/${itemId}`, data),
  deleteItem: (pid: number, itemId: number) => request('DELETE', `/projects/${pid}/items/${itemId}`),

  prices: (pid: number, all: boolean) => request<PriceRow[]>('GET', `/projects/${pid}/prices${all ? '?all=1' : ''}`),
  setPrice: (pid: number, code: string, price: number | null) => request('PUT', `/projects/${pid}/prices/${encodeURIComponent(code)}`, { price }),

  searchNorms: (q: string) => request<Norm[]>('GET', `/norms?q=${encodeURIComponent(q)}&limit=100`),
  norm: (code: string) => request<Norm & { resources: (Resource & { consumption: number })[] }>('GET', `/norms/${encodeURIComponent(code)}`),

  assistant: (pid: number, body: { text?: string; intent?: Intent; pending?: PendingField }) => request<Reply>('POST', `/projects/${pid}/assistant`, body),
  confirmAction: (pid: number, action: Action, description: string) =>
    request<{ text: string }>('POST', `/projects/${pid}/assistant/confirm`, { action, description }),
  undo: (pid: number) => request<{ text: string }>('POST', `/projects/${pid}/assistant/undo`),

  importUpload: (form: FormData) => request<ImportPreview>('POST', '/import/upload', form),
  importPath: (path: string, target: ImportTarget) => request<ImportPreview>('POST', '/import/upload', { path, target }),
  importDrive: (body: { fileId: string; accessToken: string; mimeType: string; name: string; target: ImportTarget }) =>
    request<ImportPreview>('POST', '/import/gdrive', body),
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

export type ResourceType = 'VL' | 'NC' | 'M';

export type BuildingType = 'dan_dung' | 'cong_nghiep' | 'giao_thong' | 'nn_ptnt' | 'ha_tang';

export const BUILDING_TYPE_LABELS: Record<BuildingType, string> = {
  dan_dung: 'Dân dụng',
  cong_nghiep: 'Công nghiệp',
  giao_thong: 'Giao thông',
  nn_ptnt: 'NN&PTNT',
  ha_tang: 'Hạ tầng kỹ thuật',
};

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  VL: 'Vật liệu',
  NC: 'Nhân công',
  M: 'Máy thi công',
};

export interface Resource {
  code: string;
  name: string;
  unit: string;
  type: ResourceType;
  basePrice: number;
}

export interface Norm {
  code: string;
  name: string;
  unit: string;
  group?: string;
  /** Phụ lục nguồn (TT 38/2026), e.g. "Phụ lục II". */
  appendix?: string;
  sectionCode?: string;
  sectionTitle?: string;
  work?: string;
  variant?: string;
  /** Trang trong file PDF nguồn. */
  page?: number | null;
  sourceFile?: string;
  sourceSha256?: string;
  /** 'imported_needs_review' | 'verified' | ... */
  status?: string;
}

export interface NormResource {
  normCode: string;
  resourceCode: string;
  consumption: number;
  /** Adjustment coefficient applied to the consumption (default 1). */
  coefficient?: number;
  /**
   * When set, `consumption` is a PERCENTAGE (0–100) applied to the norm's VL or M subtotal
   * instead of a per-unit consumption (e.g. "Vật liệu khác 10%", "Máy khác 5%" – TT 38/2026).
   */
  pctBase?: 'VL' | 'M' | null;
}

export interface Category {
  id: number;
  name: string;
  order: number;
  /** TT rate override (%) for this hạng mục, e.g. công tác XD trong đường hầm (TT 36/2026 Bảng 3.5). */
  ttRate?: number | null;
  /** Hạng mục công trình (work package) this Phần belongs to (Update 6 A). */
  workPackageId?: number;
}

export interface EstimateItem {
  id: number;
  categoryId: number;
  order: number;
  normCode: string;
  name: string;
  unit: string;
  quantity: number;
  quantityFormula?: string | null;
  note?: string | null;
  /**
   * How the norm code was set: '' none, 'manual' typed by the user, 'imported' from a source file,
   * 'auto' assigned by the suggestion engine (needs confirmation), 'confirmed' accepted by the user.
   */
  /** 'tbvt' = thiết bị / vật tư theo báo giá: no norm code needed. */
  codeStatus?: '' | 'manual' | 'imported' | 'auto' | 'confirmed' | 'tbvt';
  /** Chinese name of a bilingual estimate (kept for bilingual reports). */
  nameZh?: string | null;
  /**
   * Fidelity of an imported price that disagrees with KL×đơn giá (Update 4): 'file' keeps the file's own Thành tiền
   * (default), 'calc' recomputes from KL × đơn giá instead. null/undefined = not applicable (no disagreement, or not imported).
   */
  amountMode?: 'file' | 'calc' | null;
  codeConfidence?: number | null;
  /** Provenance of imported/assigned items – never overwritten. */
  source?: ItemSource | null;
  /** NORM_BASED (default), CUSTOM_GTT (giá tạm tính / tự lập) or MARKET_QUOTE (báo giá). */
  pricingMethod?: 'NORM_BASED' | 'CUSTOM_GTT' | 'MARKET_QUOTE';
  /** Unit price components for CUSTOM_GTT / MARKET_QUOTE items (VND per item unit, as entered). */
  custom?: { vl: number; nc: number; m: number } | null;
  /** Mandatory origin of a custom / quoted price (document, file, calculation). */
  priceSource?: string | null;
  quote?: ItemQuote | null;
  /** 'MANUAL' | 'FORMULA' | 'LINES' | 'IMPORTED' */
  quantitySource?: string | null;
  /** Code exactly as written in the imported file (never overwritten by the resolved norm code). */
  normCodeRaw?: string | null;
  /** Result of checking the imported code against the active norm set: match | mismatch | propose | suggest. */
  codeCheck?: 'match' | 'mismatch' | 'propose' | 'suggest' | null;
  codeCheckNote?: string | null;
  /** Norm-based unit cost shown next to a file/custom price for comparison ("giá theo định mức"). */
  normUnitCost?: { vl: number; nc: number; m: number; total: number } | null;
  /** Selected TT 38/2026 Phụ lục VII mix design code for this item's "Vữa..." resource, if any. */
  mixCode?: string | null;
  /**
   * Calculation-only, not persisted: when set, computeEstimate uses this instead of the norm's own
   * resource list (mix-design expansion of a "Vữa..." resource into cement/sand/stone/water).
   */
  normResourcesOverride?: NormResource[] | null;
}

export interface ItemQuote {
  supplier?: string | null;
  number?: string | null;
  date?: string | null;
  validUntil?: string | null;
  /** before_vat | including_vat | not_stated */
  vatStatus?: 'before_vat' | 'including_vat' | 'not_stated' | null;
  vatRate?: number | null;
}

export interface ItemSource {
  file?: string | null;
  sheet?: string | null;
  row?: number | null;
  description?: string | null;
  quantity?: number | null;
  unit?: string | null;
  code?: string | null;
  /** Excel cell of each imported field, e.g. { quantity: 'E6', vl: 'F6' }. */
  cells?: Record<string, string> | null;
  /**
   * The file's own unit prices and Thành tiền (Update 4 fidelity), kept so the applied amount can be toggled between
   * "theo file" and "tính lại theo KL×đơn giá" (`amountMode`) without re-uploading the file.
   */
  filePrices?: { vl: number | null; nc: number | null; m: number | null; unit: number | null; amount: number | null } | null;
}

/** Cost settings stored per project. All rates are percentages (e.g. 6.5 means 6.5%). */
export interface CostSettings {
  /** When true the rates are taken from the default table by building type & cost bracket. */
  autoRates: boolean;
  /** Base for "chi phí chung": direct cost T or labour cost NC. */
  cBase: 'T' | 'NC';
  cRate: number;
  ltRate: number;
  ttRate: number;
  gtkRate: number;
  tlRate: number;
  /** Optional "Tổng dự toán" inputs (VND amounts, contingency in %). */
  equipment: number;
  qlda: number;
  tuVan: number;
  other: number;
  contingencyQtyRate: number;
  contingencyPriceRate: number;
}

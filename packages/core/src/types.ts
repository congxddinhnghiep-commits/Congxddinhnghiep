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
}

export interface NormResource {
  normCode: string;
  resourceCode: string;
  consumption: number;
  /** Adjustment coefficient applied to the consumption (default 1). */
  coefficient?: number;
}

export interface Category {
  id: number;
  name: string;
  order: number;
  /** TT rate override (%) for this hạng mục, e.g. công tác XD trong đường hầm (TT 36/2026 Bảng 3.5). */
  ttRate?: number | null;
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
  codeStatus?: '' | 'manual' | 'imported' | 'auto' | 'confirmed';
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

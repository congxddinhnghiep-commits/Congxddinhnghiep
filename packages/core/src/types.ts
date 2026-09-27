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

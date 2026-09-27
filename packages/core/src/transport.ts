/**
 * Price to site: giá đến công trình = giá nguồn + cước vận chuyển + bốc dỡ + phí + điều chỉnh.
 * A transport leg is added only when the price source does not already include transport.
 */
export interface TransportLeg {
  id?: number;
  fromLocation: string;
  toLocation: string;
  roadClass?: string | null;
  /** km */
  distance: number;
  /** đ per tonne·km (or per unit·km when weightFactor = 1) */
  freightRate: number;
  /** tonnes per resource unit (e.g. cát 1,4 t/m3; xi măng 0,001 t/kg) */
  weightFactor: number;
  /** road / vehicle coefficient */
  loadFactor: number;
  /** bốc dỡ, đ per resource unit */
  handling: number;
  /** trạm phí / phí khác, đ per resource unit */
  toll: number;
  note?: string | null;
}

/** Amount of one leg per resource unit (VND). */
export function transportLegAmount(l: TransportLeg): number {
  return l.distance * l.freightRate * l.weightFactor * l.loadFactor + l.handling + l.toll;
}

export function transportAmount(legs: TransportLeg[]): number {
  return legs.reduce((a, l) => a + transportLegAmount(l), 0);
}

export function transportFormula(l: TransportLeg): string {
  return `${l.distance} km × ${l.freightRate} đ/t.km × ${l.weightFactor} t × k ${l.loadFactor} + bốc dỡ ${l.handling} + phí ${l.toll}`;
}

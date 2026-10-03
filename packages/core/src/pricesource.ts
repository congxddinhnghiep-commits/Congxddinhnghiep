import type { EstimateItem, PriceSourceKind } from './types.js';

/** Which of the three auto-resolved kinds are actually available for an item right now. `thu_cong` is never
 * auto-resolved – it only exists as an explicit per-item pin or as the natural state of a hand-priced item. */
export interface PriceSourceAvailability {
  dia_phuong: boolean;
  ho_so: boolean;
  chiet_tinh: boolean;
}

/**
 * Update 6 E.3/E.4: `chiet_tinh` is available whenever the item has a norm code with at least one resource
 * (whatever those resources' prices turn out to be); `dia_phuong` is the STRICTER case of that – available only
 * when EVERY one of its resources resolves to a verified regional price book (`kind: 'book'`), never invented.
 * `ho_so` is available whenever the item was imported with the file's own unit prices, whether or not that price
 * is the one currently applied.
 */
export function availablePriceSources(item: Pick<EstimateItem, 'normCode' | 'source'>, normResourceKinds: ('manual' | 'book' | 'base')[] | null): PriceSourceAvailability {
  const chietTinh = !!item.normCode && !!normResourceKinds && normResourceKinds.length > 0;
  const diaPhuong = chietTinh && normResourceKinds!.every((k) => k === 'book');
  return { dia_phuong: diaPhuong, ho_so: !!item.source?.filePrices, chiet_tinh: chietTinh };
}

/** Default priority order (province-published price wins, then the imported file, then computed from the norm). */
export const DEFAULT_PRICE_SOURCE_PRIORITY: PriceSourceKind[] = ['dia_phuong', 'ho_so', 'chiet_tinh'];

/**
 * The item's EFFECTIVE price_source: an explicit pin (`priceSourceOverride`) always wins; a hand-priced item with
 * neither a norm code nor a file price is `thu_cong` by construction (there is nothing else it could be); otherwise
 * the first available kind in the project's priority order, or `null` when nothing is available (an un-priced item).
 */
export function resolvePriceSource(
  item: Pick<EstimateItem, 'normCode' | 'source' | 'pricingMethod' | 'priceSourceOverride'>,
  avail: PriceSourceAvailability,
  priority: PriceSourceKind[] = DEFAULT_PRICE_SOURCE_PRIORITY,
): PriceSourceKind | null {
  if (item.priceSourceOverride) return item.priceSourceOverride;
  if (item.pricingMethod && item.pricingMethod !== 'NORM_BASED' && !item.source?.filePrices && !item.normCode) return 'thu_cong';
  for (const k of priority) {
    if (k === 'thu_cong') continue;
    if (avail[k]) return k;
  }
  return null;
}

/**
 * What the item is ACTUALLY priced as right now (from its stored pricingMethod/source/override) – as opposed to
 * `resolvePriceSource`, which says what the project's priority order would PREFER. "Áp dụng lại thứ tự ưu tiên"
 * is exactly the set of items where these two differ.
 */
export function currentPriceSourceKind(
  item: Pick<EstimateItem, 'normCode' | 'source' | 'pricingMethod' | 'priceSourceOverride'>,
  normResourceKinds: ('manual' | 'book' | 'base')[] | null,
): PriceSourceKind | null {
  if (item.priceSourceOverride) return item.priceSourceOverride;
  if (item.pricingMethod === 'CUSTOM_GTT' && item.source?.filePrices) return 'ho_so';
  if ((item.pricingMethod ?? 'NORM_BASED') === 'NORM_BASED' && item.normCode) {
    return normResourceKinds && normResourceKinds.length > 0 && normResourceKinds.every((k) => k === 'book') ? 'dia_phuong' : 'chiet_tinh';
  }
  if (item.pricingMethod === 'CUSTOM_GTT' || item.pricingMethod === 'MARKET_QUOTE') return 'thu_cong';
  return null;
}

/** What applying a resolved kind to an item means for its pricing method ('dia_phuong' and 'chiet_tinh' are both
 * NORM_BASED – they differ only in label/provenance, since dia_phuong is a stricter case of the same computation). */
export function pricingMethodFor(kind: PriceSourceKind): 'NORM_BASED' | 'CUSTOM_GTT' | null {
  if (kind === 'dia_phuong' || kind === 'chiet_tinh') return 'NORM_BASED';
  if (kind === 'ho_so') return 'CUSTOM_GTT';
  return null; // thu_cong: whatever custom price is already there, untouched
}

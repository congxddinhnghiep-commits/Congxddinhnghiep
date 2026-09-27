import { normalizeText, tokenize } from './text.js';

const STOP_PHRASES = [/\bcong tac\b/g, /\bdinh muc\b/g, /\bma hieu\b/g, /\bma so\b/g];
const STOP_WORDS = new Set(['cua', 'cho', 'loai', 'bang', 'ma', 'dm', 'cac']);

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bbt\b/g, 'be tong'],
  [/\bbtct\b/g, 'be tong'],
  [/\bvk\b/g, 'van khuon'],
  [/\bm(\d{2,3})\b/g, 'mac $1'],
  [/\bpc(\d{2})\b/g, 'pcb$1'],
];

/** Expand abbreviations and drop filler words from a search query. */
export function queryTokens(query: string): string[] {
  let q = normalizeText(query);
  for (const [re, rep] of ABBREVIATIONS) q = q.replace(re, rep);
  for (const re of STOP_PHRASES) q = q.replace(re, ' ');
  return tokenize(q).filter((t) => !STOP_WORDS.has(t));
}

export interface Searchable {
  code: string;
  name: string;
}

export interface SearchHit<T> {
  item: T;
  score: number;
  /** All query tokens were found. */
  full: boolean;
}

function tokenMatches(q: string, nameTokens: string[]): boolean {
  if (/^\d/.test(q)) return nameTokens.includes(q);
  return nameTokens.some((t) => t === q || (q.length >= 3 && t.startsWith(q)));
}

/**
 * Search by code or name, diacritic-insensitive. Returns full matches first; if there are
 * none, the best partial matches. Code prefix matches rank above name matches.
 */
export function searchByCodeOrName<T extends Searchable>(list: T[], query: string, limit = 20): SearchHit<T>[] {
  const nq = normalizeText(query);
  if (!nq) return [];
  const tokens = queryTokens(query);
  const hits: SearchHit<T>[] = [];
  for (const item of list) {
    const code = item.code.toLowerCase();
    if (code === nq) {
      hits.push({ item, score: 100, full: true });
      continue;
    }
    if (nq.length >= 2 && code.startsWith(nq)) {
      hits.push({ item, score: 50, full: true });
      continue;
    }
    if (!tokens.length) continue;
    const nameTokens = tokenize(item.name + ' ' + item.code);
    const matched = tokens.filter((t) => tokenMatches(t, nameTokens)).length;
    if (!matched) continue;
    // Prefer shorter names when the match ratio is equal (more specific wording).
    const score = (matched / tokens.length) * 10 - nameTokens.length * 0.01;
    hits.push({ item, score, full: matched === tokens.length });
  }
  hits.sort((a, b) => b.score - a.score || a.item.code.localeCompare(b.item.code));
  const full = hits.filter((h) => h.full);
  return (full.length ? full : hits).slice(0, limit);
}

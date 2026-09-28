import { canonicalNormCode, extractParams, normalizeWork, unitFactor } from '@dutoan/core';
import type { Repo } from './repo.js';

export type CodeCheckStatus = 'match' | 'mismatch' | 'propose' | 'suggest' | 'gtt' | 'none';

export const CODE_CHECK_LABELS: Record<CodeCheckStatus, string> = {
  match: 'khớp mã',
  mismatch: 'mã và tên công việc không khớp – cần kiểm tra',
  propose: 'đề xuất chuyển mã',
  suggest: 'gợi ý mã',
  gtt: 'mã GTT (giá tạm tính)',
  none: 'chưa có mã',
};

export interface CodeCandidate {
  code: string;
  name: string;
  unit: string;
  confidence: number;
  reason: string;
}

export interface CodeResolution {
  status: CodeCheckStatus;
  label: string;
  rawCode: string;
  /** Code that exists in the active norm set and is applied by default (never the raw code if unknown). */
  code: string | null;
  normName?: string;
  candidates: CodeCandidate[];
  /** Parameters the description lacks and the user should provide to pick among near-identical codes. */
  askParams?: string[];
  message: string;
}

const MATCH_COVERAGE = 0.5;

/** Parameters missing from a description of a dig / fill / pile work (asked from the user). */
function missingParams(name: string): string[] {
  const n = normalizeWork(name);
  const p = extractParams(n);
  const ask: string[] = [];
  if (p.work === 'dao' || p.work === 'dap') {
    if (!p.soil) ask.push('cấp đất (I–IV)');
    if (p.work === 'dao' && !/\b(rong|sau)\b/.test(n)) ask.push('chiều rộng và chiều sâu móng');
  }
  if (p.work === 'ep_coc' && !p.soil) ask.push('cấp đất');
  return ask;
}

/**
 * Resolve the code of an imported item against the project's active norm set:
 *  1. code exists → keep it; compare the file description with the norm name (match / mismatch);
 *  2. code missing but looks like a norm code → propose a code of the same family by description;
 *  3. no code → suggestion engine on description + unit.
 * The raw code is never overwritten – the caller keeps it.
 */
export function resolveImportCode(repo: Repo, dataset: string, row: { code: string; name: string; unit: string }, opts: { ignoreExisting?: boolean } = {}): CodeResolution {
  const index = repo.normIndex(dataset);
  const cc = canonicalNormCode(row.code);
  const unit = row.unit.trim() || null;
  const top = (limit: number, family?: string) => {
    const list = index.suggest(row.name, unit, family ? 80 : limit);
    const picked = family ? list.filter((s) => s.norm.code.startsWith(family)) : list;
    return picked.slice(0, limit).map((s) => ({ code: s.norm.code, name: s.norm.name, unit: s.norm.unit, confidence: s.confidence, reason: s.why }));
  };
  const base = { rawCode: row.code.trim() };

  if (cc.kind === 'custom') return { ...base, status: 'gtt', label: CODE_CHECK_LABELS.gtt, code: null, candidates: [], message: 'Mã GTT: tính theo giá tạm tính/tự lập, cần nguồn giá.' };

  const norm = cc.normalized && !opts.ignoreExisting ? repo.getNorm(cc.normalized, dataset) : undefined;
  if (norm) {
    const cmp = index.compare(row.name, norm.code);
    const unitOk = !unit || unitFactor(unit, norm.unit) !== null;
    if (cmp.conflicts.length === 0 && cmp.coverage >= MATCH_COVERAGE && unitOk) {
      return { ...base, status: 'match', label: CODE_CHECK_LABELS.match, code: norm.code, normName: norm.name, candidates: [], message: `Khớp mã ${norm.code}: ${norm.name}` };
    }
    const why = [
      cmp.conflicts.length ? `khác ${cmp.conflicts.join(', ')}` : '',
      cmp.coverage < MATCH_COVERAGE ? `tên chỉ khớp ${Math.round(cmp.coverage * 100)}%` : '',
      !unitOk ? `khác đơn vị (${unit} ≠ ${norm.unit})` : '',
    ]
      .filter(Boolean)
      .join('; ');
    const ask = missingParams(row.name);
    return {
      ...base,
      status: 'mismatch',
      label: CODE_CHECK_LABELS.mismatch,
      code: norm.code,
      normName: norm.name,
      candidates: top(3),
      askParams: ask.length ? ask : undefined,
      message: `Mã ${norm.code} trong bộ ${dataset} là "${norm.name}", khác tên trong file "${row.name}" (${why}).${ask.length ? ` Cần bổ sung: ${ask.join('; ')}.` : ''}`,
    };
  }

  const looksLikeCode = cc.kind === 'norm' || /^[A-Z]{1,3}\.?\d{3,}/.test(cc.normalized);
  if (looksLikeCode && cc.normalized) {
    const norm5 = cc.normalized.replace('.', '');
    // same prefix family, e.g. AF.11111 → AF.111xx, then AF.11xxx
    for (const len of [6, 5]) {
      const family = `${norm5.slice(0, 2)}.${norm5.slice(2, len - 1)}`;
      const cands = top(3, family);
      if (cands.length) {
        const c = cands.map((x, i) => ({ ...x, confidence: Math.min(0.95, Math.round((x.confidence + (len === 6 ? 0.25 : 0.1)) * 100) / 100), reason: `cùng họ mã ${family}xx; ${x.reason}` }));
        return {
          ...base,
          status: 'propose',
          label: CODE_CHECK_LABELS.propose,
          code: null,
          candidates: c,
          message: `Mã ${row.code.trim()} không có trong bộ ${dataset} (mã kiểu cũ) – đề xuất ${c[0].code}: ${c[0].name} (${Math.round(c[0].confidence * 100)}%). Cần xác nhận.`,
        };
      }
    }
    const g = top(3);
    if (g.length) {
      return { ...base, status: 'propose', label: CODE_CHECK_LABELS.propose, code: null, candidates: g, message: `Mã ${row.code.trim()} không có trong bộ ${dataset} – đề xuất theo mô tả và đơn vị. Cần xác nhận.` };
    }
    return { ...base, status: 'none', label: CODE_CHECK_LABELS.none, code: null, candidates: [], message: `Mã ${row.code.trim()} không có trong bộ ${dataset} và không tìm được mã gần đúng.` };
  }

  const g = top(3);
  return {
    ...base,
    status: g.length ? 'suggest' : 'none',
    label: g.length ? CODE_CHECK_LABELS.suggest : CODE_CHECK_LABELS.none,
    code: null,
    candidates: g,
    askParams: missingParams(row.name).length ? missingParams(row.name) : undefined,
    message: g.length ? `Chưa có mã – gợi ý ${g[0].code}: ${g[0].name} (${Math.round(g[0].confidence * 100)}%).` : 'Chưa có mã và không tìm được mã phù hợp.',
  };
}

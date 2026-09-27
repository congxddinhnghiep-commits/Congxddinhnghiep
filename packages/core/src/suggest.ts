import { normalizeText } from './text.js';
import { unitFactor } from './units.js';

// ---------------------------------------------------------------------------
// Text normalisation and parameter extraction for construction work descriptions
// ---------------------------------------------------------------------------

/** Concrete class B → grade (mác) as commonly used in Vietnamese practice (TCVN 5574 correspondence). */
const B_TO_MAC: Record<string, string> = { '7.5': '100', '10': '150', '12.5': '150', '15': '200', '20': '250', '22.5': '300', '25': '350', '30': '400' };

const ABBR: [RegExp, string][] = [
  [/\bbtct\b/g, 'be tong cot thep'],
  [/\bbtcl\b/g, 'be tong'],
  [/\bbt\b/g, 'be tong'],
  [/\bvk\b/g, 'van khuon'],
  [/\bct\b/g, 'cot thep'],
  [/\bsx\b/g, 'san xuat'],
  [/\bld\b/g, 'lap dung'],
  [/\bxm\b/g, 'xi mang'],
  [/\bdk\b/g, 'duong kinh'],
  [/\bdtt\b/g, 'tu do'],
  [/\bbtn\b/g, 'be tong nhua'],
];

export interface WorkParams {
  work?: string;
  member?: string;
  grade?: string;
  mortar?: string;
  dia?: 'le10' | 'le18' | 'gt18';
  thick?: 'le11' | 'le33' | 'gt33';
  height?: string;
  soil?: string;
  section?: 'le01' | 'gt01';
  compaction?: string;
  location?: 'trong' | 'ngoai';
}

const ROMAN: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4' };

/** Lower-case, strip diacritics, expand abbreviations and comparison symbols. */
export function normalizeWork(text: string): string {
  let s = normalizeText(
    text
      .replace(/≤|<=|=</g, ' le ')
      .replace(/≥|>=/g, ' ge ')
      .replace(/>/g, ' gt ')
      .replace(/</g, ' le ')
      .replace(/[ØøφϕΦ]/g, ' d '),
  );
  s = s.replace(/(\d),(\d)/g, '$1.$2');
  for (const [re, rep] of ABBR) s = s.replace(re, rep);
  s = s.replace(/\bb\s?(\d{1,2}(?:\.5)?)\b/g, (m, b: string) => (B_TO_MAC[b] ? `mac ${B_TO_MAC[b]}` : m));
  s = s.replace(/\bm\s?(\d{2,3})\b/g, 'mac $1');
  s = s.replace(/\bphi\s?(\d)/g, 'd $1');
  return s.replace(/\s+/g, ' ').trim();
}

export function extractParams(norm: string): WorkParams {
  const p: WorkParams = {};
  // Work type (order matters: "be tong cot thep" is concrete work, "cot thep" alone is rebar)
  let s = norm.replace(/be tong cot thep/g, 'be tong');
  if (/\bvan khuon\b/.test(s)) p.work = 'van_khuon';
  else if (/\bcot thep\b|\bthep tron\b/.test(s) && !/\bcoc\b/.test(s)) p.work = 'cot_thep';
  else if (/\b(ep|dong|nen)\b.*\bcoc\b/.test(s)) p.work = 'ep_coc';
  else if (/\bnoi coc\b/.test(s)) p.work = 'noi_coc';
  else if (/\bbe tong\b/.test(s)) p.work = 'be_tong';
  else if (/\bxay\b/.test(s)) p.work = 'xay';
  else if (/\btrat\b/.test(s)) p.work = 'trat';
  else if (/\bson\b/.test(s)) p.work = 'son';
  else if (/\b(ba|matit|ba bot)\b/.test(s)) p.work = 'ba';
  else if (/\b(lat|op)\b/.test(s)) p.work = 'lat';
  else if (/\bvan chuyen\b/.test(s)) p.work = 'van_chuyen';
  else if (/\bdao\b/.test(s)) p.work = 'dao';
  else if (/\bdap\b|\blap\b/.test(s)) p.work = 'dap';
  s = s.replace(/cot thep/g, 'cotthep').replace(/\bsan xuat\b/g, 'sanxuat');

  // Member
  if (/\blot\b/.test(s) && p.work === 'be_tong') p.member = 'lot';
  else if (/\bcau thang\b/.test(s)) p.member = 'cau_thang';
  else if (/\blanh to\b|\bo vang\b/.test(s)) p.member = 'lanh_to';
  else if (/\b(cot|tru)\b/.test(s)) p.member = 'cot';
  else if (/\b(dam|xa|giang)\b/.test(s)) p.member = 'dam';
  else if (/\b(san|mai)\b/.test(s) && !/\bsan lap\b/.test(s)) p.member = 'san';
  else if (/\bmong\b/.test(s)) p.member = 'mong';
  else if (/\btran\b/.test(s)) p.member = 'tran';
  else if (/\btuong\b/.test(s)) p.member = 'tuong';
  else if (/\bnen\b/.test(s)) p.member = 'nen';

  // Mortar grade ("vữa XM mác 75") vs concrete grade
  const mortar = /\bvua\b[^,;]*?\bmac (\d{2,3})\b/.exec(s);
  if (mortar) p.mortar = mortar[1];
  const grades = [...s.matchAll(/\bmac (\d{2,3})\b/g)].map((m) => m[1]).filter((g) => g !== p.mortar || !mortar);
  if (grades.length && p.work !== 'xay' && p.work !== 'trat' && p.work !== 'lat') p.grade = grades[0];

  // Diameter of rebar
  const dia = /\b(?:duong kinh|d)\s*(le|lt|gt|ge)?\s*(\d{1,2})\s*(?:mm)?\b/.exec(s);
  if (dia && p.work === 'cot_thep') {
    const v = Number(dia[2]);
    const cmp = dia[1];
    if (cmp === 'gt' || cmp === 'ge') p.dia = v >= 18 ? 'gt18' : v >= 10 ? 'le18' : 'le10';
    else p.dia = v <= 10 ? 'le10' : v <= 18 ? 'le18' : 'gt18';
  }

  // Wall thickness
  const thick = /\bday\s*(le|lt|gt)?\s*(\d+(?:\.\d+)?)\s*(cm|mm)?/.exec(s);
  if (thick && p.work === 'xay') {
    let v = Number(thick[2]);
    if (thick[3] === 'mm' || (!thick[3] && v > 40)) v /= 10;
    p.thick = thick[1] === 'gt' ? (v >= 33 ? 'gt33' : 'le33') : v <= 11 ? 'le11' : v <= 33 ? 'le33' : 'gt33';
  }

  const height = /\bcao\s*(le|lt)?\s*(\d+(?:\.\d+)?)\s*m\b/.exec(s);
  if (height) p.height = height[2];

  const soil = /\bdat\s*(?:cap\s*|c)(i{1,3}|iv|[1-4])\b/.exec(s) ?? /\bcap (i{1,3}|iv|[1-4])\b/.exec(s);
  if (soil && (p.work === 'dao' || p.work === 'dap' || p.work === 'van_chuyen' || p.work === 'ep_coc')) p.soil = ROMAN[soil[1]] ?? soil[1];

  const section = /\btiet dien\s*(le|lt|gt|ge)\s*0\.1(?!\d)/.exec(s);
  if (section) p.section = section[1] === 'gt' || section[1] === 'ge' ? 'gt01' : 'le01';
  else {
    // "cột 30x40" / "0,3x0,4" → cross-section area
    // (not "đá 1x2" – aggregate size)
    const dims = /(?<!\bda )\b(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\b/.exec(s);
    if (dims && p.work === 'be_tong' && p.member === 'cot') {
      let a = Number(dims[1]);
      let b = Number(dims[2]);
      if (a > 5) a /= 100;
      if (b > 5) b /= 100;
      p.section = a * b <= 0.1 ? 'le01' : 'gt01';
    }
  }

  const k = /\bk\s*=?\s*0?\.(\d{2})\b/.exec(s);
  if (k && p.work === 'dap') p.compaction = k[1];

  if (/\b(trong nha|tuong trong|ben trong)\b/.test(s)) p.location = 'trong';
  else if (/\b(ngoai nha|tuong ngoai|ben ngoai)\b/.test(s)) p.location = 'ngoai';
  return p;
}

const STOP = new Set([
  'cong', 'tac', 'san', 'xuat', 'lap', 'dung', 'bang', 'cac', 'loai', 'va', 'cho', 'cua', 'trong', 'tren', 'duoi', 'tang',
  'truc', 'phan', 'hang', 'muc', 'khoi', 'luong', 'thi', 'the', 'theo', 'tai', 'vi', 'tri', 'le', 'gt', 'ge', 'lt', 'mm', 'cm',
  'm', 'x', 'mac', 'd', 'duong', 'kinh', 'cao', 'day', 'tiet', 'dien', 'k', 'la', 'co', 'gom', 'toan', 'bo',
]);

/** Content tokens used for text similarity (numbers and parameter words removed). */
export function workTokens(norm: string): string[] {
  return norm
    .replace(/cot thep/g, 'cotthep')
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t) && !/^\d+(\.\d+)?$/.test(t) && !/^\d+m[23]?$/.test(t));
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export interface SuggestNorm {
  code: string;
  name: string;
  unit: string;
  group?: string;
}

export interface Suggestion<T extends SuggestNorm = SuggestNorm> {
  norm: T;
  score: number;
  /** 0–1 */
  confidence: number;
  /** Short explanation (Vietnamese) of why the norm matches. */
  why: string;
  /** Factor to convert the item quantity into the norm unit (e.g. m3 → 100m3 = 0,01). */
  unitFactor: number;
}

interface Indexed<T> {
  norm: T;
  tokens: Set<string>;
  params: WorkParams;
  idfMass: number;
}

const PARAM_LABEL: Record<keyof WorkParams, string> = {
  work: 'loại công tác',
  member: 'cấu kiện',
  grade: 'mác bê tông',
  mortar: 'mác vữa',
  dia: 'đường kính',
  thick: 'chiều dày',
  height: 'chiều cao',
  soil: 'cấp đất',
  section: 'tiết diện',
  compaction: 'độ chặt',
  location: 'vị trí',
};

/** Pre-computed index for a norm list (build once per dataset). */
export class NormIndex<T extends SuggestNorm = SuggestNorm> {
  private docs: Indexed<T>[];
  private idf = new Map<string, number>();

  constructor(norms: T[]) {
    const df = new Map<string, number>();
    const raw = norms.map((n) => {
      const nn = normalizeWork(n.name);
      const tokens = new Set(workTokens(nn));
      for (const t of tokens) df.set(t, (df.get(t) ?? 0) + 1);
      return { norm: n, tokens, params: extractParams(nn) };
    });
    const N = norms.length || 1;
    for (const [t, d] of df) this.idf.set(t, Math.log(1 + (N - d + 0.5) / (d + 0.5)));
    this.docs = raw.map((d) => ({ ...d, idfMass: [...d.tokens].reduce((a, t) => a + (this.idf.get(t) ?? 0), 0) || 1 }));
  }

  get size(): number {
    return this.docs.length;
  }

  /** Code prefix search: "AF.1", "af11", "AF.12213". */
  byCodePrefix(q: string): T[] {
    const k = q.toLowerCase().replace(/[.\s]/g, '');
    if (!/^[a-z]{2}\d*[a-z0-9]*$/.test(k) || k.length < 2) return [];
    return this.docs
      .map((d) => d.norm)
      .filter((n) => n.code.toLowerCase().replace(/\./g, '').startsWith(k))
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  /**
   * Rank norms for a work description (+ optional unit). Unit compatibility is a hard filter.
   * Returns candidates sorted by score with a confidence for the top ones.
   */
  suggest(description: string, unit?: string | null, limit = 5): Suggestion<T>[] {
    const qn = normalizeWork(description);
    const qTokens = [...new Set(workTokens(qn))].filter((t) => this.idf.has(t));
    const qParams = extractParams(qn);
    const qMass = qTokens.reduce((a, t) => a + (this.idf.get(t) ?? 0), 0);
    if (!qTokens.length && !qParams.work) return [];

    const scored: (Suggestion<T> & { conflicts: number; missing: number })[] = [];
    for (const d of this.docs) {
      let factor = 1;
      if (unit) {
        const f = unitFactor(unit, d.norm.unit);
        if (f === null) continue;
        factor = f;
      }
      const matched = qTokens.filter((t) => d.tokens.has(t));
      const mMass = matched.reduce((a, t) => a + (this.idf.get(t) ?? 0), 0);
      const qCov = qMass ? mMass / qMass : 0;
      const dCov = mMass / d.idfMass;
      let text = 0.7 * qCov + 0.3 * dCov;

      // Parameters
      let agree = 0;
      let conflicts = 0;
      let missing = 0;
      const reasons: string[] = [];
      const bad: string[] = [];
      for (const key of Object.keys(PARAM_LABEL) as (keyof WorkParams)[]) {
        const qv = qParams[key];
        const nv = d.params[key];
        if (qv && nv) {
          if (qv === nv) {
            agree += key === 'work' ? 1.5 : 1;
            reasons.push(PARAM_LABEL[key]);
          } else {
            conflicts += key === 'work' ? 3 : 1;
            bad.push(PARAM_LABEL[key]);
          }
        } else if (nv && !qv && key !== 'height' && key !== 'mortar' && key !== 'location') {
          missing++;
        }
      }
      if (qParams.work && d.params.work && qParams.work !== d.params.work) text *= 0.3;
      const nParams = Object.values(qParams).filter(Boolean).length || 1;
      const paramScore = (agree - 1.5 * conflicts) / (nParams + 0.5);
      const score = text + 0.5 * paramScore - 0.05 * missing;
      if (score <= 0.05 || (!matched.length && !agree)) continue;

      const whyParts: string[] = [];
      if (matched.length) whyParts.push(`khớp từ khóa: ${matched.join(', ')}`);
      if (reasons.length) whyParts.push(`đúng ${reasons.join(', ')}`);
      if (bad.length) whyParts.push(`KHÁC ${bad.join(', ')}`);
      if (unit) whyParts.push(factor === 1 ? `cùng đơn vị ${d.norm.unit}` : `quy đổi ${unit} → ${d.norm.unit} (×${String(+factor.toPrecision(6)).replace('.', ',')})`);
      scored.push({ norm: d.norm, score, confidence: 0, why: whyParts.join('; '), unitFactor: factor, conflicts, missing });
    }
    scored.sort((a, b) => b.score - a.score || a.norm.code.localeCompare(b.norm.code));
    const top = scored.slice(0, Math.max(limit, 2));
    // Confidence: absolute fit of the candidate, reduced when a close runner-up exists.
    top.forEach((c, i) => {
      const next = top[i + 1] ?? top[i - 1];
      const margin = next ? Math.min(1, Math.max(0, (c.score - next.score) / 0.35)) : 1;
      const fit = Math.max(0, Math.min(1, c.score / 1.2));
      let conf = 0.55 * fit + 0.45 * (i === 0 ? margin : 0);
      if (c.conflicts) conf = Math.min(conf, 0.5);
      if (c.missing) conf = Math.min(conf, 0.79);
      c.confidence = Math.round(Math.max(0, Math.min(1, conf)) * 100) / 100;
    });
    return top.slice(0, limit).map(({ conflicts: _c, missing: _m, ...s }) => s);
  }
}

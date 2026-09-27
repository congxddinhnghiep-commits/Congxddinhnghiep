/**
 * Idempotent import of TT 38/2026/TT-BXD Phụ lục VII – material usage / mix designs
 * (data/norms/tt38_2026/tt38_2026_pl7_vatlieu.json, 1.085 records, e.g. "11.12111" concrete mix with
 * cement kg, sand m3, stone m3, water lít, additive).
 *
 * Stored as a `mix_designs` catalog (status imported_needs_review, page kept) with a flexible
 * `mix_design_materials` breakdown per code. This lets a norm's "Vữa" / "Vữa bê tông" / "Vữa xi măng"
 * resource line expand into cement/sand/stone/water for a chosen mix code (see
 * packages/core/src/mixdesign.ts and Repo.calculate() in repo.ts), instead of staying an unpriced
 * placeholder.
 *
 * Material resources are resolved into the shared resources master (same normalized name+unit dedup
 * and deterministic code as the main TT38 import), so re-running this script is safe.
 *
 * Run: npm run import:tt38-pl7
 */
import fs from 'node:fs';
import path from 'node:path';
import { normalizeText } from '@dutoan/core';
import { config } from '../config.js';
import { openDb, type DB } from '../db.js';
import { tt38ResourceCode, TT38_SRC_DIR } from './tt38-data.js';

interface Pl7Record {
  code: string;
  section: string;
  spec?: string;
  page: number;
  values: Record<string, string>;
}

type MixKind = 'concrete' | 'mortar' | 'other';

/** Metadata fields in `values` that aren't a material quantity. */
const SKIP_KEYS = new Set(['Mác bê tông', 'Mác vữa', 'Đơn vị', 'Đơn vị tính', 'Số lượng', 'Quy cách', 'Quy cách (cm)', 'Phụ gia']);

function parseVnNumber(s: string): number | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * A material column key looks like "Vật liệu dùng cho 1m3 vữa bê tông | Xi măng (kg)" (name in the
 * last segment) or "Nhựa bi tum | (kg)" (name in the segment before the unit-only last one).
 */
function materialNameUnit(key: string): { name: string; unit: string } {
  const parts = key.split('|').map((p) => p.trim());
  const last = parts[parts.length - 1];
  const m = /\(([^)]+)\)\s*$/.exec(last);
  const unit = m ? m[1].trim() : '';
  let name = m ? last.slice(0, m.index).trim() : last;
  if (!name && parts.length >= 2) name = parts[parts.length - 2].trim();
  return { name, unit };
}

/** Runs the import against an already-open database (used by the CLI entry point and by tests). */
export function runImportTt38Pl7(db: DB): { designCount: number; resourceCount: number; materialCount: number; dupCount: number } {
  const file = path.join(TT38_SRC_DIR, 'tt38_2026_pl7_vatlieu.json');
  const records = JSON.parse(fs.readFileSync(file, 'utf8')) as Pl7Record[];
  if (records.length < 500) throw new Error(`Dữ liệu Phụ lục VII có vẻ chưa đầy đủ (đọc được ${records.length} bản ghi) – kiểm tra lại file JSON.`);

  const resourceMap = new Map<string, { code: string; name: string; unit: string }>();
  const resolveResource = (name: string, unit: string): string => {
    const key = `${normalizeText(name)}|${normalizeText(unit)}`;
    let r = resourceMap.get(key);
    if (!r) {
      r = { code: tt38ResourceCode('VL', name, unit), name, unit };
      resourceMap.set(key, r);
    }
    return r.code;
  };

  interface Design {
    code: string;
    section: string;
    spec: string | null;
    kind: MixKind;
    grade: string | null;
    page: number | null;
    raw: Record<string, string>;
  }
  interface MaterialRow {
    code: string;
    material: string;
    unit: string;
    qty: number;
    resourceCode: string;
    sortOrder: number;
  }
  const designs: Design[] = [];
  const materials: MaterialRow[] = [];
  const seenCodes = new Set<string>();
  let dupCodes = 0;

  for (const r of records) {
    const code = (r.code ?? '').trim();
    if (!code) continue;
    if (seenCodes.has(code)) {
      dupCodes++; // 3 duplicate codes from PDF print errors (see README) – first occurrence wins.
      continue;
    }
    seenCodes.add(code);
    const v = r.values ?? {};
    const kind: MixKind = 'Mác bê tông' in v ? 'concrete' : 'Mác vữa' in v ? 'mortar' : 'other';
    designs.push({ code, section: r.section ?? '', spec: r.spec ?? null, kind, grade: v['Mác bê tông'] ?? v['Mác vữa'] ?? null, page: r.page ?? null, raw: v });

    let sort = 0;
    for (const [k, val] of Object.entries(v)) {
      if (SKIP_KEYS.has(k) || k.startsWith('Trang') || /loại vật liệu/i.test(k)) continue;
      const qty = parseVnNumber(val);
      if (qty === null) continue;
      const { name, unit } = materialNameUnit(k);
      if (!name || !unit || /^\d+([.,]\d+)?$/.test(name)) continue; // stray numeric/empty fragments (OCR noise)
      materials.push({ code, material: name, unit, qty, resourceCode: resolveResource(name, unit), sortOrder: sort++ });
    }
  }

  let resourceCount = 0;
  db.transaction(() => {
    const upsertResource = db.prepare(
      `INSERT INTO resources (code, name, unit, type, base_price, name_search, is_sample) VALUES (?, ?, ?, 'VL', 0, ?, 0)
       ON CONFLICT(code) DO UPDATE SET name = excluded.name, unit = excluded.unit, name_search = excluded.name_search`,
    );
    for (const r of resourceMap.values()) {
      upsertResource.run(r.code, r.name, r.unit, normalizeText(`${r.code} ${r.name}`));
      resourceCount++;
    }

    const upsertDesign = db.prepare(
      `INSERT INTO mix_designs (code, section, spec, kind, grade, page, status, raw_json) VALUES (?, ?, ?, ?, ?, ?, 'imported_needs_review', ?)
       ON CONFLICT(code) DO UPDATE SET section = excluded.section, spec = excluded.spec, kind = excluded.kind, grade = excluded.grade,
         page = excluded.page, status = 'imported_needs_review', raw_json = excluded.raw_json`,
    );
    for (const d of designs) upsertDesign.run(d.code, d.section, d.spec, d.kind, d.grade, d.page, JSON.stringify(d.raw));

    // Full replace: this script always reimports the complete Phụ lục VII catalog.
    db.exec('DELETE FROM mix_design_materials');
    const insMaterial = db.prepare('INSERT INTO mix_design_materials (mix_code, material, unit, qty, resource_code, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
    for (const m of materials) insMaterial.run(m.code, m.material, m.unit, m.qty, m.resourceCode, m.sortOrder);
  })();

  return { designCount: designs.length, resourceCount: resourceMap.size, materialCount: materials.length, dupCount: dupCodes };
}

function main() {
  const db = openDb(config.dbPath);
  const r = runImportTt38Pl7(db);
  console.log(
    `[import:tt38-pl7] Đã nạp ${r.designCount} mã cấp phối Phụ lục VII (bỏ qua ${r.dupCount} mã trùng do lỗi in), ` +
      `${r.resourceCount} tài nguyên vật liệu dùng chung, ${r.materialCount} dòng vật liệu – trạng thái imported_needs_review.`,
  );
  db.close();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();

/**
 * Idempotent import of the official TT 38/2026/TT-BXD norm dataset (data/norms/tt38_2026/) into the
 * `TT38_2026` norm dataset (linked to legal set TT36/2026 – see data/legal/tt36-2026.json normDataset,
 * already the default norm set for TT36/2026 projects).
 *
 * Source: tt38_2026_norms.csv (9.012 mã) + tt38_2026_resources.csv (53.503 dòng hao phí), tách từ các
 * PDF phụ lục có chữ ký (xem data/norms/tt38_2026/README.md và manifest.json).
 *
 * - Norms: upserted with full provenance (appendix, section, work, variant, page, source file, sha256
 *   – the sha256 is cross-checked against manifest.json), status = 'imported_needs_review'.
 * - Resources: a "master" registry deduplicated by normalized (type, name, unit) – e.g. every "Nhân
 *   công nhóm 3" row across all norms collapses into one shared resource, one shared "Xi măng PCB30".
 *   Codes are deterministic (hash of the normalized identity), so re-running this script never creates
 *   duplicates or renumbers existing resources.
 * - Percentage rows ("Vật liệu khác", "Máy khác": unit "%") become percentage rules on the VL/M
 *   subtotal (norm_resources.pct_base) instead of a per-unit consumption – see packages/core/src/calc.ts.
 *
 * Safe to re-run: existing norms/resources are updated in place; norm_resources for this dataset's
 * non-sample rows are fully replaced from the current CSVs so removed/changed consumptions don't linger.
 *
 * Run: npm run import:tt38
 */
import { normalizeText } from '@dutoan/core';
import { config } from '../config.js';
import { openDb } from '../db.js';
import { loadTt38Manifest, loadTt38Norms, loadTt38Resources, manifestKeyFor, tt38ResourceCode, TT38_DATASET } from './tt38-data.js';

function main() {
  const normRows = loadTt38Norms();
  const resRows = loadTt38Resources();
  if (normRows.length < 1000 || resRows.length < 1000) {
    throw new Error(`Dữ liệu TT38/2026 có vẻ chưa đầy đủ (đọc được ${normRows.length} mã, ${resRows.length} dòng hao phí) – kiểm tra lại file CSV.`);
  }
  const manifest = loadTt38Manifest();

  // ---- Resources master: dedupe by normalized (type, name, unit) ----
  const resourceMap = new Map<string, { code: string; type: string; name: string; unit: string }>();
  for (const r of resRows) {
    const type = (r.type ?? '').trim();
    const unit = (r.unit ?? '').trim();
    const name = (r.resource ?? '').trim();
    if (!type || !name) continue;
    const key = `${type}|${normalizeText(name)}|${normalizeText(unit)}`;
    if (!resourceMap.has(key)) resourceMap.set(key, { code: tt38ResourceCode(type, name, unit), type, name, unit });
  }

  const db = openDb(config.dbPath);
  let normCount = 0;
  let normResourceCount = 0;
  let pctCount = 0;

  db.transaction(() => {
    const upsertResource = db.prepare(
      `INSERT INTO resources (code, name, unit, type, base_price, name_search, is_sample) VALUES (?, ?, ?, ?, 0, ?, 0)
       ON CONFLICT(code) DO UPDATE SET name = excluded.name, unit = excluded.unit, type = excluded.type, name_search = excluded.name_search`,
    );
    for (const r of resourceMap.values()) upsertResource.run(r.code, r.name, r.unit, r.type, normalizeText(`${r.code} ${r.name}`));

    const upsertNorm = db.prepare(
      `INSERT INTO norms (dataset, code, name, unit, grp, name_search, is_sample, appendix, section_code, section_title, work, variant, page, source_file, source_sha256, status)
       VALUES (@dataset, @code, @name, @unit, @grp, @name_search, 0, @appendix, @section_code, @section_title, @work, @variant, @page, @source_file, @source_sha256, @status)
       ON CONFLICT(dataset, code) DO UPDATE SET name = excluded.name, unit = excluded.unit, grp = excluded.grp, name_search = excluded.name_search, is_sample = 0,
         appendix = excluded.appendix, section_code = excluded.section_code, section_title = excluded.section_title, work = excluded.work, variant = excluded.variant,
         page = excluded.page, source_file = excluded.source_file, source_sha256 = excluded.source_sha256, status = excluded.status`,
    );
    for (const n of normRows) {
      const code = (n.code ?? '').trim().toUpperCase();
      const name = (n.name ?? '').trim();
      if (!code || !name) continue;
      const mk = manifestKeyFor(n.appendix);
      upsertNorm.run({
        dataset: TT38_DATASET,
        code,
        name,
        unit: (n.unit ?? '').trim(),
        grp: (n.work ?? n.section_title ?? '').trim(),
        name_search: normalizeText(`${code} ${name}`),
        appendix: n.appendix || null,
        section_code: n.section_code || null,
        section_title: n.section_title || null,
        work: n.work || null,
        variant: n.variant || null,
        page: n.page ? Number(n.page) : null,
        source_file: n.source_file || null,
        source_sha256: (mk && manifest.sha256[mk]) || n.source_sha256 || null,
        status: n.status || 'imported_needs_review',
      });
      normCount++;
    }

    // Full replace of this dataset's real (non-sample) norm_resources, so a removed/changed
    // consumption in a newer CSV doesn't linger from a previous run.
    db.prepare(`DELETE FROM norm_resources WHERE dataset = ? AND is_sample = 0`).run(TT38_DATASET);
    const insNR = db.prepare(
      `INSERT INTO norm_resources (dataset, norm_code, resource_code, consumption, is_sample, pct_base) VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT(dataset, norm_code, resource_code) DO UPDATE SET consumption = excluded.consumption, is_sample = 0, pct_base = excluded.pct_base`,
    );
    for (const r of resRows) {
      const normCode = (r.code ?? '').trim().toUpperCase();
      const type = (r.type ?? '').trim();
      const unit = (r.unit ?? '').trim();
      const name = (r.resource ?? '').trim();
      const qty = Number(r.qty);
      if (!normCode || !name || !Number.isFinite(qty)) continue;
      const res = resourceMap.get(`${type}|${normalizeText(name)}|${normalizeText(unit)}`);
      if (!res) continue;
      // "Vật liệu khác" / "Máy khác" (unit "%"): percentage of the norm's VL/M subtotal, not a per-unit consumption.
      const pctBase = unit === '%' && (type === 'VL' || type === 'M') ? type : null;
      insNR.run(TT38_DATASET, normCode, res.code, qty, pctBase);
      normResourceCount++;
      if (pctBase) pctCount++;
    }
  })();

  console.log(
    `[import:tt38] Đã nạp ${normCount} mã định mức, ${resourceMap.size} tài nguyên (VL/NC/M dùng chung), ` +
      `${normResourceCount} dòng hao phí (${pctCount} dòng theo tỷ lệ % trên VL/M) vào bộ ${TT38_DATASET} – trạng thái imported_needs_review.`,
  );
  db.close();
}

main();

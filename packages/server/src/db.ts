import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  building_type TEXT NOT NULL DEFAULT 'dan_dung',
  price_base_date TEXT NOT NULL DEFAULT '',
  vat_rate REAL NOT NULL DEFAULT 8,
  cost_settings TEXT,
  legal_set TEXT NOT NULL DEFAULT 'TT36_2026',
  price_date TEXT,
  gxdtt_tmdt REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  tt_rate REAL
);

CREATE TABLE IF NOT EXISTS estimate_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  norm_code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  quantity REAL NOT NULL DEFAULT 0,
  quantity_formula TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS norms (
  dataset TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  grp TEXT NOT NULL DEFAULT '',
  name_search TEXT NOT NULL DEFAULT '',
  is_sample INTEGER NOT NULL DEFAULT 0,
  -- Provenance (TT 38/2026 import): appendix/section/work breakdown, source PDF page and hash.
  appendix TEXT,
  section_code TEXT,
  section_title TEXT,
  work TEXT,
  variant TEXT,
  page INTEGER,
  source_file TEXT,
  source_sha256 TEXT,
  status TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (dataset, code)
);

CREATE TABLE IF NOT EXISTS resources (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('VL', 'NC', 'M')),
  base_price REAL NOT NULL DEFAULT 0,
  name_search TEXT NOT NULL DEFAULT '',
  is_sample INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS norm_resources (
  dataset TEXT NOT NULL,
  norm_code TEXT NOT NULL,
  resource_code TEXT NOT NULL REFERENCES resources(code),
  consumption REAL NOT NULL,
  is_sample INTEGER NOT NULL DEFAULT 0,
  -- When set ('VL' or 'M'), consumption is a PERCENTAGE of the norm's pre-percentage VL/M subtotal
  -- (e.g. "Vật liệu khác 10%", "Máy khác 5%" – TT 38/2026) instead of a per-unit consumption.
  pct_base TEXT,
  PRIMARY KEY (dataset, norm_code, resource_code),
  FOREIGN KEY (dataset, norm_code) REFERENCES norms(dataset, code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rate_table_status (
  legal_set TEXT NOT NULL,
  table_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'provisional' CHECK (status IN ('provisional', 'verified')),
  interpolation TEXT CHECK (interpolation IN ('none', 'linear')),
  verified_by TEXT,
  verified_at TEXT,
  note TEXT,
  PRIMARY KEY (legal_set, table_id)
);

CREATE TABLE IF NOT EXISTS project_prices (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resource_code TEXT NOT NULL,
  price REAL NOT NULL,
  PRIMARY KEY (project_id, resource_code)
);

CREATE TABLE IF NOT EXISTS assistant_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  action_json TEXT NOT NULL,
  undo_json TEXT NOT NULL,
  undone INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS price_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region TEXT NOT NULL,
  sub_area TEXT,
  issuer TEXT NOT NULL DEFAULT '',
  doc_number TEXT NOT NULL DEFAULT '',
  doc_date TEXT,
  period_type TEXT NOT NULL CHECK (period_type IN ('month', 'quarter', 'year')),
  period_year INTEGER NOT NULL,
  period_value INTEGER,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  book_type TEXT NOT NULL CHECK (book_type IN ('VL', 'NC', 'M', 'TH')),
  vat TEXT NOT NULL DEFAULT 'unknown' CHECK (vat IN ('included', 'excluded', 'unknown')),
  vat_rate REAL,
  delivery TEXT,
  source_url TEXT,
  source_file TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'verified')),
  note TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_by TEXT,
  verified_at TEXT
);

CREATE TABLE IF NOT EXISTS price_book_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES price_books(id) ON DELETE CASCADE,
  resource_code TEXT,
  raw_code TEXT,
  name TEXT NOT NULL,
  spec TEXT,
  unit TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL,
  sub_area TEXT,
  source_row INTEGER,
  match_status TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('matched', 'unmatched', 'manual', 'ignored')),
  match_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_price_book_rows_book ON price_book_rows(book_id);
CREATE INDEX IF NOT EXISTS idx_price_book_rows_res ON price_book_rows(resource_code);

-- Source register of suppliers cited in a metadata-only price book notice (no price rows yet), e.g.
-- "Công bố giá VLXD TP. Hồ Chí Minh tháng 6/2026": material group, supplier and their reference letter.
CREATE TABLE IF NOT EXISTS price_book_suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES price_books(id) ON DELETE CASCADE,
  group_no TEXT NOT NULL,
  group_name TEXT NOT NULL,
  item_no TEXT,
  supplier TEXT NOT NULL,
  reference TEXT,
  status TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_price_book_suppliers_book ON price_book_suppliers(book_id);

-- Update 3 C: audit log of regional price / norm updates (undoable; never applied to approved projects).
CREATE TABLE IF NOT EXISTS estimate_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  description TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  total_before REAL,
  total_after REAL,
  snapshot_json TEXT NOT NULL,
  undone_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_estimate_revisions_project ON estimate_revisions(project_id);

CREATE TABLE IF NOT EXISTS project_price_books (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES price_books(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('VL', 'NC', 'M')),
  priority INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (project_id, book_id, resource_type)
);

CREATE TABLE IF NOT EXISTS quantity_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES estimate_items(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  expression TEXT NOT NULL,
  variables_json TEXT NOT NULL DEFAULT '{}',
  sign INTEGER NOT NULL DEFAULT 1 CHECK (sign IN (1, -1)),
  unit TEXT,
  result REAL,
  factor REAL,
  source_reference TEXT
);
CREATE INDEX IF NOT EXISTS idx_quantity_lines_item ON quantity_lines(item_id);

CREATE TABLE IF NOT EXISTS project_transport_legs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resource_code TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  from_location TEXT NOT NULL DEFAULT '',
  to_location TEXT NOT NULL DEFAULT '',
  road_class TEXT,
  distance REAL NOT NULL DEFAULT 0,
  freight_rate REAL NOT NULL DEFAULT 0,
  load_factor REAL NOT NULL DEFAULT 1,
  weight_factor REAL NOT NULL DEFAULT 1,
  handling REAL NOT NULL DEFAULT 0,
  toll REAL NOT NULL DEFAULT 0,
  note TEXT
);

CREATE TABLE IF NOT EXISTS import_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('estimate', 'pricebook')),
  fingerprint TEXT NOT NULL,
  header_rows INTEGER NOT NULL DEFAULT 1,
  mapping_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (kind, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_items_category ON estimate_items(category_id);
CREATE INDEX IF NOT EXISTS idx_categories_project ON categories(project_id);

-- TT 38/2026 Phụ lục VII – cấp phối vật liệu (mix design): expands a "Vữa..." resource into
-- cement/sand/stone/water, selectable per estimate item (see packages/core/src/mixdesign.ts).
CREATE TABLE IF NOT EXISTS mix_designs (
  code TEXT PRIMARY KEY,
  section TEXT NOT NULL DEFAULT '',
  spec TEXT,
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('concrete', 'mortar', 'other')),
  grade TEXT,
  page INTEGER,
  status TEXT NOT NULL DEFAULT 'imported_needs_review',
  raw_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_mix_designs_kind_grade ON mix_designs(kind, grade);

CREATE TABLE IF NOT EXISTS mix_design_materials (
  mix_code TEXT NOT NULL REFERENCES mix_designs(code) ON DELETE CASCADE,
  material TEXT NOT NULL,
  unit TEXT NOT NULL,
  qty REAL NOT NULL,
  resource_code TEXT REFERENCES resources(code),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (mix_code, material, unit)
);
`;

const columns = (db: DB, table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

/**
 * Upgrade a Phase 1 database in place:
 * - projects get a legal set; existing projects are pinned to the historical TT11/2021 set so
 *   their results do not change silently;
 * - norms become versioned by dataset (existing norms → TT12_2021) instead of being overwritten.
 */
export function migrate(db: DB): void {
  const pcols = columns(db, 'projects');
  if (!pcols.includes('legal_set')) {
    db.exec(`ALTER TABLE projects ADD COLUMN legal_set TEXT`);
    db.exec(`UPDATE projects SET legal_set = 'TT11_2021' WHERE legal_set IS NULL`);
  }
  if (!pcols.includes('price_date')) db.exec(`ALTER TABLE projects ADD COLUMN price_date TEXT`);
  // Update 2
  if (!columns(db, 'projects').includes('gxdtt_tmdt')) db.exec(`ALTER TABLE projects ADD COLUMN gxdtt_tmdt REAL`);
  if (!columns(db, 'categories').includes('tt_rate')) db.exec(`ALTER TABLE categories ADD COLUMN tt_rate REAL`);
  const icols = columns(db, 'estimate_items');
  const itemCols: [string, string][] = [
    ['code_status', "TEXT NOT NULL DEFAULT ''"],
    ['code_confidence', 'REAL'],
    ['source_file', 'TEXT'],
    ['source_sheet', 'TEXT'],
    ['source_row', 'INTEGER'],
    ['source_description', 'TEXT'],
    ['source_quantity', 'REAL'],
    ['source_unit', 'TEXT'],
    ['source_code', 'TEXT'],
    // Section F
    ['source_raw_text', 'TEXT'],
    ['source_flags', 'TEXT'],
    ['pricing_method', "TEXT NOT NULL DEFAULT 'NORM_BASED'"],
    ['custom_vl', 'REAL'],
    ['custom_nc', 'REAL'],
    ['custom_m', 'REAL'],
    ['price_source', 'TEXT'],
    ['quote_supplier', 'TEXT'],
    ['quote_no', 'TEXT'],
    ['quote_date', 'TEXT'],
    ['quote_valid_until', 'TEXT'],
    ['quote_vat', 'TEXT'],
    ['quote_vat_rate', 'REAL'],
    ['quantity_source', "TEXT NOT NULL DEFAULT 'MANUAL'"],
    ['mix_code', 'TEXT'],
    // Update 3 B – code mapping of imported items
    ['norm_code_raw', 'TEXT'],
    ['code_check', 'TEXT'],
    ['code_check_note', 'TEXT'],
    ['source_cells', 'TEXT'],
  ];
  for (const [c, t] of itemCols) if (!icols.includes(c)) db.exec(`ALTER TABLE estimate_items ADD COLUMN ${c} ${t}`);
  db.exec(`UPDATE estimate_items SET code_status = 'manual' WHERE code_status = '' AND norm_code <> ''`);
  const pc = columns(db, 'projects');
  if (!pc.includes('status')) db.exec(`ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'`);
  if (!pc.includes('approved_by')) db.exec(`ALTER TABLE projects ADD COLUMN approved_by TEXT`);
  if (!pc.includes('approved_at')) db.exec(`ALTER TABLE projects ADD COLUMN approved_at TEXT`);
  // Section F – data-contract fields for price books and rows
  const bcols = columns(db, 'price_books');
  const bookCols: [string, string][] = [
    ['jurisdiction_at_issue', 'TEXT'],
    ['source_file_url', 'TEXT'],
    ['source_sha256', 'TEXT'],
    ['verification_status', "TEXT NOT NULL DEFAULT 'not_verified'"],
    ['transport_included', "TEXT NOT NULL DEFAULT 'unknown'"],
    ['work_type', 'TEXT'],
  ];
  for (const [c, t] of bookCols) if (!bcols.includes(c)) db.exec(`ALTER TABLE price_books ADD COLUMN ${c} ${t}`);
  db.exec(`UPDATE price_books SET verification_status = 'verified' WHERE status = 'verified' AND verification_status <> 'verified'`);
  const rcols = columns(db, 'price_book_rows');
  const rowCols: [string, string][] = [
    ['description_original', 'TEXT'],
    ['unit_original', 'TEXT'],
    ['value_original', 'TEXT'],
    ['vat_status', 'TEXT'],
    ['source_locator', 'TEXT'],
    ['commercial_terms', 'TEXT'],
    ['normalization_formula', 'TEXT'],
    ['verification_status', "TEXT NOT NULL DEFAULT 'needs_review'"],
    ['notes', 'TEXT'],
    ['work_type', 'TEXT'],
  ];
  for (const [c, t] of rowCols) if (!rcols.includes(c)) db.exec(`ALTER TABLE price_book_rows ADD COLUMN ${c} ${t}`);
  if (!pc.includes('region')) db.exec(`ALTER TABLE projects ADD COLUMN region TEXT`);
  if (!pc.includes('auto_price_update')) db.exec(`ALTER TABLE projects ADD COLUMN auto_price_update INTEGER NOT NULL DEFAULT 0`);
  if (!pc.includes('sub_area')) db.exec(`ALTER TABLE projects ADD COLUMN sub_area TEXT`);

  if (!columns(db, 'norms').includes('dataset')) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`ALTER TABLE norm_resources RENAME TO norm_resources_v1`);
      db.exec(`ALTER TABLE norms RENAME TO norms_v1`);
      db.exec(SCHEMA);
      db.exec(`INSERT INTO norms (dataset, code, name, unit, grp, name_search, is_sample)
               SELECT 'TT12_2021', code, name, unit, grp, name_search, is_sample FROM norms_v1`);
      db.exec(`INSERT INTO norm_resources (dataset, norm_code, resource_code, consumption, is_sample)
               SELECT 'TT12_2021', norm_code, resource_code, consumption, is_sample FROM norm_resources_v1`);
      db.exec(`DROP TABLE norm_resources_v1`);
      db.exec(`DROP TABLE norms_v1`);
    })();
    db.pragma('foreign_keys = ON');
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_norm_resources_norm ON norm_resources(dataset, norm_code)`);

  // TT 38/2026 import – norm provenance columns and percentage-rule resources ("Vật liệu khác"/"Máy khác").
  const ncols = columns(db, 'norms');
  const normCols: [string, string][] = [
    ['appendix', 'TEXT'],
    ['section_code', 'TEXT'],
    ['section_title', 'TEXT'],
    ['work', 'TEXT'],
    ['variant', 'TEXT'],
    ['page', 'INTEGER'],
    ['source_file', 'TEXT'],
    ['source_sha256', 'TEXT'],
    ['status', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [c, t] of normCols) if (!ncols.includes(c)) db.exec(`ALTER TABLE norms ADD COLUMN ${c} ${t}`);
  if (!columns(db, 'norm_resources').includes('pct_base')) db.exec(`ALTER TABLE norm_resources ADD COLUMN pct_base TEXT`);
}

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

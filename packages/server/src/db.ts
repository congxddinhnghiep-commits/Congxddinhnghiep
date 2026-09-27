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

CREATE INDEX IF NOT EXISTS idx_items_category ON estimate_items(category_id);
CREATE INDEX IF NOT EXISTS idx_categories_project ON categories(project_id);
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

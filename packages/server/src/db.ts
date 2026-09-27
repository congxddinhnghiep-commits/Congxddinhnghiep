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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
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
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  grp TEXT NOT NULL DEFAULT '',
  name_search TEXT NOT NULL DEFAULT '',
  is_sample INTEGER NOT NULL DEFAULT 0
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
  norm_code TEXT NOT NULL REFERENCES norms(code) ON DELETE CASCADE,
  resource_code TEXT NOT NULL REFERENCES resources(code),
  consumption REAL NOT NULL,
  is_sample INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (norm_code, resource_code)
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
CREATE INDEX IF NOT EXISTS idx_norm_resources_norm ON norm_resources(norm_code);
`;

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

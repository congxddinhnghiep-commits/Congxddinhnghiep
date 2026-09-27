import fs from 'node:fs';
import path from 'node:path';
import type { LegalDocument, LegalSet, LegalSetId, RateStatus } from '@dutoan/core';
import { DATA_DIR } from './config.js';
import type { DB } from './db.js';
import { HttpError } from './repo.js';

const FILES: Record<LegalSetId, string> = { TT36_2026: 'tt36-2026.json', TT11_2021: 'tt11-2021.json' };
export const LEGAL_SET_IDS = Object.keys(FILES) as LegalSetId[];

let fileCache: Record<string, LegalSet> | null = null;
let docCache: { checkedAt: string; note: string; documents: LegalDocument[] } | null = null;

function readSets(): Record<string, LegalSet> {
  if (!fileCache) {
    fileCache = {};
    for (const [id, f] of Object.entries(FILES)) fileCache[id] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'legal', f), 'utf8'));
  }
  return fileCache;
}

export function legalDocuments() {
  if (!docCache) {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'legal', 'documents.json'), 'utf8'));
    docCache = { checkedAt: raw.checkedAt, note: raw._note, documents: raw.documents };
  }
  return docCache;
}

interface StatusRow {
  legal_set: string;
  table_id: string;
  status: RateStatus;
  interpolation: 'none' | 'linear' | null;
  verified_by: string | null;
  verified_at: string | null;
}

/** Rate tables come from data files; review status and interpolation choice are stored in the database. */
export class LegalService {
  constructor(private db: DB) {}

  isLegalSet(id: unknown): id is LegalSetId {
    return typeof id === 'string' && (LEGAL_SET_IDS as string[]).includes(id);
  }

  get(id: LegalSetId): LegalSet {
    const base = readSets()[id];
    if (!base) throw new HttpError(404, 'Không có bộ pháp lý này');
    const set: LegalSet = structuredClone(base);
    const rows = this.db.prepare('SELECT * FROM rate_table_status WHERE legal_set = ?').all(id) as StatusRow[];
    for (const r of rows) {
      const t = set.tables[r.table_id];
      if (!t) continue;
      t.status = r.status;
      if (r.interpolation) t.interpolation = r.interpolation;
      t.verifiedBy = r.verified_by;
      t.verifiedAt = r.verified_at;
    }
    return set;
  }

  all(): LegalSet[] {
    return LEGAL_SET_IDS.map((id) => this.get(id));
  }

  hasProvisional(id: LegalSetId): boolean {
    return Object.values(this.get(id).tables).some((t) => t.status !== 'verified');
  }

  setTableStatus(id: LegalSetId, tableId: string, patch: { status?: RateStatus; interpolation?: 'none' | 'linear' }, user: string): void {
    const set = this.get(id);
    const t = set.tables[tableId];
    if (!t) throw new HttpError(404, 'Không có bảng tỷ lệ này');
    const status = patch.status ?? t.status;
    const interpolation = patch.interpolation ?? t.interpolation;
    const verified = status === 'verified';
    this.db
      .prepare(
        `INSERT INTO rate_table_status (legal_set, table_id, status, interpolation, verified_by, verified_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(legal_set, table_id) DO UPDATE SET status = excluded.status, interpolation = excluded.interpolation,
         verified_by = excluded.verified_by, verified_at = excluded.verified_at`,
      )
      .run(id, tableId, status, interpolation, verified ? (patch.status ? user : t.verifiedBy ?? user) : null, verified ? (patch.status ? new Date().toISOString() : t.verifiedAt ?? new Date().toISOString()) : null);
  }
}

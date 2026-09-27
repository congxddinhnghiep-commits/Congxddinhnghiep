/**
 * Shared CSV loader for the TT 38/2026 norm dataset (data/norms/tt38_2026/), used by the import
 * script (import-tt38.ts) and by tests that need to index the real 9.012 codes (e.g. suggest.test.ts).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { normalizeText } from '@dutoan/core';
import { ROOT_DIR } from '../config.js';

export const TT38_DATASET = 'TT38_2026';
export const TT38_SRC_DIR = path.join(ROOT_DIR, 'data/norms/tt38_2026');

export interface Tt38NormRow {
  appendix: string;
  code: string;
  section_code: string;
  section_title: string;
  work: string;
  variant: string;
  name: string;
  unit: string;
  page: string;
  source_file: string;
  source_sha256: string;
  status: string;
}

export interface Tt38ResourceRow {
  code: string;
  type: string;
  resource: string;
  unit: string;
  qty: string;
}

function readCsv<T>(file: string): T[] {
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const parsed = Papa.parse<T>(raw, { header: true, skipEmptyLines: true });
  const fatal = parsed.errors.filter((e) => e.code !== 'TooFewFields' && e.code !== 'TooManyFields');
  if (fatal.length) throw new Error(`Lỗi đọc ${path.basename(file)}: ${JSON.stringify(fatal.slice(0, 3))}`);
  return parsed.data;
}

export function loadTt38Norms(): Tt38NormRow[] {
  return readCsv<Tt38NormRow>(path.join(TT38_SRC_DIR, 'tt38_2026_norms.csv'));
}

export function loadTt38Resources(): Tt38ResourceRow[] {
  return readCsv<Tt38ResourceRow>(path.join(TT38_SRC_DIR, 'tt38_2026_resources.csv'));
}

export function loadTt38Manifest(): { sha256: Record<string, string> } {
  return JSON.parse(fs.readFileSync(path.join(TT38_SRC_DIR, 'manifest.json'), 'utf8'));
}

/** "Phụ lục II" → "PL2", to cross-check source_sha256 against manifest.json. */
const ROMAN_TO_NUM: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };
export function manifestKeyFor(appendix: string): string | null {
  const m = /Phụ lục\s+([IVX]+)/i.exec(appendix || '');
  const n = m && ROMAN_TO_NUM[m[1].toUpperCase()];
  return n ? `PL${n}` : null;
}

/** Deterministic, collision-free resource code from its normalized identity (idempotent across re-runs). */
export function tt38ResourceCode(type: string, name: string, unit: string): string {
  const hash = crypto.createHash('sha1').update(normalizeText(`${name}|${unit}`)).digest('hex').slice(0, 10);
  const slug = normalizeText(name).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 18) || 'X';
  return `${type}.${slug}.${hash}`;
}

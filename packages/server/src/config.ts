import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repository root (works from src/ with tsx and from dist/ after build). */
export const ROOT_DIR = path.resolve(here, '../../..');
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT_DIR, 'data');
export const WEB_DIST = path.join(ROOT_DIR, 'packages/web/dist');

const isProd = process.env.NODE_ENV === 'production';

function jwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  // Persist a random secret so tokens survive restarts on a personal computer.
  const file = path.join(DATA_DIR, '.jwt-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(48).toString('hex');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  }
}

export const config = {
  port: Number(process.env.PORT || 3000),
  isProd,
  dbPath: process.env.DB_PATH || path.join(DATA_DIR, 'dutoan.db'),
  jwtSecret: jwtSecret(),
  jwtExpiresIn: '12h',
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPass: process.env.ADMIN_PASS || (isProd ? '' : 'admin123'),
  /** Allow importing by absolute local path (only for personal-computer installs). */
  localMode: process.env.LOCAL_MODE ? process.env.LOCAL_MODE === 'true' : !isProd,
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    apiKey: process.env.GOOGLE_API_KEY || '',
    appId: process.env.GOOGLE_APP_ID || '',
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
  },
};

import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { normalizeText } from '@dutoan/core';
import type { DB } from './db.js';
import { SAMPLE_NORMS, SAMPLE_RESOURCES } from './seed-data.js';

export function seedAdmin(db: DB, username: string, password: string): void {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (count > 0) return;
  let pass = password;
  if (!pass) {
    pass = crypto.randomBytes(9).toString('base64url');
    console.warn(`[seed] ADMIN_PASS chưa đặt – mật khẩu tạm cho "${username}": ${pass}`);
  }
  db.prepare(
    `INSERT INTO users (username, password_hash, full_name, role, must_change_password) VALUES (?, ?, ?, 'admin', 1)`,
  ).run(username, bcrypt.hashSync(pass, 10), 'Quản trị viên');
  console.log(`[seed] Đã tạo tài khoản quản trị "${username}" (bắt buộc đổi mật khẩu khi đăng nhập lần đầu).`);
}

/** Insert sample norms/resources once (skipped if any norm exists). */
export function seedSampleData(db: DB): void {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM norms').get() as { n: number }).n;
  if (count > 0) return;
  const insRes = db.prepare(
    `INSERT OR IGNORE INTO resources (code, name, unit, type, base_price, name_search, is_sample) VALUES (?, ?, ?, ?, ?, ?, 1)`,
  );
  const insNorm = db.prepare(
    `INSERT OR IGNORE INTO norms (code, name, unit, grp, name_search, is_sample) VALUES (?, ?, ?, ?, ?, 1)`,
  );
  const insNR = db.prepare(
    `INSERT OR IGNORE INTO norm_resources (norm_code, resource_code, consumption, is_sample) VALUES (?, ?, ?, 1)`,
  );
  db.transaction(() => {
    for (const [code, name, unit, type, price] of SAMPLE_RESOURCES) {
      insRes.run(code, name, unit, type, price, normalizeText(`${code} ${name}`));
    }
    for (const [code, name, unit, group, res] of SAMPLE_NORMS) {
      insNorm.run(code, name, unit, group, normalizeText(`${code} ${name}`));
      for (const [rc, c] of res) insNR.run(code, rc, c);
    }
  })();
  console.log(`[seed] Đã nạp ${SAMPLE_NORMS.length} định mức MẪU và ${SAMPLE_RESOURCES.length} tài nguyên MẪU.`);
}

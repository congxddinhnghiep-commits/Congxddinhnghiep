import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { normalizeText } from '@dutoan/core';
import type { DB } from './db.js';
import { LABOUR_TT12, LABOUR_TT38, SAMPLE_RESOURCES, sampleNorms } from './seed-data.js';

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

/** Insert sample norms per dataset (skipped for a dataset that already has norms). Resources are shared. */
export function seedSampleData(db: DB): void {
  const insRes = db.prepare(
    `INSERT OR IGNORE INTO resources (code, name, unit, type, base_price, name_search, is_sample) VALUES (?, ?, ?, ?, ?, ?, 1)`,
  );
  const insNorm = db.prepare(
    `INSERT OR IGNORE INTO norms (dataset, code, name, unit, grp, name_search, is_sample) VALUES (?, ?, ?, ?, ?, ?, 1)`,
  );
  const insNR = db.prepare(
    `INSERT OR IGNORE INTO norm_resources (dataset, norm_code, resource_code, consumption, is_sample) VALUES (?, ?, ?, ?, 1)`,
  );
  const datasets: [string, ReturnType<typeof sampleNorms>][] = [
    ['TT38_2026', sampleNorms(LABOUR_TT38)],
    ['TT12_2021', sampleNorms(LABOUR_TT12)],
  ];
  db.transaction(() => {
    for (const [code, name, unit, type, price] of SAMPLE_RESOURCES) {
      insRes.run(code, name, unit, type, price, normalizeText(`${code} ${name}`));
    }
    for (const [dataset, norms] of datasets) {
      const count = (db.prepare('SELECT COUNT(*) AS n FROM norms WHERE dataset = ?').get(dataset) as { n: number }).n;
      if (count > 0) continue;
      for (const [code, name, unit, group, res] of norms) {
        insNorm.run(dataset, code, name, unit, group, normalizeText(`${code} ${name}`));
        for (const [rc, c] of res) insNR.run(dataset, code, rc, c);
      }
      console.log(`[seed] Đã nạp ${norms.length} định mức MẪU cho bộ ${dataset}.`);
    }
  })();
}

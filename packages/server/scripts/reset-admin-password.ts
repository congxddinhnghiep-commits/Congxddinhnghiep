/**
 * Reset the password of an EXISTING user (default "admin") and force a password change at the next login.
 * Only that user's password hash and must-change flag are updated – no other user or data is touched.
 *
 * Usage (back up data/dutoan.db first):
 *   RESET_PASSWORD='<new password>' npm run reset:admin-password            # user "admin"
 *   RESET_PASSWORD='<new password>' npm run reset:admin-password -- --user ketoan
 *   npm run reset:admin-password -- --password '<new password>'
 * The password comes from --password, else RESET_PASSWORD, else ADMIN_PASS (the documented first-login default in
 * .env.example). It is never printed. DB path: DB_PATH or the app's default (data/dutoan.db).
 */
import { resetUserPassword } from '../src/auth.js';
import { config } from '../src/config.js';
import { openDb } from '../src/db.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const username = arg('user') ?? process.env.ADMIN_USER ?? 'admin';
const password = arg('password') ?? process.env.RESET_PASSWORD ?? process.env.ADMIN_PASS;
if (!password) {
  console.error('Thiếu mật khẩu mới: dùng --password, biến RESET_PASSWORD hoặc ADMIN_PASS.');
  process.exit(1);
}

const db = openDb(config.dbPath);
try {
  const user = resetUserPassword(db, username, password);
  const total = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  console.log(`Đã đặt lại mật khẩu cho "${user.username}" – bắt buộc đổi mật khẩu khi đăng nhập: ${user.mustChangePassword ? 'có' : 'không'}. Số tài khoản: ${total}.`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}

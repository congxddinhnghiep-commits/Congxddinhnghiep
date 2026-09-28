// Seeds an E2E database: real TT38_2026 norms (via the import script) + two verified HCM price books with rows.
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
const db = new Database(process.env.DB_PATH);
const res = (name, type) =>
  db.prepare("SELECT r.code FROM norm_resources nr JOIN resources r ON r.code = nr.resource_code WHERE nr.dataset='TT38_2026' AND nr.norm_code='AF.11110' AND r.name = ? AND r.type = ?").get(name, type).code;
function book(type, month, rows) {
  const id = Number(
    db
      .prepare(
        `INSERT INTO price_books (region, issuer, doc_number, doc_date, period_type, period_year, period_value, period_start, period_end, book_type, vat, status, verification_status, created_by, verified_by, verified_at)
         VALUES ('TP. Hồ Chí Minh', 'Sở Xây dựng', ?, '2026-09-01', 'month', 2026, ?, ?, ?, ?, 'excluded', 'verified', 'verified', 'e2e', 'e2e', datetime('now'))`,
      )
      .run(`E2E-${type}-${month}`, month, `2026-${String(month).padStart(2, '0')}-01`, `2026-${String(month).padStart(2, '0')}-28`, type).lastInsertRowid,
  );
  const ins = db.prepare(`INSERT INTO price_book_rows (book_id, resource_code, name, unit, price, match_status, verification_status) VALUES (?, ?, ?, ?, ?, 'matched', 'verified')`);
  for (const [code, name, unit, price] of rows) ins.run(id, code, name, unit, price);
}
book('VL', 8, [[res('Vữa bê tông', 'VL'), 'Vữa bê tông', 'm3', 1_200_000]]);
book('NC', 8, [[res('Nhân công nhóm 2', 'NC'), 'Nhân công nhóm 2', 'công', 400_000]]);
db.prepare("INSERT OR IGNORE INTO users (username, password_hash, full_name, role, must_change_password) VALUES ('admin', ?, 'E2E', 'admin', 0)").run(bcrypt.hashSync('admin123', 10));
console.log('seeded');

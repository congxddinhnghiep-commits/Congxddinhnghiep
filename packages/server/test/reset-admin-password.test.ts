import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { AuthService, resetUserPassword } from '../src/auth.js';
import { openDb } from '../src/db.js';
import { seedAdmin } from '../src/seed.js';

// Forgotten admin password: reset ONE existing user, force a change at next login, touch nothing else.
describe('resetUserPassword', () => {
  const setup = () => {
    const db = openDb(':memory:');
    seedAdmin(db, 'admin', 'admin123');
    const auth = new AuthService(db, 'test-secret', '1h');
    const admin = auth.listUsers()[0];
    auth.changePassword(admin.id, 'admin123', 'Forgotten2026!'); // the owner changed it and then forgot it
    const other = auth.createUser('ketoan', 'KeToan2026!', 'Kế toán', 'user');
    auth.changePassword(other.id, 'KeToan2026!', 'KeToanMoi2026!');
    return { db, auth };
  };

  it('restores the default password with must-change ON, leaving other users untouched', () => {
    const { db, auth } = setup();
    const before = db.prepare("SELECT * FROM users WHERE username = 'ketoan'").get();
    const u = resetUserPassword(db, 'admin', 'admin123');
    expect(u).toMatchObject({ username: 'admin', role: 'admin', mustChangePassword: true });
    const login = auth.login('admin', 'admin123');
    expect(login.user.mustChangePassword).toBe(true);
    expect(() => auth.login('admin', 'Forgotten2026!')).toThrow();
    expect(db.prepare("SELECT * FROM users WHERE username = 'ketoan'").get()).toEqual(before);
    expect(auth.listUsers()).toHaveLength(2);
    const hash = (db.prepare("SELECT password_hash FROM users WHERE username = 'admin'").get() as { password_hash: string }).password_hash;
    expect(hash).not.toContain('admin123');
    expect(bcrypt.compareSync('admin123', hash)).toBe(true);
  });

  it('never creates a user and rejects a too-short password', () => {
    const { db, auth } = setup();
    expect(() => resetUserPassword(db, 'khongco', 'admin123')).toThrow(/Không tìm thấy/);
    expect(() => resetUserPassword(db, 'admin', 'short')).toThrow(/tối thiểu/);
    expect(auth.listUsers()).toHaveLength(2);
    expect(auth.login('admin', 'Forgotten2026!').user.mustChangePassword).toBe(false);
  });
});

import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { DB } from './db.js';
import { HttpError } from './repo.js';

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  role: 'admin' | 'user';
  mustChangePassword: boolean;
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  full_name: string;
  role: 'admin' | 'user';
  must_change_password: number;
}

const toUser = (r: UserRow): AuthUser => ({
  id: r.id,
  username: r.username,
  fullName: r.full_name,
  role: r.role,
  mustChangePassword: !!r.must_change_password,
});

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export const MIN_PASSWORD = 8;

export class AuthService {
  constructor(
    private db: DB,
    private secret: string,
    private expiresIn: string,
  ) {}

  login(username: string, password: string): { token: string; user: AuthUser } {
    const r = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as UserRow | undefined;
    if (!r || !bcrypt.compareSync(password, r.password_hash)) throw new HttpError(401, 'Sai tên đăng nhập hoặc mật khẩu');
    const user = toUser(r);
    return { token: this.sign(user), user };
  }

  sign(user: AuthUser): string {
    return jwt.sign({ sub: String(user.id) }, this.secret, { expiresIn: this.expiresIn } as jwt.SignOptions);
  }

  getUser(id: number): AuthUser | undefined {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return r && toUser(r);
  }

  listUsers(): AuthUser[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY id').all() as UserRow[]).map(toUser);
  }

  createUser(username: string, password: string, fullName: string, role: 'admin' | 'user'): AuthUser {
    if (!/^[\w.@-]{3,40}$/.test(username)) throw new HttpError(400, 'Tên đăng nhập 3–40 ký tự (chữ, số, . _ - @)');
    if (password.length < MIN_PASSWORD) throw new HttpError(400, `Mật khẩu tối thiểu ${MIN_PASSWORD} ký tự`);
    const exists = this.db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
    if (exists) throw new HttpError(409, 'Tên đăng nhập đã tồn tại');
    const info = this.db
      .prepare('INSERT INTO users (username, password_hash, full_name, role, must_change_password) VALUES (?, ?, ?, ?, 1)')
      .run(username, bcrypt.hashSync(password, 10), fullName, role);
    return this.getUser(Number(info.lastInsertRowid))!;
  }

  changePassword(userId: number, oldPassword: string, newPassword: string): AuthUser {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;
    if (!bcrypt.compareSync(oldPassword, r.password_hash)) throw new HttpError(400, 'Mật khẩu hiện tại không đúng');
    if (newPassword.length < MIN_PASSWORD) throw new HttpError(400, `Mật khẩu mới tối thiểu ${MIN_PASSWORD} ký tự`);
    if (newPassword === oldPassword) throw new HttpError(400, 'Mật khẩu mới phải khác mật khẩu cũ');
    this.db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), userId);
    return this.getUser(userId)!;
  }

  /** Express middleware: requires a valid Bearer token. */
  middleware = (req: Request, _res: Response, next: NextFunction) => {
    const h = req.headers.authorization;
    const token = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
    if (!token) return next(new HttpError(401, 'Chưa đăng nhập'));
    try {
      const payload = jwt.verify(token, this.secret) as { sub: string };
      const user = this.getUser(Number(payload.sub));
      if (!user) return next(new HttpError(401, 'Tài khoản không tồn tại'));
      req.user = user;
      next();
    } catch {
      next(new HttpError(401, 'Phiên đăng nhập đã hết hạn'));
    }
  };
}

/** Blocks everything except password change until the user replaced the initial password. */
export function requirePasswordChanged(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.mustChangePassword) return next(new HttpError(403, 'Bạn cần đổi mật khẩu trước khi tiếp tục'));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') return next(new HttpError(403, 'Chỉ quản trị viên được thực hiện'));
  next();
}

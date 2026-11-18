// 登录：Google（设置 GOOGLE_CLIENT_ID 后出现），或者用户名 + 密码。
// 会话尽量长：cookie 400 天（浏览器允许的上限），每天用到时自动续期；只有主动退出才失效。
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import type { Db, Q } from './db';

export const COOKIE = 'dld_sid';
const MAX_AGE_MS = 400 * 24 * 3600 * 1000;
const RENEW_AFTER_MS = 24 * 3600 * 1000;

export interface User {
  id: string;
  name: string;
  avatar: string | null;
  picture: string | null;
  email: string | null;
  username: string | null;
  hasGoogle: boolean;
}

export class AuthError extends Error {
  constructor(msg: string, public status = 400) { super(msg); }
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const userCols = 'id, name, avatar, picture, email, username, google_sub is not null as "hasGoogle"';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const cleanName = (n: unknown) => String(n ?? '').trim().replace(/\s+/g, ' ').slice(0, 12);

// ---- 密码 ----
function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function checkPassword(pw: string, stored: string | null): boolean {
  if (!stored) return false;
  const [, salt, hash] = stored.split('$');
  const want = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), want.length);
  return crypto.timingSafeEqual(want, got);
}

// ---- Google ID token（不用第三方库，直接用 Google 公布的公钥验签） ----
let googleKeys: { keys: (JsonWebKey & { kid: string })[]; until: number } | null = null;
async function googleKey(kid: string) {
  if (!googleKeys || googleKeys.until < Date.now() || !googleKeys.keys.some((k) => k.kid === kid)) {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    const maxAge = Number(/max-age=(\d+)/.exec(r.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    googleKeys = { keys: (await r.json()).keys, until: Date.now() + maxAge * 1000 };
  }
  return googleKeys.keys.find((k) => k.kid === kid) ?? null;
}

export interface GoogleProfile { sub: string; email: string | null; name: string; picture: string | null }

export async function verifyGoogle(credential: string, clientId: string): Promise<GoogleProfile> {
  const parts = String(credential).split('.');
  if (parts.length !== 3) throw new AuthError('Google 登录失败');
  const dec = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
  const header = dec(parts[0]);
  const payload = dec(parts[1]);
  const jwk = await googleKey(header.kid);
  if (!jwk || header.alg !== 'RS256') throw new AuthError('Google 登录失败');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new AuthError('Google 登录失败');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) throw new AuthError('Google 登录失败');
  if (payload.aud !== clientId) throw new AuthError('Google 登录失败');
  if (Number(payload.exp) * 1000 < Date.now()) throw new AuthError('登录过期了，再试一次');
  return { sub: payload.sub, email: payload.email ?? null, name: cleanName(payload.given_name || payload.name || '玩家') || '玩家', picture: payload.picture ?? null };
}

export class Auth {
  constructor(private db: Db) {}

  async userById(id: string, q: Q = this.db): Promise<User | null> {
    const [u] = await q.query<User>(`select ${userCols} from users where id = $1`, [id]);
    return u ?? null;
  }

  async googleLogin(p: GoogleProfile): Promise<User> {
    const [found] = await this.db.query<{ id: string }>('select id from users where google_sub = $1', [p.sub]);
    if (found) {
      await this.db.query('update users set picture = $2, email = $3 where id = $1', [found.id, p.picture, p.email]);
      return (await this.userById(found.id))!;
    }
    const id = crypto.randomUUID();
    await this.db.query('insert into users (id, name, picture, email, google_sub) values ($1, $2, $3, $4, $5)', [id, p.name, p.picture, p.email, p.sub]);
    return (await this.userById(id))!;
  }

  async register(username: unknown, password: unknown, name: unknown): Promise<User> {
    const u = String(username ?? '').trim();
    const pw = String(password ?? '');
    if (!/^[\p{L}\p{N}_.-]{2,20}$/u.test(u)) throw new AuthError('用户名 2–20 个字，可以用字母、数字、中文、_ . -');
    if (pw.length < 6) throw new AuthError('密码至少 6 位');
    const [taken] = await this.db.query('select 1 from users where lower(username) = lower($1)', [u]);
    if (taken) throw new AuthError('这个用户名已经有人用了');
    const id = crypto.randomUUID();
    await this.db.query('insert into users (id, name, username, password_hash) values ($1, $2, $3, $4)', [id, cleanName(name) || u.slice(0, 12), u, hashPassword(pw)]);
    return (await this.userById(id))!;
  }

  async passwordLogin(username: unknown, password: unknown): Promise<User> {
    const [row] = await this.db.query<{ id: string; password_hash: string | null }>(
      'select id, password_hash from users where lower(username) = lower($1)', [String(username ?? '').trim()],
    );
    if (!row || !checkPassword(String(password ?? ''), row.password_hash)) throw new AuthError('用户名或密码不对', 401);
    return (await this.userById(row.id))!;
  }

  async createSession(userId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    await this.db.query('insert into sessions (token_hash, user_id) values ($1, $2)', [sha(token), userId]);
    return token;
  }

  /** 根据 cookie 找到登录的人；顺便告诉调用方要不要续期 cookie */
  async fromToken(token: string | undefined): Promise<{ user: User; renew: boolean } | null> {
    if (!token) return null;
    const [s] = await this.db.query<{ user_id: string; last_seen: Date }>('select user_id, last_seen from sessions where token_hash = $1', [sha(token)]);
    if (!s) return null;
    const age = Date.now() - new Date(s.last_seen).getTime();
    if (age > MAX_AGE_MS) {
      await this.db.query('delete from sessions where token_hash = $1', [sha(token)]);
      return null;
    }
    const renew = age > RENEW_AFTER_MS;
    if (renew) await this.db.query('update sessions set last_seen = now() where token_hash = $1', [sha(token)]);
    const user = await this.userById(s.user_id);
    return user ? { user, renew } : null;
  }

  async logout(token: string | undefined) {
    if (token) await this.db.query('delete from sessions where token_hash = $1', [sha(token)]);
  }

  async updateProfile(userId: string, patch: { name?: unknown; avatar?: unknown }) {
    if (patch.name !== undefined) {
      const n = cleanName(patch.name);
      if (!n) throw new AuthError('名字不能为空');
      await this.db.query('update users set name = $2 where id = $1', [userId, n]);
    }
    if (patch.avatar !== undefined) {
      const a = patch.avatar === null ? null : String(patch.avatar).slice(0, 8);
      await this.db.query('update users set avatar = $2 where id = $1', [userId, a]);
    }
    return (await this.userById(userId))!;
  }
}

export function setSessionCookie(req: Request, res: Response, token: string) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: MAX_AGE_MS, path: '/' });
}
export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE, { path: '/' });
}

/** 简单的登录频率限制：同一个 IP 每 10 分钟最多 20 次 */
const attempts = new Map<string, { n: number; since: number }>();
export function rateLimit(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.since > 10 * 60_000) { attempts.set(key, { n: 1, since: now }); return; }
  if (++a.n > 20) throw new AuthError('试太多次了，过几分钟再来', 429);
}

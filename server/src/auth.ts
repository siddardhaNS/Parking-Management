import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { get, run } from './db.js';

export const SESSION_COOKIE = 'lw_session';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', token, userId, Date.now() + config.sessionDays * 86_400_000);
  return token;
}

export interface SessionUser {
  id: number;
  username: string;
}

export function sessionUser(token: string | undefined): SessionUser | undefined {
  if (!token) return undefined;
  return get<SessionUser>(
    'SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?',
    token,
    Date.now(),
  );
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

const PUBLIC_PREFIXES = ['/api/auth/', '/api/public/', '/api/v1/'];

/** Every /api route requires a session except auth, the public vacancy feed and the API-key developer API. */
export async function requireSession(req: FastifyRequest, reply: FastifyReply) {
  if (!req.url.startsWith('/api/') || PUBLIC_PREFIXES.some((p) => req.url.startsWith(p))) return;
  const user = sessionUser(req.cookies[SESSION_COOKIE]);
  if (!user) return reply.code(401).send({ error: 'Not signed in' });
  req.user = user;
}

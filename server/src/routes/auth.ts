import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createSession, hashPassword, SESSION_COOKIE, sessionUser, verifyPassword } from '../auth.js';
import { config } from '../config.js';
import { get, run } from '../db.js';

const Credentials = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    maxAge: config.sessionDays * 86_400,
  });
}

export default async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/status', async (req) => {
    const users = get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n;
    return { needsSetup: users === 0, user: sessionUser(req.cookies[SESSION_COOKIE]) ?? null };
  });

  app.post('/api/auth/setup', async (req, reply) => {
    if (get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n > 0) {
      return reply.code(409).send({ error: 'Setup has already been completed' });
    }
    const { username, password } = Credentials.parse(req.body);
    const { lastInsertRowid } = run(
      'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)',
      username,
      hashPassword(password),
      Date.now(),
    );
    setSessionCookie(reply, createSession(Number(lastInsertRowid)));
    return { ok: true };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const { username, password } = z.object({ username: z.string(), password: z.string() }).parse(req.body);
    const user = get<{ id: number; password_hash: string }>('SELECT id, password_hash FROM users WHERE username = ?', username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return reply.code(401).send({ error: 'Invalid username or password' });
    }
    setSessionCookie(reply, createSession(user.id));
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) run('DELETE FROM sessions WHERE token = ?', token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/account/password', async (req, reply) => {
    const body = z
      .object({ current: z.string(), next: z.string().min(8, 'Password must be at least 8 characters') })
      .parse(req.body);
    const user = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', req.user!.id)!;
    if (!verifyPassword(body.current, user.password_hash)) {
      return reply.code(400).send({ error: 'Current password is incorrect' });
    }
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(body.next), req.user!.id);
    return { ok: true };
  });
}

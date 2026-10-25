import fs from 'node:fs';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { alertManager } from './alerts.js';
import { requireSession } from './auth.js';
import { config } from './config.js';
import { engine } from './engine.js';
import { mqttBridge } from './integrations.js';
import alertRoutes from './routes/alerts.js';
import authRoutes from './routes/auth.js';
import historyRoutes from './routes/history.js';
import liveRoutes from './routes/live.js';
import lotRoutes from './routes/lots.js';
import publicRoutes from './routes/public.js';
import settingsRoutes from './routes/settings.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

await app.register(cookie);
await app.register(websocket);

app.addContentTypeParser(/^image\//, { parseAs: 'buffer', bodyLimit: 15 * 1024 * 1024 }, (_req, body, done) => done(null, body));
app.addHook('onRequest', requireSession);

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: err.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ` : '') + i.message).join('; ') });
  }
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  if (status >= 500) app.log.error(err);
  return reply.code(status).send({ error: (err as Error).message });
});

await app.register(authRoutes);
await app.register(lotRoutes);
await app.register(historyRoutes);
await app.register(alertRoutes);
await app.register(settingsRoutes);
await app.register(publicRoutes);
await app.register(liveRoutes);

if (fs.existsSync(config.webDist)) {
  await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
}
app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/') || !fs.existsSync(config.webDist)) return reply.code(404).send({ error: 'Not found' });
  return reply.sendFile('index.html'); // SPA fallback
});

mqttBridge.reconfigure();
engine.start();
alertManager.start();

const shutdown = async () => {
  engine.stop();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashApiKey } from '../auth.js';
import { get, run } from '../db.js';
import { detectVehicles, VEHICLE_CLASSES } from '../detector.js';
import { engine } from '../engine.js';
import { spaceScore } from '../occupancy.js';
import type { LotRow } from '../types.js';

const DetectJson = z.object({
  image: z.string().min(1, 'image (base64) is required'),
  min_confidence: z.number().min(0.05).max(0.95).default(0.3),
  threshold: z.number().min(0.05).max(1).default(0.4),
  spaces: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]),
        polygon: z.array(z.tuple([z.number(), z.number()])).min(3),
      }),
    )
    .default([]),
});

export default async function publicRoutes(app: FastifyInstance) {
  /** Live vacancy feed for websites, apps and digital message boards. CORS-open by design. */
  app.get('/api/public/lots/:slug', async (req, reply) => {
    const { slug } = z.object({ slug: z.string() }).parse(req.params);
    reply.header('Access-Control-Allow-Origin', '*').header('Cache-Control', 'no-store');
    const lot = get<LotRow>('SELECT * FROM lots WHERE slug = ? AND public = 1', slug);
    if (!lot) return reply.code(404).send({ error: 'Lot not found' });
    const s = engine.lotSummary(lot.id);
    return { name: lot.name, slug: lot.slug, total: s.total, occupied: s.occupied, free: s.free, updatedAt: s.updatedAt };
  });

  /**
   * Developer API: stateless single-image occupancy detection.
   * Send a raw image (Content-Type: image/jpeg|png) for detections only, or JSON
   * { image: base64, spaces: [{ id, polygon: [[x,y],...] (normalized 0..1) }] } for per-space occupancy.
   */
  app.post('/api/v1/detect', { bodyLimit: 15 * 1024 * 1024 }, async (req, reply) => {
    const key = req.headers['x-api-key'];
    const keyHash = typeof key === 'string' ? hashApiKey(key) : '';
    const row = keyHash ? get<{ id: number }>('SELECT id FROM api_keys WHERE key_hash = ?', keyHash) : undefined;
    if (!row) return reply.code(401).send({ error: 'Missing or invalid X-API-Key header' });

    let image: Buffer;
    let body: z.infer<typeof DetectJson>;
    if (Buffer.isBuffer(req.body)) {
      image = req.body;
      body = DetectJson.parse({ image: 'raw' });
    } else {
      body = DetectJson.parse(req.body);
      image = Buffer.from(body.image.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    }

    const result = await detectVehicles(image, body.min_confidence);
    run('UPDATE api_keys SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ?', Date.now(), row.id);
    return {
      width: result.width,
      height: result.height,
      inference_ms: result.inferenceMs,
      vehicles: result.detections.map((d) => ({ ...d, label: VEHICLE_CLASSES.get(d.cls) })),
      spaces: body.spaces.map((s) => {
        const score = spaceScore(s.polygon, result.detections);
        return { id: s.id, occupied: score >= body.threshold, score: Math.round(score * 1000) / 1000 };
      }),
    };
  });
}

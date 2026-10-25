import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FrameSource } from '../capture.js';
import { all, get, run, transaction } from '../db.js';
import { engine } from '../engine.js';
import { parseSpace, type CameraRow, type LotRow, type SpaceRow } from '../types.js';

const Id = z.object({ id: z.coerce.number().int() });

const LotBody = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, digits and dashes')
    .max(60)
    .optional(),
  public: z.boolean().default(true),
});

const Source = z.object({
  source_type: z.enum(['rtsp', 'snapshot', 'file']),
  source_url: z.string().trim().min(1),
});

const CameraBody = Source.extend({
  lot_id: z.number().int(),
  name: z.string().trim().min(1).max(100),
  interval_sec: z.number().int().min(1).max(3600).default(5),
  enabled: z.boolean().default(true),
  min_confidence: z.number().min(0.05).max(0.95).default(0.3),
  high_threshold: z.number().min(0.05).max(1).default(0.5),
  low_threshold: z.number().min(0).max(0.95).default(0.25),
  confirm_frames: z.number().int().min(1).max(20).default(2),
  snapshot_interval_sec: z.number().int().min(5).max(86_400).default(60),
}).refine((c) => c.low_threshold < c.high_threshold, { message: 'Low threshold must be below high threshold' });

const Point = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
const SpacesBody = z.array(
  z.object({
    id: z.number().int().optional(),
    label: z.string().trim().min(1).max(40),
    kind: z.enum(['space', 'zone']).default('space'),
    polygon: z.array(Point).min(3).max(64),
    reserved: z.boolean().default(false),
    max_stay_min: z.number().int().min(0).default(0),
    zone_limit: z.number().int().min(0).default(0),
  }),
);

function slugify(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lot';
  let slug = base;
  for (let i = 2; get('SELECT 1 FROM lots WHERE slug = ?', slug); i++) slug = `${base}-${i}`;
  return slug;
}

function cameraWithLive(cam: CameraRow) {
  const w = engine.workers.get(cam.id);
  const spaceCount = get<{ n: number }>("SELECT COUNT(*) AS n FROM spaces WHERE camera_id = ? AND kind = 'space'", cam.id)!.n;
  return { ...cam, enabled: cam.enabled === 1, spaceCount, status: w?.status ?? 'starting', error: w?.error ?? null };
}

export default async function lotRoutes(app: FastifyInstance) {
  app.get('/api/lots', async () =>
    all<LotRow>('SELECT * FROM lots ORDER BY name').map((lot) => ({
      ...lot,
      public: lot.public === 1,
      summary: engine.lotSummary(lot.id),
      cameraCount: get<{ n: number }>('SELECT COUNT(*) AS n FROM cameras WHERE lot_id = ?', lot.id)!.n,
    })),
  );

  app.post('/api/lots', async (req) => {
    const body = LotBody.parse(req.body);
    const slug = body.slug ? body.slug : slugify(body.name);
    const { lastInsertRowid } = run(
      'INSERT INTO lots (name, slug, public, created_at) VALUES (?, ?, ?, ?)',
      body.name,
      slug,
      body.public ? 1 : 0,
      Date.now(),
    );
    return get<LotRow>('SELECT * FROM lots WHERE id = ?', Number(lastInsertRowid));
  });

  app.put('/api/lots/:id', async (req) => {
    const { id } = Id.parse(req.params);
    const body = LotBody.parse(req.body);
    run('UPDATE lots SET name = ?, slug = COALESCE(?, slug), public = ? WHERE id = ?', body.name, body.slug ?? null, body.public ? 1 : 0, id);
    return get<LotRow>('SELECT * FROM lots WHERE id = ?', id);
  });

  app.delete('/api/lots/:id', async (req) => {
    const { id } = Id.parse(req.params);
    for (const cam of all<{ id: number }>('SELECT id FROM cameras WHERE lot_id = ?', id)) engine.removeCamera(cam.id);
    run('DELETE FROM lots WHERE id = ?', id);
    return { ok: true };
  });

  app.get('/api/cameras', async () => all<CameraRow>('SELECT * FROM cameras ORDER BY lot_id, name').map(cameraWithLive));

  app.get('/api/cameras/:id', async (req, reply) => {
    const { id } = Id.parse(req.params);
    const cam = get<CameraRow>('SELECT * FROM cameras WHERE id = ?', id);
    if (!cam) return reply.code(404).send({ error: 'Camera not found' });
    const spaces = all<SpaceRow>('SELECT * FROM spaces WHERE camera_id = ? ORDER BY id', id).map(parseSpace);
    return { ...cameraWithLive(cam), spaces, live: engine.workers.get(id)?.live() ?? null };
  });

  app.post('/api/cameras', async (req) => {
    const c = CameraBody.parse(req.body);
    const { lastInsertRowid } = run(
      `INSERT INTO cameras (lot_id, name, source_type, source_url, interval_sec, enabled, min_confidence, high_threshold,
        low_threshold, confirm_frames, snapshot_interval_sec, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      c.lot_id, c.name, c.source_type, c.source_url, c.interval_sec, c.enabled ? 1 : 0, c.min_confidence,
      c.high_threshold, c.low_threshold, c.confirm_frames, c.snapshot_interval_sec, Date.now(),
    );
    const id = Number(lastInsertRowid);
    engine.restartCamera(id);
    return cameraWithLive(get<CameraRow>('SELECT * FROM cameras WHERE id = ?', id)!);
  });

  app.put('/api/cameras/:id', async (req) => {
    const { id } = Id.parse(req.params);
    const c = CameraBody.parse(req.body);
    run(
      `UPDATE cameras SET lot_id = ?, name = ?, source_type = ?, source_url = ?, interval_sec = ?, enabled = ?, min_confidence = ?,
        high_threshold = ?, low_threshold = ?, confirm_frames = ?, snapshot_interval_sec = ? WHERE id = ?`,
      c.lot_id, c.name, c.source_type, c.source_url, c.interval_sec, c.enabled ? 1 : 0, c.min_confidence,
      c.high_threshold, c.low_threshold, c.confirm_frames, c.snapshot_interval_sec, id,
    );
    engine.restartCamera(id);
    return cameraWithLive(get<CameraRow>('SELECT * FROM cameras WHERE id = ?', id)!);
  });

  app.delete('/api/cameras/:id', async (req) => {
    const { id } = Id.parse(req.params);
    engine.removeCamera(id);
    run('DELETE FROM cameras WHERE id = ?', id);
    return { ok: true };
  });

  /** Grabs a single frame from an unsaved source so the user can verify the URL in the setup form. */
  app.post('/api/cameras/test', async (req, reply) => {
    const { source_type, source_url } = Source.parse(req.body);
    try {
      const frame = await new FrameSource(source_type, source_url).grab();
      return reply.type('image/jpeg').send(frame);
    } catch (err) {
      return reply.code(422).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/cameras/:id/live.jpg', async (req, reply) => {
    const { id } = Id.parse(req.params);
    const frame = engine.workers.get(id)?.lastFrame;
    if (!frame) return reply.code(404).send({ error: 'No frame captured yet' });
    return reply.type('image/jpeg').header('Cache-Control', 'no-store').send(frame);
  });

  /** Replaces the camera's full set of spaces/zones; ids that are omitted are deleted. */
  app.put('/api/cameras/:id/spaces', async (req) => {
    const { id } = Id.parse(req.params);
    const spaces = SpacesBody.parse(req.body);
    transaction(() => {
      const keep = spaces.filter((s) => s.id !== undefined).map((s) => s.id!);
      for (const existing of all<{ id: number }>('SELECT id FROM spaces WHERE camera_id = ?', id)) {
        if (!keep.includes(existing.id)) run('DELETE FROM spaces WHERE id = ?', existing.id);
      }
      for (const s of spaces) {
        const values = [s.label, s.kind, JSON.stringify(s.polygon), s.reserved ? 1 : 0, s.max_stay_min, s.zone_limit] as const;
        if (s.id !== undefined) {
          run(
            'UPDATE spaces SET label = ?, kind = ?, polygon = ?, reserved = ?, max_stay_min = ?, zone_limit = ? WHERE id = ? AND camera_id = ?',
            ...values,
            s.id,
            id,
          );
        } else {
          run(
            'INSERT INTO spaces (label, kind, polygon, reserved, max_stay_min, zone_limit, camera_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            ...values,
            id,
          );
        }
      }
    });
    engine.reloadSpaces(id);
    return all<SpaceRow>('SELECT * FROM spaces WHERE camera_id = ? ORDER BY id', id).map(parseSpace);
  });
}

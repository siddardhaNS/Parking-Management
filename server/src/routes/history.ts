import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { all, get } from '../db.js';
import { snapshotDir } from '../engine.js';
import type { SpaceRow } from '../types.js';

const Range = z.object({
  from: z.coerce.number().int(),
  to: z.coerce.number().int(),
});
const Id = z.object({ id: z.coerce.number().int() });

interface EventRow {
  space_id: number;
  ts: number;
  occupied: number;
}

interface Stay {
  spaceId: number;
  start: number;
  end: number;
}

/** Pairs arrival/departure events into stays clipped to [from, to]. */
function staysFromEvents(events: EventRow[], initial: Map<number, number | null>, from: number, to: number): Stay[] {
  const open = new Map<number, number>();
  for (const [spaceId, since] of initial) if (since !== null) open.set(spaceId, from);
  const stays: Stay[] = [];
  for (const e of events) {
    if (e.occupied) {
      if (!open.has(e.space_id)) open.set(e.space_id, e.ts);
    } else {
      const start = open.get(e.space_id);
      if (start !== undefined) stays.push({ spaceId: e.space_id, start, end: e.ts });
      open.delete(e.space_id);
    }
  }
  for (const [spaceId, start] of open) stays.push({ spaceId, start, end: Math.min(to, Date.now()) });
  return stays;
}

/** Occupancy of each space at time `at`: the most recent event at or before it. */
function stateAt(spaceIds: number[], at: number) {
  const m = new Map<number, number | null>();
  for (const id of spaceIds) {
    const last = get<{ occupied: number }>(
      'SELECT occupied FROM space_events WHERE space_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 1',
      id,
      at,
    );
    m.set(id, last?.occupied ? 1 : null);
  }
  return m;
}

export default async function historyRoutes(app: FastifyInstance) {
  app.get('/api/cameras/:id/snapshots', async (req) => {
    const { id } = Id.parse(req.params);
    const { from, to } = Range.parse(req.query);
    return all<{ id: number; ts: number }>(
      'SELECT id, ts FROM snapshots WHERE camera_id = ? AND ts BETWEEN ? AND ? ORDER BY ts LIMIT 20000',
      id,
      from,
      to,
    );
  });

  app.get('/api/snapshots/:id/image', async (req, reply) => {
    const { id } = Id.parse(req.params);
    const row = get<{ path: string }>('SELECT path FROM snapshots WHERE id = ?', id);
    const abs = row && path.join(snapshotDir, row.path);
    if (!abs || !fs.existsSync(abs)) return reply.code(404).send({ error: 'Snapshot not found' });
    return reply.type('image/jpeg').header('Cache-Control', 'private, max-age=86400').send(fs.createReadStream(abs));
  });

  /** State of every space at `from` plus every transition in the range — enough to rebuild any instant client-side. */
  app.get('/api/cameras/:id/history', async (req) => {
    const { id } = Id.parse(req.params);
    const { from, to } = Range.parse(req.query);
    const spaceIds = all<{ id: number }>("SELECT id FROM spaces WHERE camera_id = ? AND kind = 'space'", id).map((s) => s.id);
    const initial = stateAt(spaceIds, from);
    const events = all<EventRow>(
      `SELECT e.space_id, e.ts, e.occupied FROM space_events e JOIN spaces s ON s.id = e.space_id
       WHERE s.camera_id = ? AND e.ts > ? AND e.ts <= ? ORDER BY e.ts`,
      id,
      from,
      to,
    );
    return {
      initial: [...initial].map(([spaceId, occ]) => ({ spaceId, occupied: occ !== null })),
      events: events.map((e) => ({ spaceId: e.space_id, ts: e.ts, occupied: e.occupied === 1 })),
    };
  });

  app.get('/api/analytics/:id', async (req) => {
    const { id: lotId } = Id.parse(req.params);
    const { from, to } = Range.parse(req.query);
    const days = Math.max((to - from) / 86_400_000, 1 / 24);

    const samples = all<{ ts: number; occupied: number; total: number }>(
      'SELECT ts, occupied, total FROM occupancy_samples WHERE lot_id = ? AND ts BETWEEN ? AND ? ORDER BY ts',
      lotId,
      from,
      to,
    );

    // Downsample to at most ~300 points for charting.
    const bucketMs = Math.max(60_000, Math.ceil((to - from) / 300 / 60_000) * 60_000);
    const buckets = new Map<number, { occ: number; max: number; total: number; n: number }>();
    const hourly = Array.from({ length: 24 }, () => ({ sum: 0, n: 0 }));
    const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ sum: 0, n: 0 })));
    let peak = { ts: 0, occupied: 0, total: 0 };
    for (const s of samples) {
      const key = Math.floor(s.ts / bucketMs) * bucketMs;
      const b = buckets.get(key) ?? { occ: 0, max: 0, total: 0, n: 0 };
      b.occ += s.occupied;
      b.max = Math.max(b.max, s.occupied);
      b.total = Math.max(b.total, s.total);
      b.n++;
      buckets.set(key, b);
      const d = new Date(s.ts);
      const rate = s.total ? s.occupied / s.total : 0;
      hourly[d.getHours()].sum += rate;
      hourly[d.getHours()].n++;
      heat[d.getDay()][d.getHours()].sum += rate;
      heat[d.getDay()][d.getHours()].n++;
      if (s.occupied > peak.occupied) peak = s;
    }

    const spaces = all<Pick<SpaceRow, 'id' | 'label'> & { camera: string }>(
      `SELECT s.id, s.label, c.name AS camera FROM spaces s JOIN cameras c ON c.id = s.camera_id
       WHERE c.lot_id = ? AND s.kind = 'space' ORDER BY c.name, s.label`,
      lotId,
    );
    const ids = spaces.map((s) => s.id);
    const events = ids.length
      ? all<EventRow>(
          `SELECT space_id, ts, occupied FROM space_events WHERE space_id IN (${ids.map(() => '?').join(',')})
           AND ts > ? AND ts <= ? ORDER BY ts`,
          ...ids,
          from,
          to,
        )
      : [];
    const stays = staysFromEvents(events, stateAt(ids, from), from, to);
    const arrivals = events.filter((e) => e.occupied).length;
    const perSpace = new Map(spaces.map((s) => [s.id, { stays: 0, arrivals: 0, occupiedMs: 0 }]));
    for (const st of stays) {
      const p = perSpace.get(st.spaceId)!;
      p.stays++;
      p.occupiedMs += st.end - st.start;
    }
    for (const e of events) if (e.occupied) perSpace.get(e.space_id)!.arrivals++;
    const completed = stays.filter((s) => s.start > from && s.end < Math.min(to, Date.now()));
    const avgStayMin = completed.length ? completed.reduce((n, s) => n + (s.end - s.start), 0) / completed.length / 60_000 : null;
    const span = Math.min(to, Date.now()) - from;

    return {
      bucketMs,
      series: [...buckets].map(([ts, b]) => ({ ts, avg: Math.round((b.occ / b.n) * 10) / 10, max: b.max, total: b.total })),
      hourly: hourly.map((h, hour) => ({ hour, rate: h.n ? h.sum / h.n : null })),
      heatmap: heat.map((row) => row.map((c) => (c.n ? c.sum / c.n : null))),
      peak,
      arrivals,
      avgStayMin,
      turnoverPerSpacePerDay: spaces.length ? arrivals / spaces.length / days : 0,
      avgOccupancyRate: samples.length ? samples.reduce((n, s) => n + (s.total ? s.occupied / s.total : 0), 0) / samples.length : null,
      spaces: spaces.map((s) => {
        const p = perSpace.get(s.id)!;
        return {
          id: s.id,
          label: s.label,
          camera: s.camera,
          arrivals: p.arrivals,
          utilization: span > 0 ? p.occupiedMs / span : 0,
          avgStayMin: p.stays ? p.occupiedMs / p.stays / 60_000 : null,
        };
      }),
    };
  });
}

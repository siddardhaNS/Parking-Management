import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ALERT_TYPES, alertManager, type AlertRuleRow } from '../alerts.js';
import { all, get, run } from '../db.js';

const Id = z.object({ id: z.coerce.number().int() });

const RuleBody = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(ALERT_TYPES),
  lot_id: z.number().int().nullable().default(null),
  params: z
    .object({
      graceMin: z.number().min(0).optional(),
      maxStayMin: z.number().min(0).optional(),
      thresholdPct: z.number().min(1).max(100).optional(),
      afterMin: z.number().min(0).optional(),
    })
    .default({}),
  channels: z
    .object({
      webhook: z.union([z.url(), z.literal('')]).optional(),
      email: z.string().trim().optional(),
      mqtt: z.boolean().optional(),
    })
    .default({}),
  cooldown_min: z.number().int().min(0).default(15),
  enabled: z.boolean().default(true),
});

function toApi(r: AlertRuleRow) {
  return { ...r, params: JSON.parse(r.params), channels: JSON.parse(r.channels), enabled: r.enabled === 1 };
}

export default async function alertRoutes(app: FastifyInstance) {
  app.get('/api/alert-rules', async () => all<AlertRuleRow>('SELECT * FROM alert_rules ORDER BY name').map(toApi));

  app.post('/api/alert-rules', async (req) => {
    const r = RuleBody.parse(req.body);
    const { lastInsertRowid } = run(
      'INSERT INTO alert_rules (name, type, lot_id, params, channels, cooldown_min, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)',
      r.name, r.type, r.lot_id, JSON.stringify(r.params), JSON.stringify(r.channels), r.cooldown_min, r.enabled ? 1 : 0,
    );
    alertManager.reload();
    return toApi(get<AlertRuleRow>('SELECT * FROM alert_rules WHERE id = ?', Number(lastInsertRowid))!);
  });

  app.put('/api/alert-rules/:id', async (req) => {
    const { id } = Id.parse(req.params);
    const r = RuleBody.parse(req.body);
    run(
      'UPDATE alert_rules SET name = ?, type = ?, lot_id = ?, params = ?, channels = ?, cooldown_min = ?, enabled = ? WHERE id = ?',
      r.name, r.type, r.lot_id, JSON.stringify(r.params), JSON.stringify(r.channels), r.cooldown_min, r.enabled ? 1 : 0, id,
    );
    alertManager.reload();
    return toApi(get<AlertRuleRow>('SELECT * FROM alert_rules WHERE id = ?', id)!);
  });

  app.delete('/api/alert-rules/:id', async (req) => {
    const { id } = Id.parse(req.params);
    run('DELETE FROM alert_rules WHERE id = ?', id);
    alertManager.reload();
    return { ok: true };
  });

  /** Sends a test alert through the rule's channels and reports per-channel failures. */
  app.post('/api/alert-rules/:id/test', async (req, reply) => {
    const { id } = Id.parse(req.params);
    const row = get<AlertRuleRow>('SELECT * FROM alert_rules WHERE id = ?', id);
    if (!row) return reply.code(404).send({ error: 'Rule not found' });
    const rule = toApi(row);
    const errors = await alertManager.dispatch(rule, `Test alert from rule "${rule.name}"`, { test: true });
    return { ok: errors.length === 0, errors };
  });

  app.get('/api/alerts', async (req) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    return all<{ id: number; rule_id: number | null; ts: number; type: string; message: string; payload: string }>(
      'SELECT * FROM alerts ORDER BY ts DESC LIMIT ?',
      limit,
    ).map((a) => ({ ...a, payload: JSON.parse(a.payload) }));
  });
}

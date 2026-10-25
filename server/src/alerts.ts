import { all, get, run } from './db.js';
import { engine, type CameraWorker } from './engine.js';
import { mqttBridge, postWebhook, sendEmail } from './integrations.js';
import type { CameraLive, LotRow, LotSummary } from './types.js';

export const ALERT_TYPES = ['reserved_occupied', 'overstay', 'lot_full', 'zone_limit', 'camera_offline'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export interface AlertChannels {
  webhook?: string;
  email?: string;
  mqtt?: boolean;
}

export interface AlertRuleRow {
  id: number;
  name: string;
  type: AlertType;
  lot_id: number | null;
  params: string;
  channels: string;
  cooldown_min: number;
  enabled: number;
}

interface Rule extends Omit<AlertRuleRow, 'params' | 'channels'> {
  params: { graceMin?: number; maxStayMin?: number; thresholdPct?: number; afterMin?: number };
  channels: AlertChannels;
}

const MIN = 60_000;

/**
 * Evaluates alert rules against live engine state and dispatches to webhook / email / MQTT.
 * Per-occupancy-session alerts (reserved space, overstay, offline) fire once per session;
 * level alerts (lot full, zone limit) re-fire at most once per cooldown.
 */
class AlertManager {
  private rules: Rule[] = [];
  private fired = new Map<string, number>();

  start() {
    this.reload();
    engine.on('camera', (live, worker) => this.onCamera(live, worker));
    engine.on('lot', (summary) => this.onLot(summary));
    setInterval(() => this.pruneFired(), 60 * MIN);
  }

  reload() {
    this.rules = all<AlertRuleRow>('SELECT * FROM alert_rules WHERE enabled = 1').map((r) => ({
      ...r,
      params: JSON.parse(r.params),
      channels: JSON.parse(r.channels),
    }));
  }

  private rulesFor(type: AlertType, lotId: number) {
    return this.rules.filter((r) => r.type === type && (r.lot_id === null || r.lot_id === lotId));
  }

  private onCamera(live: CameraLive, worker: CameraWorker) {
    const now = Date.now();
    const lotId = worker.camera.lot_id;
    const spaces = new Map(worker.spaces.map((s) => [s.id, s]));

    for (const rule of this.rulesFor('camera_offline', lotId)) {
      const after = (rule.params.afterMin ?? 5) * MIN;
      if (worker.failingSince && now - worker.failingSince >= after) {
        this.once(rule, `${worker.camera.id}:${worker.failingSince}`, `Camera "${worker.camera.name}" is offline: ${worker.error ?? 'unknown error'}`, {
          cameraId: worker.camera.id,
          offlineSince: worker.failingSince,
        });
      }
    }

    for (const s of live.spaces) {
      if (!s.occupied) continue;
      const space = spaces.get(s.id);
      if (!space) continue;
      const minutes = (now - s.since) / MIN;
      for (const rule of this.rulesFor('reserved_occupied', lotId)) {
        if (space.reserved && minutes >= (rule.params.graceMin ?? 2)) {
          this.once(rule, `${s.id}:${s.since}`, `Reserved space ${space.label} on "${worker.camera.name}" is occupied`, {
            spaceId: s.id,
            label: space.label,
            since: s.since,
          });
        }
      }
      for (const rule of this.rulesFor('overstay', lotId)) {
        const limit = space.max_stay_min || rule.params.maxStayMin || 0;
        if (limit > 0 && minutes >= limit) {
          this.once(rule, `${s.id}:${s.since}`, `Vehicle in space ${space.label} has stayed ${Math.round(minutes)} min (limit ${limit})`, {
            spaceId: s.id,
            label: space.label,
            since: s.since,
            limitMin: limit,
          });
        }
      }
    }

    for (const z of live.zones) {
      const zone = spaces.get(z.id);
      if (!zone?.zone_limit || z.count <= zone.zone_limit) continue;
      for (const rule of this.rulesFor('zone_limit', lotId)) {
        this.cooldown(rule, String(z.id), `Zone ${zone.label} has ${z.count} vehicles (limit ${zone.zone_limit})`, {
          zoneId: z.id,
          label: zone.label,
          count: z.count,
          limit: zone.zone_limit,
        });
      }
    }
  }

  private onLot(summary: LotSummary) {
    if (summary.total === 0) return;
    const pct = (summary.occupied / summary.total) * 100;
    for (const rule of this.rulesFor('lot_full', summary.lotId)) {
      if (pct < (rule.params.thresholdPct ?? 100)) continue;
      const lot = get<LotRow>('SELECT * FROM lots WHERE id = ?', summary.lotId);
      this.cooldown(rule, String(summary.lotId), `Lot "${lot?.name}" is ${Math.round(pct)}% full (${summary.free} free)`, { ...summary });
    }
  }

  private once(rule: Rule, key: string, message: string, payload: object) {
    const k = `${rule.id}:${key}`;
    if (this.fired.has(k)) return;
    this.fired.set(k, Date.now());
    void this.dispatch(rule, message, payload);
  }

  private cooldown(rule: Rule, key: string, message: string, payload: object) {
    const k = `${rule.id}:${key}`;
    const last = this.fired.get(k) ?? 0;
    if (Date.now() - last < rule.cooldown_min * MIN) return;
    this.fired.set(k, Date.now());
    void this.dispatch(rule, message, payload);
  }

  private pruneFired() {
    const cutoff = Date.now() - 48 * 60 * MIN;
    for (const [k, ts] of this.fired) if (ts < cutoff) this.fired.delete(k);
  }

  async dispatch(rule: Pick<Rule, 'id' | 'name' | 'type' | 'channels'>, message: string, payload: object) {
    const ts = Date.now();
    const body = { rule: { id: rule.id, name: rule.name }, type: rule.type, message, ts, ...payload };
    run(
      'INSERT INTO alerts (rule_id, ts, type, message, payload) VALUES (?, ?, ?, ?, ?)',
      rule.id,
      ts,
      rule.type,
      message,
      JSON.stringify(payload),
    );
    const { webhook, email, mqtt } = rule.channels;
    const jobs: Array<[string, Promise<void>]> = [];
    if (webhook) jobs.push(['webhook', postWebhook(webhook, body)]);
    if (email) jobs.push(['email', sendEmail(email, `[LotWatch] ${rule.name}`, `${message}\n\n${new Date(ts).toString()}`)]);
    if (mqtt) mqttBridge.publish('alerts', body);
    const errors: string[] = [];
    for (const [name, job] of jobs) {
      await job.catch((err: Error) => {
        errors.push(`${name}: ${err.message}`);
        console.warn(`[alert ${rule.id}] ${name} delivery failed: ${err.message}`);
      });
    }
    return errors;
  }
}

export const alertManager = new AlertManager();

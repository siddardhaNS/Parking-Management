import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { FrameSource } from './capture.js';
import { config } from './config.js';
import { all, get, run } from './db.js';
import { detectVehicles } from './detector.js';
import { SpaceState, spaceScore, zoneCount } from './occupancy.js';
import {
  parseSpace,
  type CameraLive,
  type CameraRow,
  type CameraStatus,
  type Detection,
  type LotSummary,
  type Space,
  type SpaceRow,
} from './types.js';

export const snapshotDir = path.join(config.dataDir, 'snapshots');

export class CameraWorker {
  spaces: Space[] = [];
  states = new Map<number, SpaceState>();
  zoneCounts = new Map<number, number>();
  detections: Detection[] = [];
  lastFrame: Buffer | null = null;
  frameAt = 0;
  width = 0;
  height = 0;
  inferenceMs = 0;
  status: CameraStatus = 'starting';
  error: string | undefined;
  /** Timestamp of the first failed grab in the current outage, 0 when healthy. */
  failingSince = 0;
  private lastSnapshotAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private source: FrameSource;

  constructor(
    public camera: CameraRow,
    private engine: Engine,
  ) {
    this.source = new FrameSource(camera.source_type, camera.source_url, camera.interval_sec);
    this.loadSpaces();
  }

  loadSpaces() {
    const rows = all<SpaceRow>('SELECT * FROM spaces WHERE camera_id = ? ORDER BY id', this.camera.id);
    this.spaces = rows.map(parseSpace);
    const next = new Map<number, SpaceState>();
    const { high_threshold: high, low_threshold: low, confirm_frames: confirm } = this.camera;
    for (const s of this.spaces) {
      if (s.kind !== 'space') continue;
      let state = this.states.get(s.id);
      if (!state) {
        state = new SpaceState(high, low, confirm);
        const last = get<{ occupied: number; ts: number }>(
          'SELECT occupied, ts FROM space_events WHERE space_id = ? ORDER BY ts DESC LIMIT 1',
          s.id,
        );
        if (last) state.restore(last.occupied === 1, last.ts);
      }
      next.set(s.id, state);
    }
    this.states = next;
  }

  start() {
    if (!this.camera.enabled) {
      this.status = 'disabled';
      return;
    }
    void this.tick();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async tick() {
    if (this.stopped) return;
    const started = Date.now();
    try {
      const frame = await this.source.grab();
      const result = await detectVehicles(frame, this.camera.min_confidence);
      if (this.stopped) return;
      this.process(frame, result.detections, result.width, result.height, result.inferenceMs);
    } catch (err) {
      this.status = 'error';
      this.error = err instanceof Error ? err.message : String(err);
      if (!this.failingSince) this.failingSince = Date.now();
      this.engine.publish(this);
    }
    const delay = Math.max(250, this.camera.interval_sec * 1000 - (Date.now() - started));
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  private process(frame: Buffer, detections: Detection[], width: number, height: number, inferenceMs: number) {
    const ts = Date.now();
    this.lastFrame = frame;
    this.frameAt = ts;
    this.width = width;
    this.height = height;
    this.inferenceMs = inferenceMs;
    this.detections = detections;
    this.status = 'online';
    this.error = undefined;
    this.failingSince = 0;

    let changed = false;
    for (const space of this.spaces) {
      if (space.kind === 'zone') {
        this.zoneCounts.set(space.id, zoneCount(space.polygon, detections));
        continue;
      }
      const state = this.states.get(space.id)!;
      const score = spaceScore(space.polygon, detections);
      if (state.update(score, ts)) {
        changed = true;
        run(
          'INSERT INTO space_events (space_id, ts, occupied, score) VALUES (?, ?, ?, ?)',
          space.id,
          ts,
          state.occupied ? 1 : 0,
          Math.round(score * 1000) / 1000,
        );
      }
    }

    const snapshotDue = ts - this.lastSnapshotAt >= this.camera.snapshot_interval_sec * 1000;
    if (changed || snapshotDue) this.saveSnapshot(frame, ts);
    this.engine.publish(this);
  }

  private saveSnapshot(frame: Buffer, ts: number) {
    this.lastSnapshotAt = ts;
    const day = new Date(ts).toISOString().slice(0, 10);
    const rel = path.join(String(this.camera.id), day, `${ts}.jpg`);
    const abs = path.join(snapshotDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFile(abs, frame, (err) => {
      if (err) console.warn(`[camera ${this.camera.id}] snapshot write failed: ${err.message}`);
    });
    run('INSERT INTO snapshots (camera_id, ts, path) VALUES (?, ?, ?)', this.camera.id, ts, rel);
  }

  live(): CameraLive {
    return {
      cameraId: this.camera.id,
      lotId: this.camera.lot_id,
      status: this.status,
      error: this.error,
      frameAt: this.frameAt,
      width: this.width,
      height: this.height,
      inferenceMs: this.inferenceMs,
      spaces: [...this.states].map(([id, s]) => ({
        id,
        occupied: s.occupied ?? false,
        score: Math.round(s.score * 1000) / 1000,
        since: s.since,
      })),
      zones: [...this.zoneCounts].map(([id, count]) => ({ id, count })),
      detections: this.detections,
    };
  }
}

type EngineEvents = {
  camera: [CameraLive, CameraWorker];
  lot: [LotSummary];
};

export class Engine extends EventEmitter<EngineEvents> {
  workers = new Map<number, CameraWorker>();
  private intervals: NodeJS.Timeout[] = [];

  start() {
    for (const cam of all<CameraRow>('SELECT * FROM cameras')) this.startCamera(cam);
    this.intervals.push(setInterval(() => this.sampleOccupancy(), 60_000));
    this.intervals.push(setInterval(() => this.cleanup(), 60 * 60_000));
    this.cleanup();
  }

  stop() {
    this.intervals.forEach(clearInterval);
    for (const w of this.workers.values()) w.stop();
  }

  private startCamera(cam: CameraRow) {
    const worker = new CameraWorker(cam, this);
    this.workers.set(cam.id, worker);
    worker.start();
  }

  /** Call after a camera is created or its settings change. */
  restartCamera(id: number) {
    this.workers.get(id)?.stop();
    this.workers.delete(id);
    const cam = get<CameraRow>('SELECT * FROM cameras WHERE id = ?', id);
    if (cam) this.startCamera(cam);
  }

  removeCamera(id: number) {
    this.workers.get(id)?.stop();
    this.workers.delete(id);
    fs.rm(path.join(snapshotDir, String(id)), { recursive: true, force: true }, () => {});
  }

  reloadSpaces(cameraId: number) {
    const w = this.workers.get(cameraId);
    if (!w) return;
    w.loadSpaces();
    this.publish(w);
  }

  lotSummary(lotId: number): LotSummary {
    let total = 0;
    let occupied = 0;
    let updatedAt = 0;
    for (const w of this.workers.values()) {
      if (w.camera.lot_id !== lotId) continue;
      updatedAt = Math.max(updatedAt, w.frameAt);
      for (const s of w.states.values()) {
        total++;
        if (s.occupied) occupied++;
      }
    }
    return { lotId, total, occupied, free: total - occupied, updatedAt };
  }

  publish(worker: CameraWorker) {
    this.emit('camera', worker.live(), worker);
    this.emit('lot', this.lotSummary(worker.camera.lot_id));
  }

  private sampleOccupancy() {
    const ts = Date.now();
    for (const { id } of all<{ id: number }>('SELECT id FROM lots')) {
      const s = this.lotSummary(id);
      if (s.total > 0) run('INSERT INTO occupancy_samples (lot_id, ts, occupied, total) VALUES (?, ?, ?, ?)', id, ts, s.occupied, s.total);
    }
  }

  private cleanup() {
    const cutoff = Date.now() - config.snapshotRetentionDays * 86_400_000;
    for (const row of all<{ path: string }>('SELECT path FROM snapshots WHERE ts < ?', cutoff)) {
      fs.rm(path.join(snapshotDir, row.path), { force: true }, () => {});
    }
    run('DELETE FROM snapshots WHERE ts < ?', cutoff);
    run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  }
}

export const engine = new Engine();

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { config } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lots (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  public INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cameras (
  id INTEGER PRIMARY KEY,
  lot_id INTEGER NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  interval_sec INTEGER NOT NULL DEFAULT 5,
  enabled INTEGER NOT NULL DEFAULT 1,
  min_confidence REAL NOT NULL DEFAULT 0.3,
  high_threshold REAL NOT NULL DEFAULT 0.5,
  low_threshold REAL NOT NULL DEFAULT 0.25,
  confirm_frames INTEGER NOT NULL DEFAULT 2,
  snapshot_interval_sec INTEGER NOT NULL DEFAULT 60,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS spaces (
  id INTEGER PRIMARY KEY,
  camera_id INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'space',
  polygon TEXT NOT NULL,
  reserved INTEGER NOT NULL DEFAULT 0,
  max_stay_min INTEGER NOT NULL DEFAULT 0,
  zone_limit INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS space_events (
  id INTEGER PRIMARY KEY,
  space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  occupied INTEGER NOT NULL,
  score REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_space_events_space_ts ON space_events(space_id, ts);
CREATE TABLE IF NOT EXISTS occupancy_samples (
  lot_id INTEGER NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  occupied INTEGER NOT NULL,
  total INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_samples_lot_ts ON occupancy_samples(lot_id, ts);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY,
  camera_id INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_camera_ts ON snapshots(camera_id, ts);
CREATE TABLE IF NOT EXISTS alert_rules (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  lot_id INTEGER REFERENCES lots(id) ON DELETE CASCADE,
  params TEXT NOT NULL DEFAULT '{}',
  channels TEXT NOT NULL DEFAULT '{}',
  cooldown_min INTEGER NOT NULL DEFAULT 15,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  rule_id INTEGER REFERENCES alert_rules(id) ON DELETE SET NULL,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts(ts);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
`;

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, 'lotwatch.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec(SCHEMA);

const cache = new Map<string, StatementSync>();
function stmt(sql: string): StatementSync {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return stmt(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return stmt(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: SQLInputValue[]) {
  return stmt(sql).run(...params);
}

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row ? { ...fallback, ...(JSON.parse(row.value) as T) } : fallback;
}

export function setSetting(key: string, value: unknown) {
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
}

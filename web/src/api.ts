export type Pt = [number, number];
export type SourceType = 'rtsp' | 'snapshot' | 'file';
export type CameraStatus = 'starting' | 'online' | 'error' | 'disabled';

export interface LotSummary {
  lotId: number;
  total: number;
  occupied: number;
  free: number;
  updatedAt: number;
}

export interface Lot {
  id: number;
  name: string;
  slug: string;
  public: boolean;
  summary: LotSummary;
  cameraCount: number;
}

export interface CameraSettings {
  lot_id: number;
  name: string;
  source_type: SourceType;
  source_url: string;
  interval_sec: number;
  enabled: boolean;
  min_confidence: number;
  high_threshold: number;
  low_threshold: number;
  confirm_frames: number;
  snapshot_interval_sec: number;
}

export interface Camera extends CameraSettings {
  id: number;
  spaceCount: number;
  status: CameraStatus;
  error: string | null;
}

export interface Space {
  id?: number;
  label: string;
  kind: 'space' | 'zone';
  polygon: Pt[];
  reserved: boolean | number;
  max_stay_min: number;
  zone_limit: number;
}

export interface Detection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
  cls: number;
}

export interface CameraLive {
  cameraId: number;
  lotId: number;
  status: CameraStatus;
  error?: string;
  frameAt: number;
  width: number;
  height: number;
  inferenceMs: number;
  spaces: { id: number; occupied: boolean; score: number; since: number }[];
  zones: { id: number; count: number }[];
  detections: Detection[];
}

export interface CameraDetail extends Camera {
  spaces: Space[];
  live: CameraLive | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && !url.startsWith('/api/auth/')) {
    window.location.href = '/login';
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  }
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.blob()) as Promise<T>;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export const VEHICLE_LABELS: Record<number, string> = { 2: 'car', 3: 'motorcycle', 5: 'bus', 7: 'truck' };

export function formatDuration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function formatTime(ts: number, withDate = false): string {
  return new Date(ts).toLocaleString(undefined, {
    month: withDate ? 'short' : undefined,
    day: withDate ? 'numeric' : undefined,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

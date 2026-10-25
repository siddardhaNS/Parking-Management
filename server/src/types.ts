export type Pt = [number, number];

export interface LotRow {
  id: number;
  name: string;
  slug: string;
  public: number;
  created_at: number;
}

export type SourceType = 'rtsp' | 'snapshot' | 'file';

export interface CameraRow {
  id: number;
  lot_id: number;
  name: string;
  source_type: SourceType;
  source_url: string;
  interval_sec: number;
  enabled: number;
  min_confidence: number;
  high_threshold: number;
  low_threshold: number;
  confirm_frames: number;
  snapshot_interval_sec: number;
  created_at: number;
}

export type SpaceKind = 'space' | 'zone';

export interface SpaceRow {
  id: number;
  camera_id: number;
  label: string;
  kind: SpaceKind;
  polygon: string;
  reserved: number;
  max_stay_min: number;
  zone_limit: number;
}

export interface Space extends Omit<SpaceRow, 'polygon'> {
  polygon: Pt[];
}

/** Detection box in normalized [0,1] image coordinates. */
export interface Detection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
  cls: number;
}

export interface SpaceLive {
  id: number;
  occupied: boolean;
  score: number;
  since: number;
}

export interface ZoneLive {
  id: number;
  count: number;
}

export type CameraStatus = 'starting' | 'online' | 'error' | 'disabled';

export interface CameraLive {
  cameraId: number;
  lotId: number;
  status: CameraStatus;
  error?: string;
  frameAt: number;
  width: number;
  height: number;
  inferenceMs: number;
  spaces: SpaceLive[];
  zones: ZoneLive[];
  detections: Detection[];
}

export interface LotSummary {
  lotId: number;
  total: number;
  occupied: number;
  free: number;
  updatedAt: number;
}

export function parseSpace(row: SpaceRow): Space {
  return { ...row, polygon: JSON.parse(row.polygon) as Pt[] };
}

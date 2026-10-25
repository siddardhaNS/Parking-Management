import { clipToRect, pointInPolygon, polygonArea, type Rect } from './geometry.js';
import type { Detection, Pt } from './types.js';

/**
 * The part of a vehicle box that actually touches the ground. Using the lower half
 * instead of the whole box keeps tall vehicles seen at oblique angles from
 * "bleeding" into the spaces behind them.
 */
export function footprint(d: Detection, fraction = 0.5): Rect {
  return { x1: d.x1, y1: d.y2 - (d.y2 - d.y1) * fraction, x2: d.x2, y2: d.y2 };
}

/** 0..1 score of how strongly a space is covered by any detected vehicle. */
export function spaceScore(poly: Pt[], detections: Detection[]): number {
  const spaceArea = polygonArea(poly);
  if (spaceArea <= 0) return 0;
  let best = 0;
  for (const d of detections) {
    const fp = footprint(d);
    const fpArea = (fp.x2 - fp.x1) * (fp.y2 - fp.y1);
    if (fpArea <= 0) continue;
    const inter = polygonArea(clipToRect(poly, fp));
    if (inter <= 0) continue;
    best = Math.max(best, inter / Math.min(spaceArea, fpArea));
  }
  return Math.min(1, best);
}

/** Number of vehicles whose ground contact point lies inside a monitoring zone. */
export function zoneCount(poly: Pt[], detections: Detection[]): number {
  return detections.filter((d) => pointInPolygon([(d.x1 + d.x2) / 2, d.y2 - (d.y2 - d.y1) * 0.1], poly)).length;
}

/**
 * Hysteresis state machine for one space: flips to occupied only when the score stays
 * at or above `high` for `confirm` consecutive frames, and back to vacant only when it
 * stays at or below `low`. Scores in between hold the current state. This filters out
 * flicker from rain, snow, shadows, headlight glare and passing cars.
 */
export class SpaceState {
  occupied: boolean | null = null;
  since = 0;
  score = 0;
  private streak = 0;

  constructor(
    public high: number,
    public low: number,
    public confirm: number,
  ) {}

  restore(occupied: boolean, since: number) {
    this.occupied = occupied;
    this.since = since;
  }

  /** Returns true when the state changed. */
  update(score: number, ts: number): boolean {
    this.score = score;
    if (this.occupied === null) {
      this.occupied = score >= (this.high + this.low) / 2;
      this.since = ts;
      return true;
    }
    const wantsFlip = this.occupied ? score <= this.low : score >= this.high;
    if (!wantsFlip) {
      this.streak = 0;
      return false;
    }
    if (++this.streak < this.confirm) return false;
    this.occupied = !this.occupied;
    this.since = ts;
    this.streak = 0;
    return true;
  }
}

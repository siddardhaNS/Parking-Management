import { describe, expect, it } from 'vitest';
import { nms } from '../src/detector.js';
import { clipToRect, pointInPolygon, polygonArea } from '../src/geometry.js';
import { SpaceState, spaceScore, zoneCount } from '../src/occupancy.js';
import type { Detection, Pt } from '../src/types.js';

const square: Pt[] = [
  [0.2, 0.2],
  [0.4, 0.2],
  [0.4, 0.4],
  [0.2, 0.4],
];

function det(x1: number, y1: number, x2: number, y2: number, score = 0.9): Detection {
  return { x1, y1, x2, y2, score, cls: 2 };
}

describe('geometry', () => {
  it('computes polygon area regardless of winding', () => {
    expect(polygonArea(square)).toBeCloseTo(0.04);
    expect(polygonArea([...square].reverse())).toBeCloseTo(0.04);
  });

  it('clips a polygon to a rectangle', () => {
    const clipped = clipToRect(square, { x1: 0.3, y1: 0, x2: 1, y2: 1 });
    expect(polygonArea(clipped)).toBeCloseTo(0.02);
    expect(clipToRect(square, { x1: 0.5, y1: 0.5, x2: 1, y2: 1 })).toHaveLength(0);
  });

  it('tests point containment', () => {
    expect(pointInPolygon([0.3, 0.3], square)).toBe(true);
    expect(pointInPolygon([0.5, 0.3], square)).toBe(false);
  });
});

describe('spaceScore', () => {
  it('is 1 when a vehicle footprint covers the space', () => {
    // Box spans y 0..0.4, so its lower-half footprint (0.2..0.4) covers the square.
    expect(spaceScore(square, [det(0.15, 0.0, 0.45, 0.4)])).toBeCloseTo(1);
  });

  it('ignores the upper half of tall boxes leaning over a space', () => {
    // Footprint is y 0.4..0.6: only the roof overlaps the square, so it scores 0.
    expect(spaceScore(square, [det(0.2, 0.2, 0.4, 0.6)])).toBe(0);
  });

  it('is 0 with no detections', () => {
    expect(spaceScore(square, [])).toBe(0);
  });
});

describe('zoneCount', () => {
  it('counts vehicles by ground contact point', () => {
    expect(zoneCount(square, [det(0.25, 0.1, 0.35, 0.35), det(0.6, 0.6, 0.7, 0.7)])).toBe(1);
  });
});

describe('SpaceState hysteresis', () => {
  it('requires consecutive confirming frames before flipping', () => {
    const s = new SpaceState(0.5, 0.25, 2);
    expect(s.update(0.0, 1)).toBe(true); // initial classification
    expect(s.occupied).toBe(false);
    expect(s.update(0.9, 2)).toBe(false);
    expect(s.update(0.1, 3)).toBe(false); // streak broken
    expect(s.update(0.9, 4)).toBe(false);
    expect(s.update(0.9, 5)).toBe(true);
    expect(s.occupied).toBe(true);
    expect(s.since).toBe(5);
  });

  it('holds state while the score sits between thresholds', () => {
    const s = new SpaceState(0.5, 0.25, 1);
    s.update(0.9, 1);
    for (let t = 2; t < 10; t++) expect(s.update(0.4, t)).toBe(false);
    expect(s.occupied).toBe(true);
    expect(s.update(0.2, 10)).toBe(true);
    expect(s.occupied).toBe(false);
  });
});

describe('nms', () => {
  it('keeps the strongest of overlapping boxes across classes', () => {
    const kept = nms([det(0, 0, 1, 1, 0.6), { ...det(0.05, 0, 1, 1, 0.9), cls: 7 }, det(2, 2, 3, 3, 0.5)], 0.5);
    expect(kept.map((d) => d.score)).toEqual([0.9, 0.5]);
  });
});

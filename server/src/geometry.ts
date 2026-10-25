import type { Pt } from './types.js';

export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Shoelace formula; works for any simple polygon regardless of winding. */
export function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Sutherland–Hodgman clip of an arbitrary polygon against an axis-aligned rectangle. */
export function clipToRect(poly: Pt[], r: Rect): Pt[] {
  const edges: Array<{ inside: (p: Pt) => boolean; cross: (a: Pt, b: Pt) => Pt }> = [
    { inside: (p) => p[0] >= r.x1, cross: (a, b) => lerpAtX(a, b, r.x1) },
    { inside: (p) => p[0] <= r.x2, cross: (a, b) => lerpAtX(a, b, r.x2) },
    { inside: (p) => p[1] >= r.y1, cross: (a, b) => lerpAtY(a, b, r.y1) },
    { inside: (p) => p[1] <= r.y2, cross: (a, b) => lerpAtY(a, b, r.y2) },
  ];
  let out = poly;
  for (const edge of edges) {
    if (out.length === 0) break;
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const curIn = edge.inside(cur);
      const prevIn = edge.inside(prev);
      if (curIn) {
        if (!prevIn) out.push(edge.cross(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(edge.cross(prev, cur));
      }
    }
  }
  return out;
}

function lerpAtX(a: Pt, b: Pt, x: number): Pt {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + t * (b[1] - a[1])];
}

function lerpAtY(a: Pt, b: Pt, y: number): Pt {
  const t = (y - a[1]) / (b[1] - a[1]);
  return [a[0] + t * (b[0] - a[0]), y];
}

export function pointInPolygon([x, y]: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function iou(a: Rect, b: Rect): number {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy;
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return union > 0 ? inter / union : 0;
}

import { useState, type ReactNode } from 'react';
import type { Detection, Space } from '../api';

export interface SpaceVisual {
  occupied?: boolean;
  count?: number;
  highlight?: boolean;
}

interface Props {
  src: string | null;
  spaces: Space[];
  states: Record<number, SpaceVisual>;
  detections?: Detection[];
  showLabels?: boolean;
  onSpaceClick?: (id: number) => void;
  children?: ReactNode;
}

/**
 * Camera frame with semi-transparent space polygons: green = free, red = occupied,
 * blue dashed = monitoring zone. The SVG uses the frame's pixel size as its
 * viewBox so labels stay undistorted at any display size.
 */
export function CameraOverlay({ src, spaces, states, detections, showLabels = true, onSpaceClick, children }: Props) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  if (!src) {
    return <div className="flex aspect-video items-center justify-center rounded-lg bg-slate-900 text-sm text-slate-400">Waiting for first frame…</div>;
  }

  const w = size?.w ?? 1;
  const h = size?.h ?? 1;
  const font = Math.max(10, w / 70);

  return (
    <div className="relative overflow-hidden rounded-lg bg-slate-900">
      <img src={src} alt="" className="block w-full select-none" draggable={false} onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
      {size && (
        <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 size-full" preserveAspectRatio="none">
          {detections?.map((d, i) => (
            <rect
              key={i}
              x={d.x1 * w}
              y={d.y1 * h}
              width={(d.x2 - d.x1) * w}
              height={(d.y2 - d.y1) * h}
              fill="none"
              stroke="#facc15"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              strokeDasharray="4 3"
            />
          ))}
          {spaces.map((s) => {
            const st = s.id !== undefined ? states[s.id] : undefined;
            const isZone = s.kind === 'zone';
            const color = isZone ? '#3b82f6' : st?.occupied === undefined ? '#94a3b8' : st.occupied ? '#ef4444' : '#10b981';
            const pts = s.polygon.map(([x, y]) => `${x * w},${y * h}`).join(' ');
            const cx = (s.polygon.reduce((n, p) => n + p[0], 0) / s.polygon.length) * w;
            const cy = (s.polygon.reduce((n, p) => n + p[1], 0) / s.polygon.length) * h;
            const label = isZone ? `${s.label}: ${st?.count ?? 0}` : s.label;
            return (
              <g key={s.id ?? s.label} onClick={() => s.id !== undefined && onSpaceClick?.(s.id)} className={onSpaceClick ? 'cursor-pointer' : ''}>
                <polygon
                  points={pts}
                  fill={color}
                  fillOpacity={isZone ? 0.08 : st?.highlight ? 0.55 : 0.35}
                  stroke={st?.highlight ? '#fff' : color}
                  strokeWidth={st?.highlight ? 3 : 2}
                  strokeDasharray={isZone ? '8 5' : undefined}
                  vectorEffect="non-scaling-stroke"
                />
                {showLabels && (
                  <text
                    x={cx}
                    y={cy}
                    fontSize={font}
                    fontWeight={600}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#fff"
                    stroke="#0f172a"
                    strokeWidth={font / 5}
                    paintOrder="stroke"
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {children}
    </div>
  );
}

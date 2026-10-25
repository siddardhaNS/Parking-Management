import { ArrowLeft, Copy, MousePointer2, RefreshCw, Save, Sparkles, Square, SquareDashed, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type CameraDetail, type Pt, type Space } from '../api';
import { Button, Card, Checkbox, ErrorText, Field, Input, PageHeader } from '../components/ui';
import { useFetch } from '../hooks';
import { useCameraLive } from '../live';

type Mode = 'select' | 'space' | 'zone';
type EditSpace = Space & { key: string };
type Drag = { kind: 'vertex'; index: number; vertex: number } | { kind: 'move'; index: number; origin: Pt; start: Pt[] };

let keySeq = 0;
const newKey = () => `k${++keySeq}`;
const clamp = (v: number) => Math.min(1, Math.max(0, v));

function nextLabel(spaces: Space[], kind: Space['kind']) {
  const prefix = kind === 'zone' ? 'Zone ' : 'P';
  const nums = spaces.filter((s) => s.kind === kind).map((s) => Number(s.label.replace(/^\D+/, '')) || 0);
  return `${prefix}${Math.max(0, ...nums) + 1}`;
}

export function SpaceEditor() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { data: cam } = useFetch<CameraDetail>(`/api/cameras/${id}`);
  const live = useCameraLive(id) ?? cam?.live ?? undefined;

  const [frameAt, setFrameAt] = useState<number | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [spaces, setSpaces] = useState<EditSpace[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('select');
  const [draft, setDraft] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    if (cam) setSpaces(cam.spaces.map((s) => ({ ...s, key: newKey() })));
  }, [cam]);

  // Freeze the editor background on one frame; it only changes when the user refreshes it.
  useEffect(() => {
    if (frameAt === null && live?.frameAt) setFrameAt(live.frameAt);
  }, [live?.frameAt, frameAt]);

  const update = useCallback((fn: (s: EditSpace[]) => EditSpace[]) => {
    setSpaces(fn);
    setDirty(true);
  }, []);

  const toPt = (e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!;
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const m = p.matrixTransform(svg.getScreenCTM()!.inverse());
    return [clamp(m.x / size!.w), clamp(m.y / size!.h)];
  };

  const finishDraft = useCallback(() => {
    // A double-click to finish also lands two clicks; drop the near-duplicate points they add.
    const polygon = draft.filter((p, i) => i === 0 || Math.hypot(p[0] - draft[i - 1][0], p[1] - draft[i - 1][1]) > 0.003);
    if (polygon.length >= 3 && mode !== 'select') {
      const kind = mode;
      update((s) => {
        const next = [...s, { key: newKey(), label: nextLabel(s, kind), kind, polygon, reserved: false, max_stay_min: 0, zone_limit: 0 }];
        setSelected(next.length - 1);
        return next;
      });
    }
    setDraft([]);
  }, [draft, mode, update]);

  const removeSelected = useCallback(() => {
    if (selected === null) return;
    update((s) => s.filter((_, i) => i !== selected));
    setSelected(null);
  }, [selected, update]);

  const duplicateSelected = useCallback(() => {
    if (selected === null) return;
    update((s) => {
      const src = s[selected];
      const xs = src.polygon.map((p) => p[0]);
      const dx = Math.max(...xs) - Math.min(...xs); // place the copy right next to the original
      const copy: EditSpace = { ...src, id: undefined, key: newKey(), label: nextLabel(s, src.kind), polygon: src.polygon.map(([x, y]) => [clamp(x + dx), y]) };
      setSelected(s.length);
      return [...s, copy];
    });
  }, [selected, update]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'Escape') {
        setDraft([]);
        setMode('select');
      } else if (e.key === 'Enter') finishDraft();
      else if (e.key === 'Backspace' && draft.length) setDraft((d) => d.slice(0, -1));
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== null) removeSelected();
      else if (e.key === 'd' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        duplicateSelected();
      } else if (e.key === 's' && !e.ctrlKey) setMode('space');
      else if (e.key === 'z' && !e.ctrlKey) setMode('zone');
      else if (e.key === 'v') setMode('select');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft.length, finishDraft, removeSelected, duplicateSelected, selected]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      if (!d || !size) return;
      const p = toPt(e);
      setSpaces((s) =>
        s.map((sp, i) => {
          if (i !== d.index) return sp;
          if (d.kind === 'vertex') return { ...sp, polygon: sp.polygon.map((v, j) => (j === d.vertex ? p : v)) };
          const dx = p[0] - d.origin[0];
          const dy = p[1] - d.origin[1];
          return { ...sp, polygon: d.start.map(([x, y]) => [clamp(x + dx), clamp(y + dy)] as Pt) };
        }),
      );
      setDirty(true);
    };
    const onUp = () => (drag.current = null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  });

  const onCanvasClick = (e: ReactMouseEvent) => {
    if (mode === 'select') {
      if (e.target === svgRef.current) setSelected(null);
      return;
    }
    const p = toPt(e);
    // Clicking close to the first point closes the polygon.
    if (draft.length >= 3 && size) {
      const [fx, fy] = draft[0];
      const r = svgRef.current!.getBoundingClientRect();
      if (Math.hypot((fx - p[0]) * r.width, (fy - p[1]) * r.height) < 12) return finishDraft();
    }
    setDraft((d) => [...d, p]);
  };

  const autoSuggest = () => {
    if (!live?.detections.length) return;
    update((s) => {
      const next = [...s];
      for (const d of live.detections) {
        const cx = (d.x1 + d.x2) / 2;
        const cy = d.y2 - (d.y2 - d.y1) * 0.25;
        const covered = next.some((sp) => sp.kind === 'space' && inside([cx, cy], sp.polygon));
        if (covered) continue;
        const top = d.y2 - (d.y2 - d.y1) * 0.5;
        next.push({
          key: newKey(),
          label: nextLabel(next, 'space'),
          kind: 'space',
          polygon: [[d.x1, top], [d.x2, top], [d.x2, d.y2], [d.x1, d.y2]],
          reserved: false,
          max_stay_min: 0,
          zone_limit: 0,
        });
      }
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = spaces.map(({ key: _k, ...s }) => ({ ...s, reserved: !!s.reserved }));
      const saved = await api.put<Space[]>(`/api/cameras/${id}/spaces`, body);
      setSpaces(saved.map((s) => ({ ...s, key: newKey() })));
      setDirty(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const sel = selected !== null ? spaces[selected] : null;
  const setSel = (patch: Partial<Space>) => update((s) => s.map((sp, i) => (i === selected ? { ...sp, ...patch } : sp)));
  const src = frameAt ? `/api/cameras/${id}/live.jpg?t=${frameAt}` : null;
  const w = size?.w ?? 1;
  const h = size?.h ?? 1;
  const handle = Math.max(4, w / 180);
  const font = Math.max(10, w / 70);
  const counts = useMemo(() => ({ spaces: spaces.filter((s) => s.kind === 'space').length, zones: spaces.filter((s) => s.kind === 'zone').length }), [spaces]);

  if (!cam) return null;

  const tool = (m: Mode, icon: React.ReactNode, label: string, key: string) => (
    <button
      onClick={() => {
        setMode(m);
        setDraft([]);
      }}
      title={`${label} (${key})`}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm ${mode === m ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {icon} {label}
    </button>
  );

  return (
    <>
      <PageHeader
        title={`Map spaces · ${cam.name}`}
        subtitle={`${counts.spaces} spaces, ${counts.zones} zones${dirty ? ' · unsaved changes' : ''}`}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate(`/cameras/${id}`)}>
              <ArrowLeft className="size-4" /> Back
            </Button>
            <Button onClick={save} disabled={!dirty || saving}>
              <Save className="size-4" /> {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      />
      <ErrorText error={error} />
      <div className="mt-2 grid gap-6 xl:grid-cols-[1fr_300px]">
        <div>
          <Card className="mb-3 flex flex-wrap items-center gap-1 p-1.5">
            {tool('select', <MousePointer2 className="size-4" />, 'Select', 'V')}
            {tool('space', <Square className="size-4" />, 'Draw space', 'S')}
            {tool('zone', <SquareDashed className="size-4" />, 'Draw zone', 'Z')}
            <div className="mx-1 h-5 w-px bg-slate-200" />
            <button onClick={autoSuggest} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100" title="Create a space under every currently detected vehicle">
              <Sparkles className="size-4" /> Auto-detect from parked cars
            </button>
            <button onClick={() => setFrameAt(live?.frameAt ?? null)} className="ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
              <RefreshCw className="size-4" /> Refresh image
            </button>
          </Card>
          {!src ? (
            <div className="flex aspect-video items-center justify-center rounded-lg bg-slate-900 text-sm text-slate-400">
              {live?.error ? `Camera error: ${live.error}` : 'Waiting for the first camera frame…'}
            </div>
          ) : (
            <div className="relative overflow-hidden rounded-lg bg-slate-900 select-none">
              <img src={src} alt="" className="block w-full" draggable={false} onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
              {size && (
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${w} ${h}`}
                  preserveAspectRatio="none"
                  className={`absolute inset-0 size-full ${mode === 'select' ? 'cursor-default' : 'cursor-crosshair'}`}
                  onClick={onCanvasClick}
                  onDoubleClick={finishDraft}
                  onMouseMove={(e) => draft.length && setCursor(toPt(e))}
                >
                  {spaces.map((s, i) => {
                    const isSel = i === selected;
                    const color = s.kind === 'zone' ? '#3b82f6' : s.reserved ? '#f59e0b' : '#10b981';
                    const pts = s.polygon.map(([x, y]) => `${x * w},${y * h}`).join(' ');
                    const cx = (s.polygon.reduce((n, p) => n + p[0], 0) / s.polygon.length) * w;
                    const cy = (s.polygon.reduce((n, p) => n + p[1], 0) / s.polygon.length) * h;
                    return (
                      <g key={s.key}>
                        <polygon
                          points={pts}
                          fill={color}
                          fillOpacity={isSel ? 0.45 : 0.25}
                          stroke={isSel ? '#fff' : color}
                          strokeWidth={isSel ? 2.5 : 2}
                          strokeDasharray={s.kind === 'zone' ? '8 5' : undefined}
                          vectorEffect="non-scaling-stroke"
                          className={mode === 'select' ? 'cursor-move' : 'pointer-events-none'}
                          onMouseDown={(e) => {
                            if (mode !== 'select') return;
                            e.stopPropagation();
                            setSelected(i);
                            drag.current = { kind: 'move', index: i, origin: toPt(e), start: s.polygon };
                          }}
                        />
                        <text x={cx} y={cy} fontSize={font} fontWeight={600} textAnchor="middle" dominantBaseline="central" fill="#fff" stroke="#0f172a" strokeWidth={font / 5} paintOrder="stroke" className="pointer-events-none">
                          {s.label}
                        </text>
                        {isSel && mode === 'select' && (
                          <>
                            {s.polygon.map(([x, y], j) => {
                              const [nx, ny] = s.polygon[(j + 1) % s.polygon.length];
                              return (
                                <circle
                                  key={`m${j}`}
                                  cx={((x + nx) / 2) * w}
                                  cy={((y + ny) / 2) * h}
                                  r={handle * 0.7}
                                  fill="#fff"
                                  fillOpacity={0.6}
                                  className="cursor-copy"
                                  onMouseDown={(e) => {
                                    // Dragging an edge midpoint inserts a new vertex there.
                                    e.stopPropagation();
                                    const poly = [...s.polygon];
                                    poly.splice(j + 1, 0, [(x + nx) / 2, (y + ny) / 2]);
                                    update((all) => all.map((sp, k) => (k === i ? { ...sp, polygon: poly } : sp)));
                                    drag.current = { kind: 'vertex', index: i, vertex: j + 1 };
                                  }}
                                />
                              );
                            })}
                            {s.polygon.map(([x, y], j) => (
                              <circle
                                key={`v${j}`}
                                cx={x * w}
                                cy={y * h}
                                r={handle}
                                fill="#fff"
                                stroke="#0f172a"
                                strokeWidth={1.5}
                                vectorEffect="non-scaling-stroke"
                                className="cursor-grab"
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  drag.current = { kind: 'vertex', index: i, vertex: j };
                                }}
                              />
                            ))}
                          </>
                        )}
                      </g>
                    );
                  })}
                  {draft.length > 0 && (
                    <>
                      <polyline
                        points={[...draft, ...(cursor ? [cursor] : [])].map(([x, y]) => `${x * w},${y * h}`).join(' ')}
                        fill={mode === 'zone' ? '#3b82f6' : '#10b981'}
                        fillOpacity={0.15}
                        stroke="#fff"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        vectorEffect="non-scaling-stroke"
                        className="pointer-events-none"
                      />
                      {draft.map(([x, y], j) => (
                        <circle key={j} cx={x * w} cy={y * h} r={j === 0 ? handle * 1.4 : handle} fill={j === 0 ? '#facc15' : '#fff'} stroke="#0f172a" strokeWidth={1.5} vectorEffect="non-scaling-stroke" className="pointer-events-none" />
                      ))}
                    </>
                  )}
                </svg>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">
            {mode === 'select'
              ? 'Click a shape to select it; drag to move, drag corners to reshape, drag the small edge dots to add corners. Delete removes, Ctrl+D duplicates next to it.'
              : 'Click to place corners around the space. Click the yellow first point, double-click or press Enter to finish. Backspace undoes a point, Esc cancels.'}
          </p>
        </div>

        <div className="space-y-4">
          {sel ? (
            <Card className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">{sel.kind === 'zone' ? 'Monitoring zone' : 'Parking space'}</h3>
                <div className="flex gap-1">
                  <Button variant="ghost" onClick={duplicateSelected} title="Duplicate (Ctrl+D)">
                    <Copy className="size-4" />
                  </Button>
                  <Button variant="ghost" onClick={removeSelected} title="Delete">
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              <Field label="Label">
                <Input value={sel.label} onChange={(e) => setSel({ label: e.target.value })} />
              </Field>
              {sel.kind === 'space' ? (
                <>
                  <Checkbox label="Reserved space (alert when occupied)" checked={!!sel.reserved} onChange={(v) => setSel({ reserved: v })} />
                  <Field label="Max stay (minutes)" hint="0 = no limit. Used by overstay alerts.">
                    <Input type="number" min={0} value={sel.max_stay_min} onChange={(e) => setSel({ max_stay_min: Number(e.target.value) })} />
                  </Field>
                </>
              ) : (
                <Field label="Vehicle limit" hint="0 = no limit. Used by zone-limit alerts.">
                  <Input type="number" min={0} value={sel.zone_limit} onChange={(e) => setSel({ zone_limit: Number(e.target.value) })} />
                </Field>
              )}
            </Card>
          ) : (
            <Card className="p-4 text-sm text-slate-500">Select a shape to edit its label and rules, or press S to start drawing a space.</Card>
          )}
          <Card className="max-h-[50vh] overflow-y-auto">
            <ul className="divide-y divide-slate-100 text-sm">
              {spaces.map((s, i) => (
                <li key={s.key} onClick={() => setSelected(i)} className={`flex cursor-pointer items-center gap-2 px-4 py-2 ${i === selected ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
                  <span className={`size-2.5 rounded-sm ${s.kind === 'zone' ? 'bg-blue-500' : s.reserved ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                  {s.label}
                  <span className="ml-auto text-xs text-slate-400">{s.kind}</span>
                </li>
              ))}
              {spaces.length === 0 && <li className="px-4 py-3 text-slate-400">Nothing drawn yet.</li>}
            </ul>
          </Card>
          <Link to={`/cameras/${id}`} className="block text-center text-xs text-slate-500 hover:text-slate-800">
            View live occupancy →
          </Link>
        </div>
      </div>
    </>
  );
}

function inside([x, y]: Pt, poly: Pt[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

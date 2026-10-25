import { History, Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatDuration, formatTime, type Camera, type CameraDetail } from '../api';
import { CameraOverlay } from '../components/CameraOverlay';
import { Card, EmptyState, Field, PageHeader, Select } from '../components/ui';
import { useFetch } from '../hooks';

interface HistoryData {
  initial: { spaceId: number; occupied: boolean }[];
  events: { spaceId: number; ts: number; occupied: boolean }[];
}

const RANGES = { '1h': 3_600_000, '6h': 6 * 3_600_000, '24h': 86_400_000, '3d': 3 * 86_400_000, '7d': 7 * 86_400_000 };
const SPEEDS = [60, 600, 3600];

/** Index of the last element with ts <= t (binary search), or -1. */
function lastAtOrBefore<T extends { ts: number }>(arr: T[], t: number) {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].ts <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export function Timeline() {
  const [params, setParams] = useSearchParams();
  const { data: cameras } = useFetch<Camera[]>('/api/cameras');
  const cameraId = Number(params.get('camera')) || cameras?.[0]?.id;
  const [range, setRange] = useState<keyof typeof RANGES>('24h');
  const [anchor, setAnchor] = useState(() => Date.now());
  const from = anchor - RANGES[range];
  const to = anchor;

  const { data: cam } = useFetch<CameraDetail>(cameraId ? `/api/cameras/${cameraId}` : null);
  const { data: snapshots } = useFetch<{ id: number; ts: number }[]>(cameraId ? `/api/cameras/${cameraId}/snapshots?from=${from}&to=${to}` : null);
  const { data: history } = useFetch<HistoryData>(cameraId ? `/api/cameras/${cameraId}/history?from=${from}&to=${to}` : null);

  const [t, setT] = useState(to);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(600);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => setT(to), [to]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setT((cur) => {
        const next = cur + speed * 100;
        if (next >= to) {
          setPlaying(false);
          return to;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [playing, speed, to]);

  const snapIdx = snapshots ? Math.max(0, lastAtOrBefore(snapshots, t)) : -1;
  const snapshot = snapshots?.[snapIdx];

  const states = useMemo(() => {
    const m: Record<number, { occupied: boolean; highlight?: boolean }> = {};
    for (const i of history?.initial ?? []) m[i.spaceId] = { occupied: i.occupied };
    for (const e of history?.events ?? []) {
      if (e.ts > t) break;
      m[e.spaceId] = { occupied: e.occupied };
    }
    if (selected !== null && m[selected]) m[selected] = { ...m[selected], highlight: true };
    return m;
  }, [history, t, selected]);

  /** Arrival → departure pairs for the selected space, for dispute review. */
  const stays = useMemo(() => {
    if (selected === null || !history) return [];
    const out: { start: number | null; end: number | null }[] = [];
    let open: number | null | undefined = history.initial.find((i) => i.spaceId === selected)?.occupied ? null : undefined;
    for (const e of history.events) {
      if (e.spaceId !== selected) continue;
      if (e.occupied && open === undefined) open = e.ts;
      else if (!e.occupied && open !== undefined) {
        out.push({ start: open, end: e.ts });
        open = undefined;
      }
    }
    if (open !== undefined) out.push({ start: open, end: null });
    return out.reverse();
  }, [history, selected]);

  if (cameras && cameras.length === 0) {
    return (
      <>
        <PageHeader title="Audit timeline" />
        <EmptyState icon={<History className="size-10" />} title="No cameras yet" />
      </>
    );
  }

  const pct = (ts: number) => `${((ts - from) / (to - from)) * 100}%`;
  const selSpace = cam?.spaces.find((s) => s.id === selected);

  return (
    <>
      <PageHeader title="Audit timeline" subtitle="Scrub through recorded frames to see exactly when vehicles arrived and left. Useful for overstay and payment disputes." />
      <Card className="mb-4 flex flex-wrap items-end gap-4 p-4">
        <Field label="Camera">
          <Select value={cameraId ?? ''} onChange={(e) => setParams({ camera: e.target.value })} className="min-w-48">
            {cameras?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Window">
          <Select value={range} onChange={(e) => setRange(e.target.value as keyof typeof RANGES)}>
            {Object.keys(RANGES).map((r) => (
              <option key={r} value={r}>
                Last {r}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ending at">
          <input
            type="datetime-local"
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
            value={new Date(anchor - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)}
            onChange={(e) => e.target.value && setAnchor(new Date(e.target.value).getTime())}
          />
        </Field>
        <button className="pb-2 text-xs text-slate-500 underline hover:text-slate-800" onClick={() => setAnchor(Date.now())}>
          Now
        </button>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div>
          <CameraOverlay src={snapshot ? `/api/snapshots/${snapshot.id}/image` : null} spaces={cam?.spaces ?? []} states={states} onSpaceClick={setSelected} />
          {snapshots?.length === 0 && <p className="mt-2 text-sm text-slate-500">No recorded frames in this window.</p>}
          <Card className="mt-3 p-4">
            <div className="mb-3 flex items-center gap-3">
              <button onClick={() => (t >= to ? (setT(from), setPlaying(true)) : setPlaying(!playing))} className="rounded-full bg-slate-900 p-2 text-white hover:bg-slate-700">
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
              <div className="text-sm font-medium text-slate-900 tabular-nums">{formatTime(t, true)}</div>
              {snapshot && <div className="text-xs text-slate-400">frame at {formatTime(snapshot.ts)}</div>}
              <Select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="ml-auto w-auto">
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}× speed
                  </option>
                ))}
              </Select>
            </div>
            <div className="relative mb-1 h-4">
              {history?.events
                .filter((e) => selected === null || e.spaceId === selected)
                .map((e, i) => (
                  <span key={i} className={`absolute top-0 h-4 w-0.5 ${e.occupied ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ left: pct(e.ts) }} title={`${e.occupied ? 'Arrival' : 'Departure'} ${formatTime(e.ts)}`} />
                ))}
            </div>
            <input type="range" min={from} max={to} step={1000} value={t} onChange={(e) => (setPlaying(false), setT(Number(e.target.value)))} className="w-full accent-slate-900" />
            <div className="flex justify-between text-xs text-slate-400">
              <span>{formatTime(from, true)}</span>
              <span className="flex gap-3">
                <span className="flex items-center gap-1">
                  <span className="h-3 w-0.5 bg-red-500" /> arrival
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-3 w-0.5 bg-emerald-500" /> departure
                </span>
              </span>
              <span>{formatTime(to, true)}</span>
            </div>
          </Card>
        </div>

        <Card className="max-h-[75vh] overflow-y-auto">
          <div className="sticky top-0 border-b border-slate-100 bg-white px-4 py-3">
            <Select value={selected ?? ''} onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : null)}>
              <option value="">All spaces (click one on the image)</option>
              {cam?.spaces
                .filter((s) => s.kind === 'space')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
            </Select>
          </div>
          {selSpace ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {stays.length === 0 && <li className="px-4 py-3 text-slate-400">No vehicles in {selSpace.label} during this window.</li>}
              {stays.map((s, i) => (
                <li key={i} className="cursor-pointer px-4 py-2.5 hover:bg-slate-50" onClick={() => setT(s.start ?? from)}>
                  <div className="font-medium text-slate-800">
                    {s.start ? formatTime(s.start, true) : 'before window'} → {s.end ? formatTime(s.end) : 'still parked'}
                  </div>
                  <div className="text-xs text-slate-500">
                    Stayed {formatDuration((s.end ?? Math.min(Date.now(), to)) - (s.start ?? from))}
                    {s.start === null && '+'}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {[...(history?.events ?? [])]
                .reverse()
                .slice(0, 200)
                .map((e, i) => (
                  <li key={i} className="flex cursor-pointer items-center gap-2 px-4 py-2 hover:bg-slate-50" onClick={() => setT(e.ts)}>
                    <span className={`size-2 rounded-full ${e.occupied ? 'bg-red-500' : 'bg-emerald-500'}`} />
                    <span className="font-medium">{cam?.spaces.find((s) => s.id === e.spaceId)?.label}</span>
                    <span className="text-slate-500">{e.occupied ? 'arrived' : 'left'}</span>
                    <span className="ml-auto text-xs text-slate-400 tabular-nums">{formatTime(e.ts, true)}</span>
                  </li>
                ))}
              {history?.events.length === 0 && <li className="px-4 py-3 text-slate-400">No arrivals or departures in this window.</li>}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

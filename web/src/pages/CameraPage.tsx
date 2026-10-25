import { History, PenTool } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatDuration, type CameraDetail } from '../api';
import { CameraOverlay } from '../components/CameraOverlay';
import { Button, Card, Checkbox, ErrorText, PageHeader, Stat, StatusBadge } from '../components/ui';
import { liveFrameUrl, useFetch, usePreloaded } from '../hooks';
import { useCameraLive } from '../live';

export function CameraPage() {
  const id = Number(useParams().id);
  const { data: cam } = useFetch<CameraDetail>(`/api/cameras/${id}`);
  const live = useCameraLive(id) ?? cam?.live ?? undefined;
  const src = usePreloaded(liveFrameUrl(id, live?.frameAt));
  const [showBoxes, setShowBoxes] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000); // refresh "occupied for" durations
    return () => clearInterval(t);
  }, []);

  if (!cam) return null;

  const liveById = new Map(live?.spaces.map((s) => [s.id, s]));
  const zoneById = new Map(live?.zones.map((z) => [z.id, z]));
  const states = Object.fromEntries(
    cam.spaces.map((s) => [s.id!, { occupied: liveById.get(s.id!)?.occupied, count: zoneById.get(s.id!)?.count, highlight: s.id === selected }]),
  );
  const parkingSpaces = cam.spaces.filter((s) => s.kind === 'space');
  const occupied = parkingSpaces.filter((s) => liveById.get(s.id!)?.occupied).length;

  return (
    <>
      <PageHeader
        title={cam.name}
        subtitle={
          <span className="inline-flex items-center gap-2">
            <StatusBadge status={live?.status ?? cam.status} />
            {live?.frameAt ? `Last frame ${new Date(live.frameAt).toLocaleTimeString()} · inference ${live.inferenceMs} ms` : null}
          </span>
        }
        actions={
          <>
            <Link to={`/timeline?camera=${id}`}>
              <Button variant="secondary">
                <History className="size-4" /> Timeline
              </Button>
            </Link>
            <Link to={`/cameras/${id}/editor`}>
              <Button>
                <PenTool className="size-4" /> Edit spaces
              </Button>
            </Link>
          </>
        }
      />
      <ErrorText error={live?.error} />
      <div className="mt-4 mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Free" value={parkingSpaces.length - occupied} tone="free" />
        <Stat label="Occupied" value={occupied} tone="taken" />
        <Stat label="Spaces" value={parkingSpaces.length} />
        <Stat label="Vehicles detected" value={live?.detections.length ?? 0} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div>
          <CameraOverlay src={src} spaces={cam.spaces} states={states} detections={showBoxes ? live?.detections : undefined} onSpaceClick={setSelected} />
          <div className="mt-2">
            <Checkbox label="Show raw vehicle detections" checked={showBoxes} onChange={setShowBoxes} />
          </div>
        </div>
        <Card className="max-h-[70vh] overflow-y-auto">
          <div className="sticky top-0 border-b border-slate-100 bg-white px-4 py-3 text-sm font-semibold text-slate-900">Spaces</div>
          {cam.spaces.length === 0 && (
            <p className="p-4 text-sm text-slate-500">
              No spaces yet.{' '}
              <Link to={`/cameras/${id}/editor`} className="underline">
                Draw them on the camera image.
              </Link>
            </p>
          )}
          <ul className="divide-y divide-slate-100">
            {cam.spaces.map((s) => {
              const l = liveById.get(s.id!);
              const z = zoneById.get(s.id!);
              return (
                <li
                  key={s.id}
                  onClick={() => setSelected(s.id!)}
                  className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm ${selected === s.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                >
                  <span className={`size-2.5 rounded-sm ${s.kind === 'zone' ? 'bg-blue-500' : l?.occupied ? 'bg-red-500' : l ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <span className="font-medium text-slate-800">{s.label}</span>
                  {!!s.reserved && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-700">reserved</span>}
                  <span className="ml-auto text-xs text-slate-500 tabular-nums">
                    {s.kind === 'zone'
                      ? `${z?.count ?? 0} vehicle${z?.count === 1 ? '' : 's'}${s.zone_limit ? ` / ${s.zone_limit}` : ''}`
                      : l
                        ? `${l.occupied ? 'occupied' : 'free'} ${formatDuration(Date.now() - l.since)}`
                        : '—'}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </>
  );
}

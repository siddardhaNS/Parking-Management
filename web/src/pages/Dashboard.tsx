import { Camera as CameraIcon, ParkingSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Camera, CameraDetail, Lot } from '../api';
import { CameraOverlay } from '../components/CameraOverlay';
import { Button, Card, EmptyState, PageHeader, StatusBadge } from '../components/ui';
import { liveFrameUrl, useFetch, usePreloaded } from '../hooks';
import { useCameraLive, useLive } from '../live';

export function Dashboard() {
  const { data: lots } = useFetch<Lot[]>('/api/lots');
  const { data: cameras } = useFetch<Camera[]>('/api/cameras');
  const live = useLive();

  if (lots && lots.length === 0) {
    return (
      <>
        <PageHeader title="Live overview" />
        <EmptyState icon={<ParkingSquare className="size-10" />} title="No parking lots yet">
          Add a lot and point a camera at it. You'll draw the spaces on a snapshot and occupancy starts streaming within seconds.
          <div className="mt-4">
            <Link to="/cameras">
              <Button>Add your first lot</Button>
            </Link>
          </div>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Live overview" subtitle="Real-time occupancy across all lots" />
      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {lots?.map((lot) => {
          const s = live.lots[lot.id] ?? lot.summary;
          const pct = s.total ? Math.round((s.occupied / s.total) * 100) : 0;
          return (
            <Card key={lot.id} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium text-slate-900">{lot.name}</h3>
                  <p className="text-xs text-slate-400">
                    {lot.cameraCount} camera{lot.cameraCount === 1 ? '' : 's'} · {s.total} spaces
                  </p>
                </div>
                <span className="text-xs font-medium text-slate-500">{pct}% full</span>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-4xl font-semibold text-emerald-600 tabular-nums">{s.free}</span>
                <span className="text-sm text-slate-500">free</span>
                <span className="ml-auto text-sm text-slate-500 tabular-nums">
                  <span className="font-medium text-red-600">{s.occupied}</span> occupied
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-emerald-100">
                <div className="h-full rounded-full bg-red-500 transition-all duration-700" style={{ width: `${pct}%` }} />
              </div>
            </Card>
          );
        })}
      </div>

      <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Cameras</h2>
      {cameras && cameras.length === 0 ? (
        <EmptyState icon={<CameraIcon className="size-10" />} title="No cameras yet">
          <Link to="/cameras" className="text-slate-900 underline">
            Add a camera
          </Link>{' '}
          to start detecting vehicles.
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cameras?.map((c) => <CameraTile key={c.id} camera={c} />)}
        </div>
      )}
    </>
  );
}

function CameraTile({ camera }: { camera: Camera }) {
  const live = useCameraLive(camera.id);
  const { data } = useFetch<CameraDetail>(`/api/cameras/${camera.id}?spaces=${camera.spaceCount}`);
  const src = usePreloaded(liveFrameUrl(camera.id, live?.frameAt));
  const states = Object.fromEntries([
    ...(live?.spaces.map((s) => [s.id, { occupied: s.occupied }]) ?? []),
    ...(live?.zones.map((z) => [z.id, { count: z.count }]) ?? []),
  ]);
  const free = live?.spaces.filter((s) => !s.occupied).length ?? 0;

  return (
    <Link to={`/cameras/${camera.id}`}>
      <Card className="overflow-hidden transition-shadow hover:shadow-md">
        <CameraOverlay src={src} spaces={data?.spaces ?? []} states={states} showLabels={false} />
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <div className="text-sm font-medium text-slate-900">{camera.name}</div>
            <div className="text-xs text-slate-400">
              {live?.spaces.length ? `${free} of ${live.spaces.length} free` : 'No spaces mapped'}
            </div>
          </div>
          <StatusBadge status={live?.status ?? camera.status} />
        </div>
      </Card>
    </Link>
  );
}

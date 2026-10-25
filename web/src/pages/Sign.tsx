import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

interface Vacancy {
  name: string;
  total: number;
  occupied: number;
  free: number;
  updatedAt: number;
}

/** Full-screen public sign for digital message boards and kiosks. Polls the public feed. */
export function Sign() {
  const { slug } = useParams();
  const [data, setData] = useState<Vacancy | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const load = () =>
      fetch(`/api/public/lots/${slug}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: Vacancy) => {
          setData(d);
          setError(false);
        })
        .catch(() => setError(true));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [slug]);

  const full = data && data.total > 0 && data.free === 0;
  const stale = data && Date.now() - data.updatedAt > 5 * 60_000;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-8 text-center text-white">
      {!data ? (
        <div className="text-2xl text-slate-500">{error ? 'Lot not found' : 'Loading…'}</div>
      ) : (
        <>
          <div className="text-[4vw] font-semibold tracking-wide text-slate-300 uppercase">{data.name}</div>
          <div className={`my-[2vh] text-[28vw] leading-none font-bold tabular-nums ${full ? 'text-red-500' : 'text-emerald-400'}`}>
            {full ? 'FULL' : data.free}
          </div>
          {!full && <div className="text-[5vw] font-medium text-slate-300">spaces available</div>}
          <div className="mt-[4vh] text-[1.6vw] text-slate-500">
            {data.occupied} of {data.total} occupied{stale && ' · data may be out of date'}
          </div>
        </>
      )}
    </div>
  );
}

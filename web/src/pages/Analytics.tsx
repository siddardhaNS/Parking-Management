import { BarChart3 } from 'lucide-react';
import { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Lot } from '../api';
import { Card, EmptyState, Field, PageHeader, Select, Stat } from '../components/ui';
import { useFetch } from '../hooks';

interface AnalyticsData {
  bucketMs: number;
  series: { ts: number; avg: number; max: number; total: number }[];
  hourly: { hour: number; rate: number | null }[];
  heatmap: (number | null)[][];
  peak: { ts: number; occupied: number; total: number };
  arrivals: number;
  avgStayMin: number | null;
  turnoverPerSpacePerDay: number;
  avgOccupancyRate: number | null;
  spaces: { id: number; label: string; camera: string; arrivals: number; utilization: number; avgStayMin: number | null }[];
}

const RANGES = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const mins = (v: number | null) => (v == null ? '—' : v < 60 ? `${Math.round(v)} min` : `${(v / 60).toFixed(1)} h`);

export function Analytics() {
  const { data: lots } = useFetch<Lot[]>('/api/lots');
  const [lotId, setLotId] = useState<number | null>(null);
  const [range, setRange] = useState<keyof typeof RANGES>('7d');
  const [now] = useState(() => Date.now());
  const lot = lotId ?? lots?.[0]?.id;
  const from = now - RANGES[range] * 86_400_000;
  const { data } = useFetch<AnalyticsData>(lot ? `/api/analytics/${lot}?from=${from}&to=${now}` : null);

  if (lots && lots.length === 0) {
    return (
      <>
        <PageHeader title="Analytics" />
        <EmptyState icon={<BarChart3 className="size-10" />} title="No data yet">
          Analytics appear once a lot has cameras with mapped spaces.
        </EmptyState>
      </>
    );
  }

  const fmtTick = (ts: number) =>
    new Date(ts).toLocaleString(undefined, range === '24h' ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' });

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Peak hours, turnover and dwell time, for pricing, staffing and expansion decisions"
        actions={
          <div className="flex gap-3">
            <Field label="Lot">
              <Select value={lot ?? ''} onChange={(e) => setLotId(Number(e.target.value))}>
                {lots?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Period">
              <Select value={range} onChange={(e) => setRange(e.target.value as keyof typeof RANGES)}>
                {Object.keys(RANGES).map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            </Field>
          </div>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Avg occupancy" value={pct(data?.avgOccupancyRate)} />
        <Stat label="Peak" value={data?.peak.total ? `${data.peak.occupied}/${data.peak.total}` : '—'} sub={data?.peak.ts ? new Date(data.peak.ts).toLocaleString() : undefined} />
        <Stat label="Arrivals" value={data?.arrivals ?? '—'} />
        <Stat label="Avg stay" value={mins(data?.avgStayMin ?? null)} />
        <Stat label="Turnover" value={data ? data.turnoverPerSpacePerDay.toFixed(1) : '—'} sub="cars per space per day" />
      </div>

      <Card className="mb-6 p-5">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Occupied spaces over time</h3>
        {data?.series.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data.series} margin={{ left: -20, right: 8 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick} tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <Tooltip labelFormatter={(ts) => new Date(Number(ts)).toLocaleString()} />
              <Area type="monotone" dataKey="total" name="Capacity" stroke="#cbd5e1" fill="none" strokeDasharray="4 4" isAnimationActive={false} />
              <Area type="monotone" dataKey="max" name="Peak" stroke="#fca5a5" fill="#fee2e2" isAnimationActive={false} />
              <Area type="monotone" dataKey="avg" name="Average" stroke="#ef4444" fill="#fecaca" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p className="py-10 text-center text-sm text-slate-400">Occupancy is sampled every minute; check back shortly.</p>
        )}
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-900">Average occupancy by hour of day</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data?.hourly ?? []} margin={{ left: -20 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="hour" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis domain={[0, 1]} tickFormatter={(v) => `${v * 100}%`} tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <Tooltip formatter={(v) => pct(Number(v))} labelFormatter={(h) => `${h}:00`} />
              <Bar dataKey="rate" name="Occupancy" fill="#0f172a" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-900">Weekly heatmap</h3>
          <div className="overflow-x-auto">
            <div className="grid min-w-[480px] grid-cols-[36px_repeat(24,1fr)] gap-0.5 text-[10px] text-slate-400">
              <span />
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="text-center">
                  {h % 3 === 0 ? h : ''}
                </span>
              ))}
              {DAYS.map((d, di) => (
                <div key={d} className="contents">
                  <span className="pr-1 leading-5">{d}</span>
                  {Array.from({ length: 24 }, (_, h) => {
                    const v = data?.heatmap[di]?.[h];
                    return <span key={h} className="h-5 rounded-sm" title={`${d} ${h}:00 · ${pct(v)}`} style={{ background: v == null ? '#f1f5f9' : `rgba(239, 68, 68, ${0.1 + v * 0.9})` }} />;
                  })}
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <h3 className="border-b border-slate-100 px-5 py-4 text-sm font-semibold text-slate-900">Per-space utilization</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="px-5 py-2 font-medium">Space</th>
                <th className="px-5 py-2 font-medium">Camera</th>
                <th className="px-5 py-2 font-medium">Utilization</th>
                <th className="px-5 py-2 text-right font-medium">Arrivals</th>
                <th className="px-5 py-2 text-right font-medium">Avg stay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data?.spaces.map((s) => (
                <tr key={s.id}>
                  <td className="px-5 py-2 font-medium">{s.label}</td>
                  <td className="px-5 py-2 text-slate-500">{s.camera}</td>
                  <td className="px-5 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full bg-red-500" style={{ width: pct(s.utilization) }} />
                      </div>
                      <span className="text-xs text-slate-500 tabular-nums">{pct(s.utilization)}</span>
                    </div>
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums">{s.arrivals}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{mins(s.avgStayMin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

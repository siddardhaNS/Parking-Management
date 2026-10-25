import { KeyRound, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, type Lot } from '../api';
import { Button, Card, Input, PageHeader } from '../components/ui';
import { useFetch } from '../hooks';

interface ApiKey {
  id: number;
  name: string;
  prefix: string;
  usage_count: number;
  created_at: number;
  last_used_at: number | null;
}

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">{children}</pre>;
}

export function Developer() {
  const keys = useFetch<ApiKey[]>('/api/api-keys');
  const { data: lots } = useFetch<Lot[]>('/api/lots');
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const origin = window.location.origin;
  const slug = lots?.find((l) => l.public)?.slug ?? 'your-lot';

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const res = await api.post<{ key: string }>('/api/api-keys', { name });
    setCreated(res.key);
    setName('');
    keys.reload();
  };

  const revoke = async (k: ApiKey) => {
    if (!confirm(`Revoke key "${k.name}"? Apps using it will stop working.`)) return;
    await api.del(`/api/api-keys/${k.id}`);
    keys.reload();
  };

  return (
    <>
      <PageHeader title="Developer API" subtitle="Integrate live vacancy into websites, apps and signs, or run occupancy detection on your own images." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Live vacancy feed</h3>
          <p className="mb-3 text-xs text-slate-500">Public, CORS-enabled JSON for each lot with "Publish live vacancy feed" turned on. No key required.</p>
          <Code>{`GET ${origin}/api/public/lots/${slug}

{ "name": "...", "total": 48, "occupied": 31,
  "free": 17, "updatedAt": 1730000000000 }`}</Code>
          <p className="mt-3 text-xs text-slate-500">
            Full-screen sign for message boards and kiosks:{' '}
            <a className="underline" href={`/sign/${slug}`} target="_blank" rel="noreferrer">
              {origin}/sign/{slug}
            </a>
          </p>
        </Card>

        <Card className="p-5">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Image detection API</h3>
          <p className="mb-3 text-xs text-slate-500">Send one image and get vehicles plus, optionally, per-space occupancy. Polygons use normalized 0–1 coordinates.</p>
          <Code>{`curl -X POST ${origin}/api/v1/detect \\
  -H "X-API-Key: lw_..." \\
  -H "Content-Type: application/json" \\
  -d '{ "image": "<base64 jpeg>",
        "spaces": [{ "id": "A1",
          "polygon": [[0.1,0.6],[0.2,0.6],[0.2,0.8],[0.1,0.8]] }] }'

# or send the raw image for vehicles only
curl -X POST ${origin}/api/v1/detect -H "X-API-Key: lw_..." \\
  -H "Content-Type: image/jpeg" --data-binary @lot.jpg`}</Code>
        </Card>
      </div>

      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-900">API keys</h3>
          <form onSubmit={create} className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name, e.g. Mobile app" required className="w-56" />
            <Button type="submit">
              <KeyRound className="size-4" /> Create key
            </Button>
          </form>
        </div>
        {created && (
          <div className="border-b border-amber-100 bg-amber-50 px-5 py-3 text-sm">
            <div className="mb-1 font-medium text-amber-800">Copy this key now; it won't be shown again.</div>
            <code className="rounded bg-white px-2 py-1 font-mono text-xs select-all">{created}</code>
          </div>
        )}
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="px-5 py-2 font-medium">Name</th>
              <th className="px-5 py-2 font-medium">Key</th>
              <th className="px-5 py-2 text-right font-medium">Requests</th>
              <th className="px-5 py-2 font-medium">Last used</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {keys.data?.map((k) => (
              <tr key={k.id}>
                <td className="px-5 py-2 font-medium">{k.name}</td>
                <td className="px-5 py-2 font-mono text-xs text-slate-500">{k.prefix}…</td>
                <td className="px-5 py-2 text-right tabular-nums">{k.usage_count}</td>
                <td className="px-5 py-2 text-slate-500">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'never'}</td>
                <td className="px-5 py-2 text-right">
                  <Button variant="ghost" onClick={() => revoke(k)} title="Revoke">
                    <Trash2 className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {keys.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-slate-400">
                  No API keys yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}

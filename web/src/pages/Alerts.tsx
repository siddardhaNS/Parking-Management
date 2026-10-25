import { Bell, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, type Lot } from '../api';
import { Button, Card, Checkbox, ErrorText, Field, Input, Modal, PageHeader, Select } from '../components/ui';
import { useFetch } from '../hooks';

type AlertType = 'reserved_occupied' | 'overstay' | 'lot_full' | 'zone_limit' | 'camera_offline';

interface Rule {
  id: number;
  name: string;
  type: AlertType;
  lot_id: number | null;
  params: { graceMin?: number; maxStayMin?: number; thresholdPct?: number; afterMin?: number };
  channels: { webhook?: string; email?: string; mqtt?: boolean };
  cooldown_min: number;
  enabled: boolean;
}

interface AlertEvent {
  id: number;
  ts: number;
  type: AlertType;
  message: string;
}

const TYPES: Record<AlertType, { label: string; help: string }> = {
  reserved_occupied: { label: 'Reserved space occupied', help: 'Fires once per vehicle when a space marked "reserved" is taken.' },
  overstay: { label: 'Overstay', help: "Fires when a vehicle exceeds the space's max stay, or the default limit below." },
  lot_full: { label: 'Lot nearly full', help: 'Fires when occupancy reaches the threshold (re-fires after the cooldown).' },
  zone_limit: { label: 'Zone limit exceeded', help: 'Fires when a monitoring zone holds more vehicles than its limit.' },
  camera_offline: { label: 'Camera offline', help: 'Fires once per outage when a camera stops delivering frames.' },
};

export function Alerts() {
  const rules = useFetch<Rule[]>('/api/alert-rules');
  const events = useFetch<AlertEvent[]>('/api/alerts?limit=100');
  const { data: lots } = useFetch<Lot[]>('/api/lots');
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const test = async (r: Rule) => {
    const res = await api.post<{ ok: boolean; errors: string[] }>(`/api/alert-rules/${r.id}/test`);
    setTestResult(res.ok ? `Test alert sent for "${r.name}".` : `Delivery problems: ${res.errors.join('; ')}`);
    events.reload();
  };

  const remove = async (r: Rule) => {
    if (!confirm(`Delete alert rule "${r.name}"?`)) return;
    await api.del(`/api/alert-rules/${r.id}`);
    rules.reload();
  };

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="Replace manual patrols with automatic notifications by webhook, email or MQTT."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" /> New rule
          </Button>
        }
      />
      {testResult && <p className="mb-4 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{testResult}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="border-b border-slate-100 px-5 py-4 text-sm font-semibold text-slate-900">Rules</h3>
          <ul className="divide-y divide-slate-100">
            {rules.data?.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                <Bell className={`size-4 ${r.enabled ? 'text-slate-700' : 'text-slate-300'}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-900">{r.name}</div>
                  <div className="truncate text-xs text-slate-400">
                    {TYPES[r.type].label} · {r.lot_id ? lots?.find((l) => l.id === r.lot_id)?.name : 'all lots'} ·{' '}
                    {[r.channels.webhook && 'webhook', r.channels.email && 'email', r.channels.mqtt && 'MQTT'].filter(Boolean).join(', ') || 'log only'}
                  </div>
                </div>
                <Button variant="ghost" onClick={() => test(r)} title="Send test alert">
                  <Send className="size-4" />
                </Button>
                <Button variant="ghost" onClick={() => setEditing(r)} title="Edit">
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" onClick={() => remove(r)} title="Delete">
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
            {rules.data?.length === 0 && <li className="px-5 py-6 text-sm text-slate-400">No rules yet.</li>}
          </ul>
        </Card>
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h3 className="text-sm font-semibold text-slate-900">Recent alerts</h3>
            <button className="text-xs text-slate-500 hover:text-slate-800" onClick={events.reload}>
              Refresh
            </button>
          </div>
          <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
            {events.data?.map((a) => (
              <li key={a.id} className="px-5 py-2.5">
                <div className="text-sm text-slate-800">{a.message}</div>
                <div className="text-xs text-slate-400">
                  {new Date(a.ts).toLocaleString()} · {TYPES[a.type]?.label ?? a.type}
                </div>
              </li>
            ))}
            {events.data?.length === 0 && <li className="px-5 py-6 text-sm text-slate-400">Nothing has fired yet.</li>}
          </ul>
        </Card>
      </div>
      {editing && lots && (
        <RuleForm
          rule={editing === 'new' ? undefined : editing}
          lots={lots}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            rules.reload();
          }}
        />
      )}
    </>
  );
}

function RuleForm({ rule, lots, onClose, onSaved }: { rule?: Rule; lots: Lot[]; onClose: () => void; onSaved: () => void }) {
  const [r, setR] = useState<Omit<Rule, 'id'>>(
    rule ?? { name: '', type: 'reserved_occupied', lot_id: null, params: {}, channels: {}, cooldown_min: 15, enabled: true },
  );
  const [error, setError] = useState<string | null>(null);
  const setParam = (k: keyof Rule['params'], v: string) => setR({ ...r, params: { ...r.params, [k]: v === '' ? undefined : Number(v) } });
  const setChannel = <K extends keyof Rule['channels']>(k: K, v: Rule['channels'][K]) => setR({ ...r, channels: { ...r.channels, [k]: v } });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const body = { ...r, name: r.name || TYPES[r.type].label };
      if (rule) await api.put(`/api/alert-rules/${rule.id}`, body);
      else await api.post('/api/alert-rules', body);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal title={rule ? 'Edit alert rule' : 'New alert rule'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Trigger" hint={TYPES[r.type].help}>
          <Select value={r.type} onChange={(e) => setR({ ...r, type: e.target.value as AlertType, params: {} })}>
            {Object.entries(TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder={TYPES[r.type].label} />
          </Field>
          <Field label="Lot">
            <Select value={r.lot_id ?? ''} onChange={(e) => setR({ ...r, lot_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">All lots</option>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {r.type === 'reserved_occupied' && (
            <Field label="Grace period (minutes)">
              <Input type="number" min={0} value={r.params.graceMin ?? 2} onChange={(e) => setParam('graceMin', e.target.value)} />
            </Field>
          )}
          {r.type === 'overstay' && (
            <Field label="Default max stay (minutes)" hint="Spaces with their own limit use that instead">
              <Input type="number" min={0} value={r.params.maxStayMin ?? ''} onChange={(e) => setParam('maxStayMin', e.target.value)} />
            </Field>
          )}
          {r.type === 'lot_full' && (
            <Field label="Threshold (% occupied)">
              <Input type="number" min={1} max={100} value={r.params.thresholdPct ?? 100} onChange={(e) => setParam('thresholdPct', e.target.value)} />
            </Field>
          )}
          {r.type === 'camera_offline' && (
            <Field label="Offline for (minutes)">
              <Input type="number" min={0} value={r.params.afterMin ?? 5} onChange={(e) => setParam('afterMin', e.target.value)} />
            </Field>
          )}
          {(r.type === 'lot_full' || r.type === 'zone_limit') && (
            <Field label="Cooldown (minutes)">
              <Input type="number" min={0} value={r.cooldown_min} onChange={(e) => setR({ ...r, cooldown_min: Number(e.target.value) })} />
            </Field>
          )}
        </div>
        <fieldset className="space-y-3 rounded-lg bg-slate-50 p-4">
          <legend className="text-xs font-medium text-slate-600">Deliver to</legend>
          <Field label="Webhook URL">
            <Input value={r.channels.webhook ?? ''} onChange={(e) => setChannel('webhook', e.target.value)} placeholder="https://example.com/hooks/parking" />
          </Field>
          <Field label="Email recipients" hint="Comma-separated. Requires SMTP in Settings.">
            <Input value={r.channels.email ?? ''} onChange={(e) => setChannel('email', e.target.value)} placeholder="ops@example.com" />
          </Field>
          <Checkbox label="Publish to MQTT topic <base>/alerts" checked={!!r.channels.mqtt} onChange={(v) => setChannel('mqtt', v)} />
        </fieldset>
        <Checkbox label="Enabled" checked={r.enabled} onChange={(v) => setR({ ...r, enabled: v })} />
        <ErrorText error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Save rule</Button>
        </div>
      </form>
    </Modal>
  );
}

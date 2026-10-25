import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Button, Card, Checkbox, ErrorText, Field, Input, PageHeader } from '../components/ui';
import { useFetch } from '../hooks';

interface SettingsData {
  smtp: { host: string; port: number; secure: boolean; user: string; pass: string; from: string };
  mqtt: { url: string; username: string; password: string; baseTopic: string };
  mqttConnected: boolean;
  model: { path: string; inputSize: number; executionProvider: string };
}

export function Settings() {
  const { data, reload } = useFetch<SettingsData>('/api/settings');
  const [form, setForm] = useState<SettingsData | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  if (!form) return null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.put('/api/settings', { smtp: form.smtp, mqtt: form.mqtt });
      setMsg('Settings saved.');
      setTimeout(reload, 1500); // give MQTT a moment to connect before showing status
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const smtp = (patch: Partial<SettingsData['smtp']>) => setForm({ ...form, smtp: { ...form.smtp, ...patch } });
  const mqtt = (patch: Partial<SettingsData['mqtt']>) => setForm({ ...form, mqtt: { ...form.mqtt, ...patch } });

  return (
    <>
      <PageHeader title="Settings" />
      <form onSubmit={save} className="space-y-6">
        <Card className="p-5">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Email (SMTP)</h3>
          <p className="mb-4 text-xs text-slate-500">Used by alert rules with email recipients.</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Host">
              <Input value={form.smtp.host} onChange={(e) => smtp({ host: e.target.value })} placeholder="smtp.example.com" />
            </Field>
            <Field label="Port">
              <Input type="number" value={form.smtp.port} onChange={(e) => smtp({ port: Number(e.target.value) })} />
            </Field>
            <div className="pt-6">
              <Checkbox label="Use TLS (port 465)" checked={form.smtp.secure} onChange={(v) => smtp({ secure: v })} />
            </div>
            <Field label="Username">
              <Input value={form.smtp.user} onChange={(e) => smtp({ user: e.target.value })} autoComplete="off" />
            </Field>
            <Field label="Password">
              <Input type="password" value={form.smtp.pass} onChange={(e) => smtp({ pass: e.target.value })} autoComplete="new-password" />
            </Field>
            <Field label="From address">
              <Input value={form.smtp.from} onChange={(e) => smtp({ from: e.target.value })} placeholder="LotWatch <alerts@example.com>" />
            </Field>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-1 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">MQTT</h3>
            {form.mqtt.url && (
              <span className={`rounded-full px-2 py-0.5 text-xs ${form.mqttConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                {form.mqttConnected ? 'connected' : 'not connected'}
              </span>
            )}
          </div>
          <p className="mb-4 text-xs text-slate-500">
            Publishes retained vacancy to <code>&lt;base&gt;/lots/&lt;slug&gt;/vacancy</code> and alerts to <code>&lt;base&gt;/alerts</code>. Works with Home Assistant, Node-RED and signage controllers.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Broker URL">
              <Input value={form.mqtt.url} onChange={(e) => mqtt({ url: e.target.value })} placeholder="mqtt://192.168.1.10:1883" />
            </Field>
            <Field label="Base topic">
              <Input value={form.mqtt.baseTopic} onChange={(e) => mqtt({ baseTopic: e.target.value })} />
            </Field>
            <Field label="Username">
              <Input value={form.mqtt.username} onChange={(e) => mqtt({ username: e.target.value })} autoComplete="off" />
            </Field>
            <Field label="Password">
              <Input type="password" value={form.mqtt.password} onChange={(e) => mqtt({ password: e.target.value })} autoComplete="new-password" />
            </Field>
          </div>
        </Card>
        <ErrorText error={error} />
        {msg && <p className="text-sm text-emerald-700">{msg}</p>}
        <Button type="submit">Save settings</Button>
      </form>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <PasswordCard />
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Detection engine</h3>
          <dl className="space-y-1.5 text-sm">
            <div className="flex gap-2">
              <dt className="w-32 text-slate-500">Model</dt>
              <dd className="truncate font-mono text-xs leading-5">{form.model.path}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-32 text-slate-500">Input size</dt>
              <dd>{form.model.inputSize}px</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-32 text-slate-500">Accelerator</dt>
              <dd className="uppercase">{form.model.executionProvider}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-400">
            Change with the MODEL_PATH, MODEL_INPUT_SIZE and EXECUTION_PROVIDER (cpu, cuda, dml) environment variables.
          </p>
        </Card>
      </div>
    </>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMsg(null);
    try {
      await api.post('/api/account/password', { current, next });
      setMsg('Password changed.');
      setCurrent('');
      setNext('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Card className="p-5">
      <h3 className="mb-3 text-sm font-semibold text-slate-900">Change password</h3>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Current password">
          <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New password">
          <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
        </Field>
        <ErrorText error={error} />
        {msg && <p className="text-sm text-emerald-700">{msg}</p>}
        <Button type="submit" variant="secondary">
          Update password
        </Button>
      </form>
    </Card>
  );
}

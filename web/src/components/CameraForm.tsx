import { useEffect, useState, type FormEvent } from 'react';
import { api, type Camera, type CameraSettings, type Lot } from '../api';
import { Button, Checkbox, ErrorText, Field, Input, Modal, Select } from './ui';

const DEFAULTS: Omit<CameraSettings, 'lot_id'> = {
  name: '',
  source_type: 'rtsp',
  source_url: '',
  interval_sec: 5,
  enabled: true,
  min_confidence: 0.3,
  high_threshold: 0.5,
  low_threshold: 0.25,
  confirm_frames: 2,
  snapshot_interval_sec: 60,
};

const PLACEHOLDERS = {
  rtsp: 'rtsp://user:pass@192.168.1.64:554/Streaming/Channels/101',
  snapshot: 'http://user:pass@192.168.1.64/ISAPI/Streaming/channels/1/picture',
  file: 'C:\\videos\\parking-lot.mp4',
};

export function CameraForm({ lots, camera, lotId, onClose, onSaved }: {
  lots: Lot[];
  camera?: Camera;
  lotId?: number;
  onClose: () => void;
  onSaved: (c: Camera) => void;
}) {
  const [form, setForm] = useState<CameraSettings>(() => {
    if (!camera) return { ...DEFAULTS, lot_id: lotId ?? lots[0]?.id };
    const { id: _id, spaceCount: _s, status: _st, error: _e, ...rest } = camera;
    return rest;
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const set = <K extends keyof CameraSettings>(k: K, v: CameraSettings[K]) => setForm((f) => ({ ...f, [k]: v }));
  const num = (k: keyof CameraSettings) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);

  const test = async () => {
    setTesting(true);
    setError(null);
    try {
      const blob = await api.post<Blob>('/api/cameras/test', { source_type: form.source_type, source_url: form.source_url });
      setPreview(URL.createObjectURL(blob));
    } catch (err) {
      setPreview(null);
      setError(`Could not grab a frame: ${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const saved = camera ? await api.put<Camera>(`/api/cameras/${camera.id}`, form) : await api.post<Camera>('/api/cameras', form);
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal title={camera ? `Edit ${camera.name}` : 'Add camera'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="North entrance" required />
          </Field>
          <Field label="Parking lot">
            <Select value={form.lot_id} onChange={(e) => set('lot_id', Number(e.target.value))}>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
          <Field label="Source type">
            <Select value={form.source_type} onChange={(e) => set('source_type', e.target.value as CameraSettings['source_type'])}>
              <option value="rtsp">RTSP stream</option>
              <option value="snapshot">HTTP snapshot URL</option>
              <option value="file">Local image / video file</option>
            </Select>
          </Field>
          <Field
            label="Source"
            hint={form.source_type === 'file' ? 'Path on the server. Video files are stepped through and looped, which is useful for demos.' : 'Credentials can be embedded in the URL.'}
          >
            <div className="flex gap-2">
              <Input value={form.source_url} onChange={(e) => set('source_url', e.target.value)} placeholder={PLACEHOLDERS[form.source_type]} required />
              <Button type="button" variant="secondary" onClick={test} disabled={!form.source_url || testing}>
                {testing ? 'Testing…' : 'Test'}
              </Button>
            </div>
          </Field>
        </div>
        {preview && <img src={preview} alt="Camera preview" className="max-h-72 w-full rounded-lg bg-slate-900 object-contain" />}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Check every (seconds)">
            <Input type="number" min={1} value={form.interval_sec} onChange={num('interval_sec')} />
          </Field>
          <Field label="Snapshot every (seconds)" hint="Frames kept for the audit timeline">
            <Input type="number" min={5} value={form.snapshot_interval_sec} onChange={num('snapshot_interval_sec')} />
          </Field>
          <div className="pt-6">
            <Checkbox label="Enabled" checked={form.enabled} onChange={(v) => set('enabled', v)} />
          </div>
        </div>

        <button type="button" className="text-xs font-medium text-slate-500 hover:text-slate-800" onClick={() => setAdvanced(!advanced)}>
          {advanced ? '▾' : '▸'} Detection tuning
        </button>
        {advanced && (
          <div className="grid gap-4 rounded-lg bg-slate-50 p-4 sm:grid-cols-4">
            <Field label="Min. vehicle confidence" hint="Lower finds distant cars">
              <Input type="number" step={0.05} min={0.05} max={0.95} value={form.min_confidence} onChange={num('min_confidence')} />
            </Field>
            <Field label="Occupied above" hint="High hysteresis threshold">
              <Input type="number" step={0.05} min={0.05} max={1} value={form.high_threshold} onChange={num('high_threshold')} />
            </Field>
            <Field label="Vacant below" hint="Low hysteresis threshold">
              <Input type="number" step={0.05} min={0} max={0.95} value={form.low_threshold} onChange={num('low_threshold')} />
            </Field>
            <Field label="Confirm frames" hint="Consecutive frames to flip">
              <Input type="number" min={1} max={20} value={form.confirm_frames} onChange={num('confirm_frames')} />
            </Field>
          </div>
        )}
        <ErrorText error={error} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">{camera ? 'Save changes' : 'Add camera'}</Button>
        </div>
      </form>
    </Modal>
  );
}

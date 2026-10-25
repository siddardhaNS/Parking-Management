import { ExternalLink, Pencil, Plus, Trash2, Video } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Camera, type Lot } from '../api';
import { CameraForm } from '../components/CameraForm';
import { Button, Card, Checkbox, ErrorText, Field, Input, Modal, PageHeader, StatusBadge } from '../components/ui';
import { useFetch } from '../hooks';
import { useLive } from '../live';

export function Cameras() {
  const navigate = useNavigate();
  const lots = useFetch<Lot[]>('/api/lots');
  const cameras = useFetch<Camera[]>('/api/cameras');
  const live = useLive();
  const [lotForm, setLotForm] = useState<Lot | 'new' | null>(null);
  const [camForm, setCamForm] = useState<{ camera?: Camera; lotId?: number } | null>(null);

  const removeLot = async (lot: Lot) => {
    if (!confirm(`Delete "${lot.name}" with all its cameras and history?`)) return;
    await api.del(`/api/lots/${lot.id}`);
    lots.reload();
    cameras.reload();
  };

  const removeCamera = async (cam: Camera) => {
    if (!confirm(`Delete camera "${cam.name}" with its spaces and history?`)) return;
    await api.del(`/api/cameras/${cam.id}`);
    cameras.reload();
    lots.reload();
  };

  return (
    <>
      <PageHeader
        title="Lots & cameras"
        subtitle="Group cameras into parking lots. Each lot gets its own live vacancy feed."
        actions={
          <Button onClick={() => setLotForm('new')}>
            <Plus className="size-4" /> New lot
          </Button>
        }
      />

      <div className="space-y-6">
        {lots.data?.map((lot) => (
          <Card key={lot.id}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="font-semibold text-slate-900">{lot.name}</h2>
                <p className="text-xs text-slate-400">
                  {lot.public ? (
                    <a href={`/sign/${lot.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-slate-700">
                      Public sign: /sign/{lot.slug} <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    'Private, no public feed'
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setCamForm({ lotId: lot.id })}>
                  <Plus className="size-4" /> Camera
                </Button>
                <Button variant="ghost" onClick={() => setLotForm(lot)} title="Edit lot">
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" onClick={() => removeLot(lot)} title="Delete lot">
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {cameras.data
                ?.filter((c) => c.lot_id === lot.id)
                .map((c) => {
                  const cl = live.cameras[c.id];
                  return (
                    <div key={c.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                      <Video className="size-4 text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <Link to={`/cameras/${c.id}`} className="text-sm font-medium text-slate-900 hover:underline">
                          {c.name}
                        </Link>
                        <div className="truncate text-xs text-slate-400">
                          {c.source_type.toUpperCase()} · {c.spaceCount} spaces · every {c.interval_sec}s
                          {(cl?.error ?? c.error) && <span className="text-red-500"> · {cl?.error ?? c.error}</span>}
                        </div>
                      </div>
                      <StatusBadge status={cl?.status ?? c.status} />
                      <div className="flex gap-1">
                        <Button variant="secondary" onClick={() => navigate(`/cameras/${c.id}/editor`)}>
                          Edit spaces
                        </Button>
                        <Button variant="ghost" onClick={() => setCamForm({ camera: c })} title="Camera settings">
                          <Pencil className="size-4" />
                        </Button>
                        <Button variant="ghost" onClick={() => removeCamera(c)} title="Delete camera">
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              {cameras.data?.every((c) => c.lot_id !== lot.id) && <p className="px-5 py-6 text-sm text-slate-400">No cameras in this lot yet.</p>}
            </div>
          </Card>
        ))}
        {lots.data?.length === 0 && <p className="text-sm text-slate-500">Create a lot to get started.</p>}
      </div>

      {lotForm && (
        <LotForm
          lot={lotForm === 'new' ? undefined : lotForm}
          onClose={() => setLotForm(null)}
          onSaved={() => {
            setLotForm(null);
            lots.reload();
          }}
        />
      )}
      {camForm && lots.data && (
        <CameraForm
          lots={lots.data}
          camera={camForm.camera}
          lotId={camForm.lotId}
          onClose={() => setCamForm(null)}
          onSaved={(saved) => {
            setCamForm(null);
            cameras.reload();
            lots.reload();
            if (!camForm.camera) navigate(`/cameras/${saved.id}/editor`);
          }}
        />
      )}
    </>
  );
}

function LotForm({ lot, onClose, onSaved }: { lot?: Lot; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(lot?.name ?? '');
  const [slug, setSlug] = useState(lot?.slug ?? '');
  const [isPublic, setPublic] = useState(lot?.public ?? true);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const body = { name, slug: slug || undefined, public: isPublic };
      if (lot) await api.put(`/api/lots/${lot.id}`, body);
      else await api.post('/api/lots', body);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal title={lot ? 'Edit lot' : 'New parking lot'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Street Garage" required autoFocus />
        </Field>
        <Field label="URL slug" hint="Used for the public vacancy feed and signage page. Leave empty to generate it.">
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="main-street" />
        </Field>
        <Checkbox label="Publish live vacancy feed" checked={isPublic} onChange={setPublic} />
        <ErrorText error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Modal>
  );
}

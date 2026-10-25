import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Button, Card, ErrorText, Field, Input } from '../components/ui';

export function Login({ needsSetup, onDone }: { needsSetup: boolean; onDone: () => void }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState(needsSetup ? 'admin' : '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(needsSetup ? '/api/auth/setup' : '/api/auth/login', { username, password });
      onDone();
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-400 font-bold text-slate-900">P</div>
          <div>
            <div className="font-semibold text-slate-900">LotWatch</div>
            <div className="text-xs text-slate-500">{needsSetup ? 'Create the administrator account' : 'Sign in to continue'}</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Username">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus={!needsSetup} required />
          </Field>
          <Field label="Password" hint={needsSetup ? 'At least 8 characters' : undefined}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={needsSetup} required />
          </Field>
          <ErrorText error={error} />
          <Button type="submit" className="w-full py-2" disabled={busy}>
            {needsSetup ? 'Create account' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

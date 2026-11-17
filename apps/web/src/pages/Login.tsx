import { useQuery } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Counter } from '../lib/types';
import { Button, ErrorBox, Field, Input, Select } from '../components/ui';

const LAST_COUNTER = 'pos-last-counter';

export function Login() {
  const { login } = useAuth();
  const counters = useQuery({ queryKey: ['login-counters'], queryFn: () => get<Counter[]>('/auth/counters') });
  const time = useQuery({ queryKey: ['time'], queryFn: () => get<{ display: string }>('/auth/time') });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [counterId, setCounterId] = useState<string>(() => {
    try {
      return localStorage.getItem(LAST_COUNTER) ?? '';
    } catch {
      return '';
    }
  });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (counters.data && counterId && !counters.data.some((c) => String(c.id) === counterId)) setCounterId('');
  }, [counters.data, counterId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await login(username, password, counterId ? Number(counterId) : null);
      try {
        localStorage.setItem(LAST_COUNTER, counterId);
      } catch {
        /* storage blocked */
      }
    } catch (x) {
      setErr(x);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-page p-4">
      <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-[#3A5BB0]/30 blur-3xl" />
      <div className="relative w-full max-w-sm">
        <form onSubmit={submit} className="space-y-4 rounded-2xl border-t-4 border-brand-500 bg-gradient-to-b from-[#12224A] to-[#0C1838] p-6 shadow-2xl">
          <div className="flex flex-col items-center gap-2 pb-2 text-center">
            <span className="rounded-xl bg-[#fff] px-3 py-2">
              <img src="/ncet-logo.png" alt="Nagarjuna College of Engineering & Technology" className="h-16 w-auto" />
            </span>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-white">General Store</h1>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-500">Point of sale</p>
          </div>
          <Field label="Username">{(id) => <Input id={id} autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />}</Field>
          <Field label="Password">{(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
          <Field label="Counter" hint="Cashiers must pick the counter they are standing at.">
            {(id) => (
              <Select id={id} value={counterId} onChange={(e) => setCounterId(e.target.value)}>
                <option value="">No counter (office work)</option>
                {counters.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="rounded-md bg-paper px-3 py-2 text-xs text-ink-mute">
            Business date comes from the store server: <span className="font-mono text-ink">{time.data?.display ?? '...'}</span>
          </div>
          <ErrorBox error={err} />
          <Button type="submit" variant="primary" size="lg" className="w-full" busy={busy}>
            Log in
          </Button>
        </form>
      </div>
    </div>
  );
}

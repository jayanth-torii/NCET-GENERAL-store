import { useQuery } from '@tanstack/react-query';
import { Boxes, Clock, ShieldCheck, Store, Zap } from 'lucide-react';
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

  // NCET ERP login: brand row + centred "Welcome back" card; on wide screens a brand panel beside it.
  return (
    <div className="grid min-h-svh bg-page lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex items-center gap-2 font-medium text-ink">
          <span className="flex size-7 items-center justify-center rounded-md bg-main text-main-fg">
            <Store className="h-4 w-4" aria-hidden />
          </span>
          NCET General Store
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="flex w-full max-w-sm animate-pop-in flex-col gap-6">
            <form onSubmit={submit} className="rounded-xl border border-line bg-surface text-ink shadow-card">
              <div className="flex flex-col items-center space-y-1.5 p-6 pb-4 text-center">
                <span className="mb-2 inline-flex rounded-lg border border-line bg-[#fff] px-3 py-2">
                  <img src="/ncet-logo.png" alt="Nagarjuna College of Engineering & Technology" className="h-12 w-auto" />
                </span>
                <h1 className="text-xl font-semibold leading-none tracking-tight">Welcome back</h1>
                <p className="text-sm text-ink-mute">Log in to the General Store point of sale</p>
              </div>
              <div className="grid gap-4 p-6 pt-0">
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
                <div className="flex items-center gap-2 rounded-md border border-line bg-paper px-3 py-2 text-xs text-ink-mute">
                  <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    Business date from the store server: <span className="font-mono text-ink">{time.data?.display ?? '...'}</span>
                  </span>
                </div>
                <ErrorBox error={err} />
                <Button type="submit" variant="primary" className="w-full" busy={busy}>
                  Log in
                </Button>
              </div>
            </form>
            <p className="text-balance text-center text-xs text-ink-mute">Use your own account. Every bill, edit and cancel is recorded against the person who is logged in.</p>
          </div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950 text-white lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-400/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-brand-500/25 blur-3xl" />
        <span className="relative w-fit rounded-xl bg-[#fff] px-4 py-3 shadow-lift">
          <img src="/ncet-logo.png" alt="" className="h-14 w-auto" />
        </span>
        <div className="relative max-w-md space-y-6">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">Campus General Store, billed in seconds.</h2>
          <ul className="space-y-3 text-sm text-white/80">
            {[
              [Zap, 'F10 saves and prints the bill, even in the rush hour'],
              [ShieldCheck, 'Personal logins, roles and a full audit trail'],
              [Boxes, 'Live stock, GRNs, expiry and GST registers'],
            ].map(([Icon, text]) => {
              const I = Icon as typeof Zap;
              return (
                <li key={text as string} className="flex items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                    <I className="h-4 w-4" aria-hidden />
                  </span>
                  {text as string}
                </li>
              );
            })}
          </ul>
        </div>
        <p className="relative text-xs text-white/60">Nagarjuna College of Engineering &amp; Technology</p>
      </div>
    </div>
  );
}

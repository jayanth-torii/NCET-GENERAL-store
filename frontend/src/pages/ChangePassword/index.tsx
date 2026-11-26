import { FormEvent, useState } from 'react';
import { post } from '../../services/http.common';
import { useAuth } from '../../app/auth';
import { Button, Card, ErrorBox, Field, Input, PageHeader } from '../../components/ui';

/** Used for the forced change at first login and from the "My password" page. Changing signs the user out everywhere. */
export function ChangePassword({ forced }: { forced?: boolean }) {
  const { me, logout } = useAuth();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (next !== again) return setErr(new Error('The two new passwords do not match'));
    if (next.length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) return setErr(new Error('Use at least 8 characters with letters and numbers'));
    setBusy(true);
    try {
      await post('/auth/change-password', { currentPassword: cur, newPassword: next });
      setDone(true);
      setTimeout(() => void logout(), 1500);
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <form onSubmit={submit} className="space-y-4 p-5">
      {forced && <p className="text-sm text-ink-soft">Welcome, {me?.fullName}. Choose your own password before you start. Nobody else should know it.</p>}
      <Field label="Current password">{(id) => <Input id={id} type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required autoFocus />}</Field>
      <Field label="New password" hint="At least 8 characters, with letters and numbers.">
        {(id) => <Input id={id} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />}
      </Field>
      <Field label="New password again">{(id) => <Input id={id} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />}</Field>
      <ErrorBox error={err} />
      {done ? (
        <p className="rounded-md bg-navy-50 px-3 py-2 text-sm text-navy-700">Password changed. Log in again with the new password.</p>
      ) : (
        <div className="flex justify-between gap-2">
          {forced ? (
            <Button type="button" variant="ghost" onClick={() => void logout()}>
              Log out
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" variant="primary" busy={busy}>
            Change password
          </Button>
        </div>
      )}
    </form>
  );

  if (forced) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page p-4">
        <div className="w-full max-w-sm animate-pop-in rounded-xl border border-line bg-surface shadow-card">
          <h1 className="px-5 pb-1 pt-5 text-xl font-semibold tracking-tight text-ink">Set your password</h1>
          {form}
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-md">
      <PageHeader title="My password" subtitle="Changing it signs you out on every computer." />
      <Card>{form}</Card>
    </div>
  );
}

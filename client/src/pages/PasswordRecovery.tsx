import {BrandLogo} from '@/components/Branding';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function PasswordRecovery({ reset = false }: { reset?: boolean }) {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/auth/' + (reset ? 'reset-password' : 'forgot-password'), {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reset ? { token, newPassword: password, confirmPassword: confirm } : { email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.errors?.[0]?.msg || data.message || 'Request failed');
      setMessage(data.message);
      if (reset) { setPassword(''); setConfirm(''); window.history.replaceState(null, '', '/reset-password'); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); }
    finally { setBusy(false); }
  }
  return <main className="min-h-screen flex items-center justify-center bg-muted p-6">
    <Card className="w-full max-w-md"><CardHeader><BrandLogo className="h-12 w-40 mb-3"/><CardTitle>{reset ? 'Choose a new password' : 'Reset your password'}</CardTitle></CardHeader>
      <CardContent><form onSubmit={submit} className="space-y-4">
        {reset ? <><p className="text-sm text-muted-foreground">Use at least eight characters, including uppercase, lowercase, a number and a special character.</p>
          <Label htmlFor="password">New password</Label><Input id="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={password} onChange={e => setPassword(e.target.value)} />
          <Label htmlFor="confirm">Confirm password</Label><Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} /></>
          : <><Label htmlFor="email">Email address</Label><Input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {message && <p role="status">{message}</p>}
        {reset && !token && <p role="alert">Open the reset link from your email, or request a new link.</p>}
        <Button className="w-full" disabled={busy || (reset && (!token || !!message))}>{busy ? 'Please wait…' : reset ? 'Reset password' : 'Send reset link'}</Button>
        <a href="/login" className="block text-center text-sm underline">Back to sign in</a>
      </form></CardContent></Card>
  </main>;
}

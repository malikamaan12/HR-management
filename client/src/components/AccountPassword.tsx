import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Eye, EyeOff, KeyRound } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { apiJson } from '@/lib/queryClient';
import { Link } from 'wouter';

export default function AccountPassword() {
  const { logout, refreshToken } = useAuth(), { toast } = useToast();
  const [password, setPassword] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [visible, setVisible] = useState(false), [error, setError] = useState('');
  const rules = [
    { label: '8–72 characters', ok: password.newPassword.length >= 8 && password.newPassword.length <= 72 },
    { label: 'Uppercase and lowercase letters', ok: /[A-Z]/.test(password.newPassword) && /[a-z]/.test(password.newPassword) },
    { label: 'At least one number', ok: /\d/.test(password.newPassword) },
    { label: 'A symbol: @ $ ! % * ? &', ok: /[@$!%*?&]/.test(password.newPassword) },
    { label: 'Only letters, numbers and the symbols above', ok: /^[A-Za-z\d@$!%*?&]+$/.test(password.newPassword) },
  ];
  const change = useMutation({ mutationFn: () => apiJson('/api/auth/change-password', { method: 'POST', body: password }), onSuccess: async () => {
    setPassword({ currentPassword: '', newPassword: '', confirmPassword: '' }); setVisible(false);
    toast({ title: 'Password changed', description: 'Sign in again with your new password. Your previous sessions have ended.' });
    try { await logout(); } catch { await refreshToken(); }
  } });
  return <form className="space-y-5" onSubmit={e => { e.preventDefault(); change.reset(); if (!rules.every(r => r.ok)) { setError('Complete all password requirements below.'); return; } if (password.newPassword !== password.confirmPassword) { setError('The new passwords do not match.'); return; } if (password.currentPassword === password.newPassword) { setError('Choose a different password from your current one.'); return; } setError(''); change.mutate(); }}>
    <p className="text-sm leading-6 text-muted-foreground">Use your current password to choose a new one. Changing it signs you out on all devices. Administrators can still reset access if you need help.</p>
    <fieldset disabled={change.isPending} className="space-y-4">{(['currentPassword', 'newPassword', 'confirmPassword'] as const).map(key => <div key={key}><label htmlFor={'account-' + key} className="mb-2 block text-sm font-medium">{({ currentPassword: 'Current password', newPassword: 'New password', confirmPassword: 'Confirm new password' })[key]}</label><Input id={'account-' + key} required type={visible ? 'text' : 'password'} autoComplete={key === 'currentPassword' ? 'current-password' : 'new-password'} maxLength={key === 'currentPassword' ? undefined : 72} value={password[key]} onChange={e => { setPassword({ ...password, [key]: e.target.value }); setError(''); change.reset(); }} aria-describedby={key === 'newPassword' ? 'password-requirements' : undefined}/></div>)}
    <Button type="button" variant="ghost" size="sm" aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff className="mr-2 h-4 w-4"/> : <Eye className="mr-2 h-4 w-4"/>}{visible ? 'Hide passwords' : 'Show passwords'}</Button>
    <ul id="password-requirements" className="grid gap-2 rounded-xl bg-muted/40 p-4 text-xs">{rules.map(rule => <li key={rule.label} className={'flex items-center gap-2 ' + (rule.ok ? 'text-primary' : 'text-muted-foreground')}><Check className={'h-3.5 w-3.5 ' + (!rule.ok ? 'opacity-30' : '')}/>{rule.label}<span className="sr-only">{rule.ok ? ' — met' : ' — not met'}</span></li>)}</ul>
    {(error || change.error) && <p role="alert" className="text-sm text-destructive">{error || change.error?.message.replace(/^\d{3}:\s*/, '')}</p>}
    <p className="text-sm text-muted-foreground">Forgot your current password? <Link href="/forgot-password" className="font-medium text-primary underline underline-offset-4">Request a reset link</Link>.</p>
    <Button type="submit" disabled={change.isPending || !password.currentPassword || !password.newPassword || !password.confirmPassword}><KeyRound className="mr-2 h-4 w-4"/>{change.isPending ? 'Updating password…' : 'Update password & sign out'}</Button></fieldset>
  </form>;
}

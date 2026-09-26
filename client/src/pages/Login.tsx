import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, ChevronDown, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, UserRound } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BrandLogo, useBranding } from '@/components/Branding';
import LanguagePicker from '@/components/LanguagePicker';
import ThemePicker from '@/components/ux/ThemePicker';
import { useLocale } from '@/contexts/LocaleContext';
import { useAuth } from '@/contexts/AuthContext';
import { defaultPublicBranding } from '@shared/branding';
import '@/styles/login.css';

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username or email is required').max(254),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});
type LoginForm = z.infer<typeof loginSchema>;

export default function Login() {
  const { t } = useLocale();
  const { data: branding = defaultPublicBranding } = useBranding();
  const { login, isAuthenticated, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showSecondFactor, setShowSecondFactor] = useState(false);
  const [secondFactor, setSecondFactor] = useState('');
  const [capsLock, setCapsLock] = useState(false);
  const busy = isLoading || authLoading;
  const hasCustomLogo = !!(branding.assets.lightLogo || branding.assets.darkLogo);

  useEffect(() => {
    if (isAuthenticated) setLocation('/');
  }, [isAuthenticated, setLocation]);

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema.extend({
      username: z.string().trim().min(1, t('Username or email is required')).max(254),
      password: z.string().min(6, t('Password must be at least 6 characters')),
    })),
    defaultValues: { username: '', password: '' },
  });

  async function onSubmit(data: LoginForm) {
    setIsLoading(true);
    setError(null);
    try {
      await login(data.username, data.password, secondFactor);
    } catch (err) {
      setError(err instanceof Error ? t(err.message) : t('Unable to sign in. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="e3-login">
      <div className="e3-login-art" aria-hidden="true">
        <img src="/images/login/e3-sculpture.webp" alt="" decoding="async" />
      </div>
      <header className="e3-login-topbar">
        <span className="e3-login-workspace"><span className="e3-login-brand-dot" aria-hidden="true" />{branding.applicationName}</span>
        <div className="e3-login-preferences"><LanguagePicker /><ThemePicker /></div>
      </header>
      <main className="e3-login-main" id="main-content">
        <div className="e3-login-manifesto" aria-hidden="true">
          <span>{t('Ideas.')}</span><span>{t('People.')}</span><span>{t('Beyond.')}</span><i />
        </div>
        <section className="e3-login-panel" aria-labelledby="login-heading">
          <div className="e3-login-panel-content">
            <div className="e3-login-brand">
              {hasCustomLogo ? <BrandLogo className="e3-login-custom-logo" /> : (
                <span className="e3-login-logo" role="img" aria-label={branding.applicationName}>
                  {/* Present the supplied transparent logo at its artwork bounds, without changing the source. */}
                  <img src="/images/login/e3-brand.png" alt="" aria-hidden="true" />
                  <img className="e3-login-logo-light-ink" src="/images/login/e3-brand.png" alt="" aria-hidden="true" />
                </span>
              )}
            </div>
            <div className="e3-login-heading">
              <p className="e3-login-eyebrow">{t('YOUR PEOPLE. YOUR WORKSPACE.')}</p>
              <h1 id="login-heading">{t('Welcome back.')}</h1>
              <p>{t('Sign in to continue your day.')}</p>
            </div>
            {error && <Alert variant="destructive" className="e3-login-error"><AlertDescription>{error}</AlertDescription></Alert>}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} noValidate aria-busy={busy} className="e3-login-form">
                <FormField control={form.control} name="username" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Username or email')}</FormLabel>
                    <div className="e3-login-input-wrap">
                      <UserRound aria-hidden="true" className="e3-login-input-icon" />
                      <FormControl><Input {...field} className="e3-login-input" placeholder={t('Enter your username or email')} autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={busy} /></FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="password" render={({ field }) => (
                  <FormItem>
                    <div className="e3-login-label-row">
                      <FormLabel>{t('Password')}</FormLabel><a href="/forgot-password">{t('Forgot password?')}</a>
                    </div>
                    <div className="e3-login-input-wrap">
                      <LockKeyhole aria-hidden="true" className="e3-login-input-icon" />
                      <FormControl><Input {...field} type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder={t('Enter your password')} disabled={busy} className="e3-login-input e3-login-password" onKeyDown={event => setCapsLock(event.getModifierState('CapsLock'))} onKeyUp={event => setCapsLock(event.getModifierState('CapsLock'))} onBlur={() => { field.onBlur(); setCapsLock(false); }} /></FormControl>
                      <button className="e3-login-password-toggle" type="button" disabled={busy} aria-label={t(showPassword ? 'Hide password' : 'Show password')} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>
                        {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                      </button>
                    </div>
                    {capsLock && <p className="e3-login-caps" role="status">{t('Caps Lock is on.')}</p>}
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="e3-login-verification">
                  <button className="e3-login-code-trigger" type="button" disabled={busy} aria-expanded={showSecondFactor} aria-controls="login-verification" onClick={() => { setShowSecondFactor(value => !value); setSecondFactor(''); }}>
                    <KeyRound aria-hidden="true" /><span>{t('Use an authenticator or recovery code')}</span><ChevronDown aria-hidden="true" className={showSecondFactor ? 'is-expanded' : ''} />
                  </button>
                  {showSecondFactor && <div id="login-verification" className="e3-login-code-panel">
                    <label htmlFor="second-factor">{t('Authenticator or recovery code')}</label>
                    <Input id="second-factor" name="secondFactor" className="e3-login-input e3-login-code-input" dir="ltr" autoFocus autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} maxLength={24} value={secondFactor} onChange={event => setSecondFactor(event.target.value.replace(/\s/g, ''))} disabled={busy} aria-describedby="login-code-hint" />
                    <p id="login-code-hint">{t('Use your authenticator code or an unused recovery code. Your password is still required.')}</p>
                  </div>}
                </div>
                <Button type="submit" className="e3-login-submit" disabled={busy}>
                  <span>{isLoading ? t('Signing in...') : authLoading ? t('Please wait…') : t('Sign In')}</span>
                  {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                </Button>
              </form>
            </Form>
            <div className="e3-login-access"><LockKeyhole aria-hidden="true" /><p>{t('Need an account?')} <span>{t('Contact your HR team.')}</span></p></div>
          </div>
        </section>
        <p className="e3-login-side-note" aria-hidden="true">{t('Great experiences.')}<br /><strong>{t('Start with our people.')}</strong></p>
      </main>
      <footer className="e3-login-footer"><span>© {new Date().getFullYear()} {branding.applicationName}</span><span>{t('All rights reserved.')}</span></footer>
    </div>
  );
}

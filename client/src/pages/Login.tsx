import ThemePicker from '@/components/ux/ThemePicker';
import LanguagePicker from '@/components/LanguagePicker';
import {useLocale} from '@/contexts/LocaleContext';
import {BrandLogo,useBranding} from '@/components/Branding';
import {defaultPublicBranding} from '@shared/branding';
import React, { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

// Define validation schema for login form
const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username or email is required').max(254),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type LoginForm = z.infer<typeof loginSchema>;

const Login: React.FC = () => {
  const {t}=useLocale();
  const {data:branding=defaultPublicBranding}=useBranding();
  const { login, isAuthenticated, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [secondFactor,setSecondFactor]=useState('');
  
  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      setLocation('/');
    }
  }, [isAuthenticated, setLocation]);

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema.extend({username:z.string().trim().min(1,t('Username or email is required')).max(254),password:z.string().min(6,t('Password must be at least 6 characters'))})),
    defaultValues: {
      username: '',
      password: '',
    },
  });

  const onSubmit = async (data: LoginForm) => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Use auth context login which now handles development mode internally
      await login(data.username, data.password,secondFactor);
      // Redirection will happen automatically in the useEffect above
      
    } catch (err: any) {
      // Handle login errors
      console.error('Login error:', err);
      setError(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-stage min-h-dvh flex items-center justify-center bg-background p-4"><div className="login-theme flex gap-2"><LanguagePicker/><ThemePicker/></div><div className="login-orb login-orb-one" aria-hidden="true"/><div className="login-orb login-orb-two" aria-hidden="true"/>
      <Card className="login-card w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <div className="flex justify-center mb-4">
            <BrandLogo className="h-16 w-48"/>
          </div>
          <CardTitle className="justify-center text-center text-2xl font-bold text-foreground"><span>{branding.applicationName}</span></CardTitle>
          <CardDescription>
            {t('Enter your credentials to access your account')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Username or email')}</FormLabel>
                    <FormControl>
                      <Input placeholder={t('Enter your username or email')} autoComplete="username" autoCapitalize="none" spellCheck={false} {...field} disabled={isLoading} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Password')}</FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input 
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          placeholder={t('Enter your password')}
                          {...field} 
                          disabled={isLoading}
                          className="pr-10" 
                        />
                      </FormControl>
                      <button
                        aria-label={t(showPassword ? 'Hide password' : 'Show password')}
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2"><label htmlFor="second-factor" className="text-sm font-medium">{t('Authenticator or recovery code')}</label><Input id="second-factor" autoComplete="one-time-code" maxLength={24} value={secondFactor} onChange={e=>setSecondFactor(e.target.value.replace(/\s/g,''))} disabled={isLoading}/><p className="text-xs text-muted-foreground">{t('Enter a code if you enabled multifactor authentication.')}</p></div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('Signing in...')}
                  </>
                ) : (
                  t('Sign In')
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <div className="text-sm text-center text-muted-foreground">
            {t('Accounts are created by your administrator. Contact HR for access.')}
          </div>
          <div className="text-sm text-center text-muted-foreground">
            <a href="/forgot-password" className="hover:text-primary underline underline-offset-4">
              {t('Forgot password?')}
            </a>
          </div>
          <div className="text-xs text-center text-muted-foreground">
            <p>© {new Date().getFullYear()} {branding.applicationName}. {t('All rights reserved.')}</p>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
};

export default Login;

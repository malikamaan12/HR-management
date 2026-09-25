import type { UserRole } from '@shared/schema';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { clearSessionCache } from '@/lib/queryClient';
import { parseAuthResponse } from './auth-session';

interface User { userId: number; username: string; role: UserRole; employeeType?: string; contractEndDate?: string;
  mfaRequired?: boolean;
  department?: string; firstName?: string; lastName?: string; email?: string; avatar?: string;
  teamId?: string; managerId?: number; directReports?: number[]; }
interface AuthContextType { user: User | null; token: string | null; isAuthenticated: boolean; isLoading: boolean;
  saveMfaRecoveryCodes: (codes:string[]) => void;
  login: (username: string, password: string,secondFactor?:string) => Promise<void>; logout: () => Promise<void>;
  refreshToken: () => Promise<string | null>; checkTokenExpiration: () => Promise<boolean>; }
const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mfaRecoveryCodes,saveMfaRecoveryCodes]=useState<string[]>([]);
  const recoveryArabic=typeof document!=='undefined'&&document.documentElement.lang==='ar';
  const currentToken = useRef<string | null>(null);
  const refreshing = useRef<Promise<string | null> | null>(null);
  const clear = useCallback(() => {
    currentToken.current = null; setUser(null); setToken(null); clearSessionCache();
    localStorage.removeItem('accessToken'); localStorage.removeItem('refreshToken');
  }, []);
  const accept = useCallback((data: unknown) => {
    const session = parseAuthResponse(data);
    currentToken.current = session.token; setToken(session.token); setUser(session.user);
    return session.token;
  }, []);
  const refreshToken = useCallback((): Promise<string | null> => {
    if (refreshing.current) return refreshing.current;
    refreshing.current = (async () => {
      try {
        const response = await fetch('/api/auth/refresh-token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (!response.ok) { clear(); return null; }
        return accept(await response.json());
      } catch { clear(); return null; }
      finally { refreshing.current = null; }
    })();
    return refreshing.current;
  }, [accept, clear]);
  const checkTokenExpiration = useCallback(async () => {
    if (!currentToken.current) return false;
    try {
      const payload = JSON.parse(atob(currentToken.current.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.exp * 1000 > Date.now() + 30000) return true;
    } catch { /* Refresh malformed or expired state using the HttpOnly cookie. */ }
    return !!await refreshToken();
  }, [refreshToken]);
  useEffect(() => {
    localStorage.removeItem('accessToken'); localStorage.removeItem('refreshToken');
    refreshToken().finally(() => setIsLoading(false));
    const timer = window.setInterval(() => { if (currentToken.current) void checkTokenExpiration(); }, 60000);
    return () => window.clearInterval(timer);
  }, [refreshToken, checkTokenExpiration]);
  const login = async (username: string, password: string,secondFactor?:string) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password,secondFactor }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Sign in failed');
      clearSessionCache(); accept(data);
    } finally { setIsLoading(false); }
  };
  const logout = async () => {
    const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error('Could not sign out. Please try again.');
    clear();
  };
  return <AuthContext.Provider value={{ user, token, isAuthenticated: !!user, isLoading, login, logout, refreshToken, checkTokenExpiration,saveMfaRecoveryCodes }}>{mfaRecoveryCodes.length?<main className="mx-auto max-w-2xl space-y-5 p-6" aria-labelledby="mfa-recovery-title"><h1 id="mfa-recovery-title" className="text-2xl font-bold">{recoveryArabic?'احفظ رموز الاسترداد':'Save your recovery codes'}</h1><p>{recoveryArabic?'تم تفعيل المصادقة وتسجيل الخروج من الجلسات السابقة. احفظ رموز الاستخدام الواحد هذه بأمان قبل مغادرة الصفحة. تظهر مرة واحدة فقط، ولا تزال كلمة المرور مطلوبة معها.':'Your authenticator is enabled and previous sessions are signed out. Store these single-use codes securely before leaving this page. They are displayed once and still require your password.'}</p><ul className="grid gap-3 font-mono sm:grid-cols-2">{mfaRecoveryCodes.map(code=><li dir="ltr" key={code}>{code}</li>)}</ul><button className="rounded bg-primary px-4 py-2 text-primary-foreground" onClick={()=>window.location.assign('/login')}>{recoveryArabic?'حفظت الرموز — تسجيل الدخول مجددًا':'I saved my codes — sign in again'}</button></main>:children}</AuthContext.Provider>;
};
export const useAuth = () => { const context = useContext(AuthContext); if (!context) throw new Error('useAuth requires AuthProvider'); return context; };

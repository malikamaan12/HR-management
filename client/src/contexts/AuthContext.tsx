import type { UserRole } from '@shared/schema';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { queryClient } from '@/lib/queryClient';
import { parseAuthResponse } from './auth-session';

interface User { userId: number; username: string; role: UserRole; employeeType?: string; contractEndDate?: string;
  department?: string; firstName?: string; lastName?: string; email?: string; avatar?: string;
  teamId?: string; managerId?: number; directReports?: number[]; }
interface AuthContextType { user: User | null; token: string | null; isAuthenticated: boolean; isLoading: boolean;
  login: (username: string, password: string) => Promise<void>; logout: () => Promise<void>;
  refreshToken: () => Promise<string | null>; checkTokenExpiration: () => Promise<boolean>; }
const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const currentToken = useRef<string | null>(null);
  const refreshing = useRef<Promise<string | null> | null>(null);
  const clear = useCallback(() => {
    currentToken.current = null; setUser(null); setToken(null); queryClient.clear();
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
  const login = async (username: string, password: string) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Sign in failed');
      queryClient.clear(); accept(data);
    } finally { setIsLoading(false); }
  };
  const logout = async () => {
    const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error('Could not sign out. Please try again.');
    clear();
  };
  return <AuthContext.Provider value={{ user, token, isAuthenticated: !!user, isLoading, login, logout, refreshToken, checkTokenExpiration }}>{children}</AuthContext.Provider>;
};
export const useAuth = () => { const context = useContext(AuthContext); if (!context) throw new Error('useAuth requires AuthProvider'); return context; };

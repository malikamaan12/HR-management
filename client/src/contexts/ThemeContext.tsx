import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
const validPreference = (value: string | null): ThemePreference => value === 'dark' || value === 'system' ? value : 'light';
const ThemeContext = createContext<{theme: 'light' | 'dark'; preference: ThemePreference; setPreference: (value: ThemePreference) => void; toggleTheme: () => void} | undefined>(undefined);

export function ThemeProvider({children}: {children: ReactNode}) {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    try { return validPreference(localStorage.getItem('theme')); } catch { return 'light'; }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const theme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    const sync = (event: StorageEvent) => { if(event.key === 'theme') setPreference(validPreference(event.newValue)); };
    window.addEventListener('storage', sync);
    return () => { media.removeEventListener('change', update); window.removeEventListener('storage', sync); };
  }, []);
  useEffect(() => {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem('theme', preference); } catch { /* Theme still works when storage is unavailable. */ }
  }, [theme, preference]);
  return <ThemeContext.Provider value={{theme, preference, setPreference, toggleTheme: () => setPreference(theme === 'dark' ? 'light' : 'dark')}}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
}

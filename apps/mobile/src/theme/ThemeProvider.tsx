import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { dark, light, type Palette } from './tokens';

export type ThemeMode = 'system' | 'light' | 'dark';

type ThemeCtx = { c: Palette; isDark: boolean; mode: ThemeMode; setMode: (m: ThemeMode) => void; toggle: () => void };

const Ctx = createContext<ThemeCtx | null>(null);
const KEY = 'back40.theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Remember the agent's choice on this phone.
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (v === 'light' || v === 'dark' || v === 'system') setModeState(v);
      })
      .catch(() => {});
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(KEY, m).catch(() => {});
  }, []);

  const isDark = mode === 'dark' || (mode === 'system' && system === 'dark');
  const toggle = useCallback(() => setMode(isDark ? 'light' : 'dark'), [isDark, setMode]);
  const value = useMemo(() => ({ c: isDark ? dark : light, isDark, mode, setMode, toggle }), [isDark, mode, setMode, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme outside ThemeProvider');
  return v;
}

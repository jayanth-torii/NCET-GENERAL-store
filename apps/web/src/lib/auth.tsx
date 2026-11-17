import { useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { get, onAuthProblem, post } from './api';
import type { Me, Role } from './types';

interface AuthState {
  me: Me | null;
  loading: boolean;
  login: (username: string, password: string, counterId: number | null) => Promise<Me>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  lock: () => Promise<void>;
  unlock: (password: string) => Promise<void>;
  can: (...roles: Role[]) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const refresh = useCallback(async () => {
    try {
      setMe(await get<Me>('/auth/me'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onAuthProblem((status) => {
      if (status === 401) {
        setMe(null);
        qc.clear();
      } else if (status === 423) {
        setMe((m) => (m ? { ...m, locked: true } : m));
      } else void refresh();
    });
  }, [refresh, qc]);

  const login = async (username: string, password: string, counterId: number | null) => {
    const u = await post<Me>('/auth/login', { username, password, counterId });
    qc.clear();
    setMe(u);
    return u;
  };

  const logout = async () => {
    await post('/auth/logout').catch(() => undefined);
    qc.clear();
    setMe(null);
  };

  /** Lock is held on the server: every request is refused until the password is entered again. */
  const lock = async () => {
    await post('/auth/lock');
    setMe((m) => (m ? { ...m, locked: true } : m));
  };

  const unlock = async (password: string) => {
    await post('/auth/verify-password', { password });
    setMe((m) => (m ? { ...m, locked: false } : m));
    void qc.invalidateQueries();
  };

  const can = (...roles: Role[]) => !!me && roles.includes(me.role);

  return <Ctx.Provider value={{ me, loading, login, logout, refresh, lock, unlock, can }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}

export const MANAGE: Role[] = ['ADMIN', 'MANAGER'];
export const BILLING: Role[] = ['ADMIN', 'MANAGER', 'CASHIER'];
export const PURCHASE: Role[] = ['ADMIN', 'MANAGER', 'STORE_KEEPER'];

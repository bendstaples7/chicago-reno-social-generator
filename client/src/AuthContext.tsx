import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { User } from 'shared';
import { verifySession, logout as apiLogout, clearToken, getToken, setToken, login as apiLogin } from './api';
import type { ErrorResponse } from 'shared';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  error: ErrorResponse | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ErrorResponse | null>(null);

  // Check existing session on mount
  useEffect(() => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    verifySession()
      .then((res) => { if (res.valid && res.user) setUser(res.user); else clearToken(); })
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string) => {
    setError(null);
    try {
      const res = await apiLogin(email);
      setToken(res.token);
      setUser(res.user);
    } catch (err) {
      setError(err as ErrorResponse);
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, error, clearError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

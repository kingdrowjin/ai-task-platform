import { createContext, useContext, useState, useCallback } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);

function readStored() {
  try {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    if (token && user) return { token, user: JSON.parse(user) };
  } catch {
    /* ignore */
  }
  return { token: null, user: null };
}

export function AuthProvider({ children }) {
  const [state, setState] = useState(readStored);

  const persist = useCallback(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    setState({ token, user });
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api.login({ email, password });
    persist(data);
  }, [persist]);

  const register = useCallback(async (email, password, name) => {
    const data = await api.register({ email, password, name });
    persist(data);
  }, [persist]);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setState({ token: null, user: null });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

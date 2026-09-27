'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/auth/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({
    status: 'loading',
    user: null,
  });

  useEffect(() => {
    let active = true;

    api('/auth/me')
      .then((payload) => {
        if (!active) return;
        setState({ status: 'authenticated', user: payload.user });
      })
      .catch(() => {
        if (!active) return;
        setState({ status: 'unauthenticated', user: null });
      });

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(() => ({
    status: state.status,
    user: state.user,
    setUser(user) {
      setState(user
        ? { status: 'authenticated', user }
        : { status: 'unauthenticated', user: null });
    },
  }), [state.status, state.user]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return value;
}

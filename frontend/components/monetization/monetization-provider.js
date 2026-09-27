'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { publicConfig } from '../../lib/config';
import { AD_TIMEOUT_MS } from '../../lib/monetization/policy';

const MonetizationContext = createContext({
  status: 'collapsed',
  consentRequired: false,
  placements: [],
});

export function MonetizationProvider({ children }) {
  const pathname = usePathname() || '';
  const admin = pathname === '/admin' || pathname.startsWith('/admin/');
  const [state, setState] = useState({ status: 'collapsed', consentRequired: false, placements: [] });

  useEffect(() => {
    if (admin) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AD_TIMEOUT_MS);
    fetch(`${publicConfig.apiUrl}/monetization/config`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const data = payload?.data;
        if (!data) return;
        setState({
          status: 'ready',
          consentRequired: Boolean(data.consentRequired),
          placements: Array.isArray(data.placements) ? data.placements : [],
        });
      })
      .catch(() => {
        setState({ status: 'collapsed', consentRequired: false, placements: [] });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [admin]);

  const value = useMemo(() => state, [state]);
  return (
    <MonetizationContext.Provider value={value}>
      {children}
    </MonetizationContext.Provider>
  );
}

export function useMonetization() {
  return useContext(MonetizationContext);
}

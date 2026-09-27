'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { recordClientEvent } from '../../lib/analytics/client';

const PRIVATE_PREFIXES = ['/admin', '/account', '/settings', '/my-list', '/login', '/register'];

export function AnalyticsCollector() {
  const pathname = usePathname() || '/';

  useEffect(() => {
    if (PRIVATE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return undefined;
    const page = pageSubject(pathname);
    if (page) recordClientEvent({ name: 'PAGE_VIEW', subject: page });
    const movie = pathname.match(/^\/movie\/([a-z0-9]+(?:-[a-z0-9]+)*)$/);
    if (movie) recordClientEvent({ name: 'MOVIE_VIEW', subject: movie[1] });
    observeVitals(vitalPage(pathname));
    observePwa();
    document.querySelectorAll('[data-analytics]').forEach((node) => {
      const value = node.getAttribute('data-analytics') || '';
      const key = `beez_imp_${value}`;
      if (!value || window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, '1');
      const [kind, subject] = value.split(':');
      if (kind === 'rail') recordClientEvent({ name: 'RAIL_IMPRESSION', subject });
      if (kind === 'rec') recordClientEvent({ name: 'RECOMMENDATION_IMPRESSION', subject });
    });

    function onClick(event) {
      const link = event.target instanceof Element ? event.target.closest('a[href*="/movie/"]') : null;
      const section = link?.closest('[data-analytics]');
      const value = section?.getAttribute('data-analytics') || '';
      if (!value) {
        if (pathname.startsWith('/search') && link) {
          const slug = link.getAttribute('href')?.split('/movie/')[1];
          const query = new URLSearchParams(window.location.search).get('q') || '';
          if (slug) recordClientEvent({ name: 'SEARCH_RESULT_CLICK', subject: slug, query });
        }
        return;
      }
      const [kind, subject] = value.split(':');
      if (kind === 'rail') recordClientEvent({ name: 'RAIL_CLICK', subject });
      if (kind === 'rec') recordClientEvent({ name: 'RECOMMENDATION_CLICK', subject });
    }

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [pathname]);

  return null;
}

function pageSubject(pathname) {
  if (pathname === '/') return 'home';
  if (pathname === '/search') return 'search';
  if (pathname === '/movies') return 'movies';
  if (pathname === '/genres') return 'genres';
  if (pathname === '/countries') return 'countries';
  if (pathname === '/collections') return 'collections';
  if (/^\/movies\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pathname)) return `country:${pathname.slice(8)}`;
  if (/^\/movie\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pathname)) return `movie:${pathname.slice(7)}`;
  return '';
}

function vitalPage(pathname) {
  if (pathname === '/') return 'home';
  if (pathname === '/search') return 'search';
  if (pathname.startsWith('/movie/')) return 'movie';
  return '';
}

function observePwa() {
  if (window.sessionStorage.getItem('beez_pwa_seen')) return;
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  if (standalone) {
    window.sessionStorage.setItem('beez_pwa_seen', '1');
    recordClientEvent({ name: 'PWA_OPEN', subject: 'open' });
  }
  window.addEventListener('appinstalled', () => {
    recordClientEvent({ name: 'PWA_INSTALL', subject: 'install' });
  }, { once: true });
  window.addEventListener('beezmovies:sw-failed', () => {
    recordClientEvent({ name: 'PWA_FAILURE', subject: 'service-worker' });
  }, { once: true });
}

function observeVitals(page) {
  if (!page || typeof PerformanceObserver === 'undefined') return;
  try {
    const lcp = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (!last) return;
      recordClientEvent({
        name: 'WEB_VITAL',
        subject: `lcp:${page}`,
        durationMs: Math.round(last.startTime),
      });
      lcp.disconnect();
    });
    lcp.observe({ type: 'largest-contentful-paint', buffered: true });
    let cls = 0;
    let inp = 0;
    const shifts = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) cls += entry.value;
      }
    });
    shifts.observe({ type: 'layout-shift', buffered: true });
    const events = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > inp) inp = entry.duration;
      }
    });
    events.observe({ type: 'event', buffered: true, durationThreshold: 40 });
    window.setTimeout(() => {
      recordClientEvent({
        name: 'WEB_VITAL',
        subject: `cls:${page}`,
        durationMs: Math.min(Math.round(cls * 1000), 10000),
      });
      if (inp > 0) {
        recordClientEvent({
          name: 'WEB_VITAL',
          subject: `inp:${page}`,
          durationMs: Math.round(inp),
        });
      }
      shifts.disconnect();
      events.disconnect();
    }, 8000);
  } catch {
    // The browser does not expose this measurement.
  }
}

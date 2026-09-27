'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { UI_LOCALES, directionFor } from '../../lib/i18n';

const STORAGE_KEY = 'beez_locale';

export function LanguageSelector() {
  const locales = Object.entries(UI_LOCALES);
  const [code, setCode] = useState('en');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const next = UI_LOCALES[stored] ? stored : 'en';
    setCode(next);
    document.documentElement.lang = next;
    document.documentElement.dir = directionFor(next);
  }, []);

  function choose(next) {
    if (!UI_LOCALES[next]) return;
    setCode(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = next;
    document.documentElement.dir = directionFor(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-xs uppercase tracking-[0.14em] text-muted" htmlFor="interface-language">
        Language
      </label>
      <select
        id="interface-language"
        value={code}
        onChange={(event) => choose(event.target.value)}
        className="min-h-11 bg-surface px-2 text-sm text-ink"
      >
        {locales.map(([value, locale]) => (
          <option key={value} value={value}>{locale.label}</option>
        ))}
      </select>
      <Link href="/languages" className="inline-flex min-h-11 items-center text-honey">Catalog languages</Link>
    </div>
  );
}

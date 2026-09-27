'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '../../lib/api/client';
import { getCountries, getGenres } from '../../lib/api/catalog';
import { useAuth } from '../auth/auth-provider';
import { AccountNav } from './account-nav';

export function SettingsView() {
  const router = useRouter();
  const { status, setUser } = useAuth();
  const [genres, setGenres] = useState([]);
  const [countries, setCountries] = useState([]);
  const [selected, setSelected] = useState([]);
  const [selectedCountries, setSelectedCountries] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (status !== 'authenticated') return undefined;
    let active = true;
    Promise.all([getGenres(), getCountries(), api('/me/preferences'), api('/auth/sessions')])
      .then(([genreBody, countryBody, preferenceBody, sessionBody]) => {
        if (!active) return;
        setGenres(genreBody.data || []);
        setCountries(countryBody.data || []);
        setSelected(preferenceBody.data?.genreSlugs || []);
        setSelectedCountries(preferenceBody.data?.countrySlugs || []);
        setSessions(sessionBody.data || []);
      })
      .catch(() => {
        if (active) setError('Settings could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [status]);

  async function run(work, success) {
    setMessage('');
    setError('');
    try {
      await work();
      setMessage(success);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The request failed.');
    }
  }

  if (status === 'loading') {
    return <p className="page-wrap py-16 text-sm text-muted">Checking your session…</p>;
  }

  if (status !== 'authenticated') {
    return <p className="page-wrap py-16 text-muted">Sign in to change account settings.</p>;
  }

  return (
    <div className="page-wrap max-w-xl py-8 md:py-10">
      <AccountNav />
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Settings</h1>
      {message ? <p className="mt-4 text-sm text-ink">{message}</p> : null}
      {error ? <p className="mt-4 text-sm text-honey" role="alert">{error}</p> : null}

      <form
        className="mt-8 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => api('/me/preferences', {
            method: 'PUT',
            body: { genreSlugs: selected, countrySlugs: selectedCountries },
          }), 'Preferences saved.');
        }}
      >
        <fieldset>
          <legend className="text-sm text-muted">Preferred genres</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {genres.map((genre) => (
              <label key={genre.slug} className="min-h-11 px-2 py-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="mr-2"
                  checked={selected.includes(genre.slug)}
                  onChange={() => {
                    setSelected((current) => (
                      current.includes(genre.slug)
                        ? current.filter((slug) => slug !== genre.slug)
                        : [...current, genre.slug].slice(0, 8)
                    ));
                  }}
                />
                {genre.name}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="pt-4">
          <legend className="text-sm text-muted">Saved countries</legend>
          <p className="mt-2 text-xs text-muted">These are countries you choose. They are not guessed from the movies you open.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {countries.map((country) => (
              <label key={country.slug} className="min-h-11 px-2 py-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="mr-2"
                  checked={selectedCountries.includes(country.slug)}
                  onChange={() => {
                    setSelectedCountries((current) => (
                      current.includes(country.slug)
                        ? current.filter((slug) => slug !== country.slug)
                        : [...current, country.slug].slice(0, 8)
                    ));
                  }}
                />
                {country.displayName || country.name}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" className="min-h-11 bg-elevated px-4 text-sm text-ink">Save preferences</button>
      </form>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-ink">Sessions</h2>
        <ul className="mt-3 space-y-3 text-sm">
          {sessions.map((session) => (
            <li key={session.id} className="border-b border-white/10 pb-3">
              <p className="text-ink">{session.current ? 'This session' : 'Other session'}</p>
              <p className="text-muted">{session.device}</p>
              {session.current ? null : (
                <button
                  type="button"
                  className="mt-2 min-h-11 text-honey"
                  onClick={() => run(async () => {
                    await api(`/auth/sessions/${session.id}/revoke`, { method: 'POST', body: {} });
                    setSessions((current) => current.filter((item) => item.id !== session.id));
                  }, 'Session signed out.')}
                >
                  Sign out this session
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <form
        className="mt-10 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          run(async () => {
            await api('/auth/password', { method: 'POST', body: { currentPassword, password, confirm: true } });
            setUser(null);
            router.push('/login');
          }, 'Password changed.');
        }}
      >
        <h2 className="text-lg font-semibold text-ink">Change password</h2>
        <label className="block text-sm text-muted">Current password
          <input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="mt-1 block min-h-11 w-full bg-surface px-3 text-ink" />
        </label>
        <label className="block text-sm text-muted">New password
          <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 block min-h-11 w-full bg-surface px-3 text-ink" />
        </label>
        <button type="submit" className="min-h-11 bg-honey px-4 text-sm font-semibold text-obsidian">Update password</button>
      </form>

      <div className="mt-10">
        <h2 className="text-lg font-semibold text-ink">Viewing history</h2>
        <button
          type="button"
          className="mt-3 min-h-11 border border-white/15 px-4 text-sm text-ink"
          onClick={() => run(() => api('/me/recent', { method: 'DELETE' }), 'Viewing history cleared.')}
        >
          Clear recently viewed
        </button>
      </div>

      <form
        className="mt-10 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!window.confirm('Delete this account? This cannot be undone.')) return;
          run(async () => {
            await api('/auth/account/delete', { method: 'POST', body: { password: deletePassword, confirm: true } });
            setUser(null);
            router.push('/');
          }, 'Account deleted.');
        }}
      >
        <h2 className="text-lg font-semibold text-ink">Delete account</h2>
        <p className="text-sm text-muted">This removes your list, favorites, and viewing history, revokes sessions, and replaces your email. Login and security records stay without your password. Public movies stay available.</p>
        <label className="block text-sm text-muted">Password
          <input type="password" autoComplete="current-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} className="mt-1 block min-h-11 w-full bg-surface px-3 text-ink" />
        </label>
        <button type="submit" className="min-h-11 border border-white/15 px-4 text-sm text-ink">Delete account</button>
      </form>
    </div>
  );
}

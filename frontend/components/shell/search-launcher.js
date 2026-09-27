'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Artwork } from '../movies/artwork';
import { getSearchSuggestions } from '../../lib/api/search';

const RECENT_KEY = 'beez_recent_searches';

function readRecent() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string' && item.trim()).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function destination(item) {
  if (item.type === 'movie' && item.slug) return `/movie/${item.slug}`;
  if (item.type === 'genre' && item.slug) return `/genre/${item.slug}`;
  if (item.type === 'collection' && item.slug) return `/collection/${item.slug}`;
  if (item.type === 'country' && item.slug) return `/movies/${item.slug}`;
  return `/search?q=${encodeURIComponent(item.label)}`;
}

export function SearchLauncher({ initial = '', presentation = 'icon' }) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef(null);
  const [term, setTerm] = useState(initial);
  const [open, setOpen] = useState(presentation === 'field');
  const [suggestions, setSuggestions] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setRecent(readRecent());
  }, []);

  useEffect(() => {
    if (term.trim().length < 2) {
      setSuggestions([]);
      setLoading(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      setLoading(true);
      getSearchSuggestions(term.trim())
        .then((body) => setSuggestions(body.data || []))
        .catch(() => setSuggestions([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    if (presentation === 'icon' && open) inputRef.current?.focus();
  }, [open, presentation]);

  function remember(query) {
    const next = [query, ...readRecent().filter((item) => item.toLowerCase() !== query.toLowerCase())].slice(0, 5);
    try {
      sessionStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // A private browser can reject storage. Search still continues.
    }
    setRecent(next);
  }

  function go(value) {
    const query = value.trim();
    setOpen(presentation === 'field');
    setSuggestions([]);
    if (!query) return;
    remember(query);
    router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  function choose(item) {
    setTerm(item.label);
    remember(item.label);
    setSuggestions([]);
    setOpen(false);
    router.push(destination(item));
  }

  const field = (
    <div className="relative w-full">
      <label className="sr-only" htmlFor={`${listId}-input`}>Search movies</label>
      <input
        id={`${listId}-input`}
        ref={inputRef}
        value={term}
        autoComplete="off"
        enterKeyHint="search"
        placeholder="Titles, people, genres"
        role="combobox"
        aria-expanded={suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        className="min-h-11 w-full border border-white/15 bg-surface px-3 pr-16 text-sm text-ink outline-none placeholder:text-muted"
        onChange={(event) => {
          setTerm(event.target.value);
          setSuggestions([]);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            go(term);
          }
          if (event.key === 'Escape') {
            setSuggestions([]);
            if (presentation === 'icon') setOpen(false);
          }
        }}
      />
      {term ? (
        <button
          type="button"
          className="absolute right-2 top-1/2 min-h-11 -translate-y-1/2 px-2 text-xs text-honey"
          onClick={() => {
            setTerm('');
            setSuggestions([]);
            inputRef.current?.focus();
          }}
        >
          Clear
        </button>
      ) : null}
      {loading ? <p className="mt-2 text-xs text-muted">Searching…</p> : null}
      {!term.trim() && recent.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Recent searches">
          {recent.map((item) => (
            <li key={item}>
              <button type="button" className="min-h-11 bg-elevated px-3 text-sm text-ink" onClick={() => go(item)}>
                {item}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="min-h-11 px-3 text-sm text-honey"
              onClick={() => {
                try { sessionStorage.removeItem(RECENT_KEY); } catch { /* storage may be blocked */ }
                setRecent([]);
              }}
            >
              Clear recent
            </button>
          </li>
        </ul>
      ) : null}
      {suggestions.length > 0 ? (
        <ul id={listId} role="listbox" className="absolute z-50 mt-1 max-h-80 w-full overflow-auto border border-white/10 bg-elevated">
          {suggestions.map((item) => (
            <li key={`${item.type}-${item.slug || item.id || item.label}`} role="presentation">
              <button
                type="button"
                role="option"
                className="flex min-h-14 w-full items-center justify-between gap-3 px-3 text-left text-sm text-ink"
                onClick={() => choose(item)}
              >
                {item.type === 'movie' ? (
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="h-12 w-8 shrink-0 overflow-hidden bg-surface">
                      <Artwork src={item.poster} alt="" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">{item.label}</span>
                      {item.year ? <span className="text-xs text-muted">{item.year}</span> : null}
                    </span>
                  </span>
                ) : <span className="truncate">{item.label}</span>}
                <span className="text-[0.65rem] uppercase tracking-[0.14em] text-muted">{item.type}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  if (presentation === 'field') {
    return <div className="w-full max-w-xl">{field}</div>;
  }

  return (
    <div className="flex items-center">
      <button
        type="button"
        className="flex h-11 w-11 items-center justify-center text-ink"
        aria-label={open ? 'Close search' : 'Search'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <SearchIcon />
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 bg-obsidian px-4 pt-4 md:static md:inset-auto md:w-72 md:bg-transparent md:p-0">
          <div className="mb-3 flex items-center justify-between md:hidden">
            <p className="text-sm font-semibold text-ink">Search</p>
            <button type="button" className="min-h-11 px-2 text-sm text-honey" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          {field}
        </div>
      ) : null}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
      <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 12.5 15.5 16" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

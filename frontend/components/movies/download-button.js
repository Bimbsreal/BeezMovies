'use client';

import { useState } from 'react';
import { ApiError } from '../../lib/api/client';
import { requestDownload, requestEpisodeDownload } from '../../lib/api/catalog';

const LABELS = {
  ready: 'Download',
  resolving: 'Preparing download...',
  starting: 'Starting download...',
  unavailable: 'Download unavailable',
  provider: 'Provider temporarily unavailable',
  failure: 'Try again',
};

const UNAVAILABLE = new Set([
  'MEDIA_UNAVAILABLE',
  'MEDIA_NOT_FOUND',
  'DOWNLOAD_NOT_SUPPORTED',
  'MEDIA_REFERENCE_UNAVAILABLE',
]);

export function DownloadButton({ slug, season, episode, available = false, prominent = false }) {
  const [state, setState] = useState(available ? 'ready' : 'unavailable');
  const [message, setMessage] = useState(available ? '' : 'Download unavailable');

  async function start() {
    if (state === 'resolving' || state === 'unavailable') return;
    setState('resolving');
    setMessage('Preparing download...');
    try {
      const body = season && episode
        ? await requestEpisodeDownload(slug, season, episode)
        : await requestDownload(slug);
      const href = body.data?.href;
      const localHandoff = body.data?.state === 'ready'
        && body.data?.resourceType === 'download'
        && typeof href === 'string'
        && href.startsWith('/')
        && !href.startsWith('//');
      if (localHandoff) {
        const anchor = document.createElement('a');
        anchor.href = href;
        anchor.download = body.data.filename || '';
        anchor.rel = 'noopener';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setState('starting');
        setMessage('Starting download...');
        return;
      }
      setState('unavailable');
      setMessage('Download unavailable');
    } catch (error) {
      if (error instanceof ApiError && UNAVAILABLE.has(error.code)) {
        setState('unavailable');
        setMessage('Download unavailable');
        return;
      }
      if (error instanceof ApiError && error.code === 'PROVIDER_UNAVAILABLE') {
        setState('provider');
        setMessage('Provider temporarily unavailable');
        return;
      }
      if (error instanceof ApiError && error.code === 'MEDIA_EXPIRED') {
        setState('failure');
        setMessage('This download link has expired.');
        return;
      }
      setState('failure');
      setMessage(error instanceof ApiError && (error.code === 'TIMEOUT' || error.code === 'PROVIDER_TIMEOUT')
        ? (error.message || 'The download request timed out.')
        : 'Download could not be completed.');
    }
  }

  if (state === 'unavailable') {
    return <p className="min-h-11 text-sm text-muted" role="status">{message || 'Download unavailable'}</p>;
  }

  const disabled = state === 'resolving';
  const tone = state === 'ready' || state === 'starting'
    ? 'bg-honey text-obsidian hover:bg-bee'
    : 'border border-white/15 bg-transparent text-muted';

  return (
    <div className={prominent ? 'min-w-44' : ''}>
      <button
        type="button"
        onClick={start}
        disabled={disabled}
        aria-busy={state === 'resolving'}
        className={`min-h-11 px-5 text-sm font-semibold uppercase tracking-[0.14em] ${tone} disabled:cursor-not-allowed`}
      >
        {LABELS[state]}
      </button>
      <p className="mt-2 min-h-5 text-xs text-muted" aria-live="polite">{message}</p>
    </div>
  );
}

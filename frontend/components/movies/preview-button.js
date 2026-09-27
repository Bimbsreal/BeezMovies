'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AD_TIMEOUT_MS } from '../../lib/monetization/policy';
import { recordPlacement, usePreRoll } from '../monetization/sponsored-content';
import { releaseTrailer, TrailerPlayer } from './trailer-player';
import { recordClientEvent } from '../../lib/analytics/client';

export function PreviewButton({ src, title, poster, label = 'Play trailer', prominent = false, analyticsSlug = '' }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState('content');
  const preRoll = usePreRoll();
  const titleId = useId();
  const triggerRef = useRef(null);
  const closeRef = useRef(null);
  const videoSlot = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !videoSlot.current) return;
      const items = [...videoSlot.current.querySelectorAll('button, input, video, a[href]')].filter((item) => !item.disabled);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      releaseTrailer(videoSlot.current?.querySelector('video'));
      document.body.style.overflow = previousOverflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || phase !== 'advertisement') return undefined;
    const timer = setTimeout(() => setPhase('content'), AD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [open, phase]);

  if (!src) return null;

  function openPreview() {
    const showAd = Boolean(preRoll?.creative);
    setPhase(showAd ? 'advertisement' : 'content');
    setOpen(true);
    if (showAd) recordPlacement('VIDEO_PRE_ROLL', 'impression');
    else if (analyticsSlug) recordClientEvent({ name: 'TRAILER_PLAY', subject: analyticsSlug });
  }

  function showTrailer(eventName) {
    if (preRoll?.creative) recordPlacement('VIDEO_PRE_ROLL', eventName);
    setPhase('content');
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openPreview}
        className={prominent
          ? 'min-h-11 bg-honey px-5 text-sm font-semibold uppercase tracking-[0.14em] text-obsidian hover:bg-bee'
          : 'min-h-11 border border-white/20 px-5 text-sm font-semibold uppercase tracking-[0.14em] text-ink'}
      >
        {label}
      </button>
      {open ? (
        <div className="trailer-modal fixed inset-0 z-50 flex bg-obsidian/95 p-0 sm:items-center sm:justify-center sm:p-6" role="presentation">
          <div
            ref={videoSlot}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="trailer-dialog flex h-[100dvh] w-full flex-col bg-obsidian p-4 sm:h-auto sm:max-w-5xl sm:bg-surface"
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <h2 id={titleId} className="text-base font-semibold text-ink">{title}</h2>
              <button ref={closeRef} type="button" className="min-h-11 min-w-11 px-3 text-sm text-honey" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            {phase === 'advertisement' && preRoll?.creative ? (
              <div className="aspect-video bg-obsidian p-4" aria-label="Advertisement">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-honey">Advertisement</p>
                <p className="mt-2 text-sm font-medium text-ink">{preRoll.creative.headline}</p>
                <p className="mt-1 text-xs text-muted">{preRoll.creative.body}</p>
                <button type="button" className="mt-4 min-h-11 px-3 text-sm text-honey" onClick={() => showTrailer('completion')}>
                  Continue to trailer
                </button>
              </div>
            ) : (
              <TrailerPlayer src={src} poster={poster} title={title} />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api/client';
import { placementVisible } from '../../lib/monetization/policy';
import { useMonetization } from './monetization-provider';

function sessionId() {
  const key = 'beezmovies_monetization_session';
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(key, created);
  return created;
}

function usePlacement(slug) {
  const state = useMonetization();
  const [viewport, setViewport] = useState(1280);
  const placement = state.placements.find((item) => item.slug === slug) || null;
  useEffect(() => {
    const apply = () => setViewport(window.innerWidth);
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);
  const visible = placementVisible(placement, {
    viewport,
    consentRequired: state.consentRequired,
    consentGranted: !state.consentRequired,
  });
  return visible ? placement : null;
}

function record(placement, type) {
  const id = sessionId();
  api('/monetization/events', {
    method: 'POST',
    body: { type, placement, sessionId: id },
  }).catch(() => {});
}

export function SponsoredContent({ placement, compact = false }) {
  const live = usePlacement(placement);
  const [dismissed, setDismissed] = useState(false);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    setDismissed(window.sessionStorage.getItem(`beezmovies_ad_hide_${placement}`) === '1');
    setChecked(true);
  }, [placement]);
  useEffect(() => {
    if (checked && live && !dismissed) record(live.slug, 'impression');
  }, [checked, live, dismissed]);
  if (!live?.creative || dismissed) return null;
  const content = (
    <>
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-honey">Sponsored</p>
      <p className="mt-1 text-sm font-medium text-ink">{live.creative.headline}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">{live.creative.body}</p>
    </>
  );
  return (
    <aside className={compact ? 'monetization-inline' : 'movie-card monetization-inline'} aria-label="Sponsored">
      <button
        type="button"
        className="float-right text-xs text-muted"
        onClick={() => {
          window.sessionStorage.setItem(`beezmovies_ad_hide_${placement}`, '1');
          setDismissed(true);
        }}
      >
        Dismiss
      </button>
      {live.creative.href ? (
        <a href={live.creative.href} className="block" onClick={() => record(live.slug, 'click')}>
          {content}
        </a>
      ) : content}
    </aside>
  );
}

export function InFeedSlot() {
  return <SponsoredContent placement="IN_FEED_NATIVE" />;
}

export function DetailRecommendation() {
  return (
    <div className="page-wrap pb-2">
      <SponsoredContent placement="MOVIE_DETAIL_RECOMMENDATION" compact />
    </div>
  );
}

export function FooterNative() {
  return <SponsoredContent placement="FOOTER_NATIVE" compact />;
}

export function SideRail() {
  return (
    <div className="monetization-rail">
      <SponsoredContent placement="DESKTOP_SIDE_RAIL" compact />
    </div>
  );
}

export function usePreRoll() {
  return usePlacement('VIDEO_PRE_ROLL');
}

export function recordPlacement(placement, type) {
  record(placement, type);
}

'use client';

import { useEffect, useState } from 'react';
import { STARTUP_ASSET, STARTUP_BEE, STARTUP_PHASES } from '../../lib/startup/phases';
import { STARTUP_SESSION_KEY, STARTUP_TIMING } from '../../lib/startup/boot';

function startupPreview() {
  return process.env.NODE_ENV !== 'production'
    && /(?:^|[?&])startup=1(?:&|$)/.test(window.location.search);
}

function startupMode() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  const preview = startupPreview();
  const root = document.documentElement;
  if (!standalone && !preview) {
    delete root.dataset.startup;
    return null;
  }
  if (root.dataset.startup === 'cinematic' || root.dataset.startup === 'brief') {
    return root.dataset.startup;
  }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let seen = false;
  if (!preview) {
    try {
      seen = window.sessionStorage.getItem(STARTUP_SESSION_KEY) === 'seen';
    } catch {
      seen = false;
    }
  }
  const mode = reduced || seen ? 'brief' : 'cinematic';
  root.dataset.startup = mode;
  return mode;
}

export function StartupSequence({ children }) {
  const [overlay, setOverlay] = useState(true);
  const [beeSrc, setBeeSrc] = useState(STARTUP_BEE);
  const [beeHidden, setBeeHidden] = useState(false);
  const matte = beeSrc === STARTUP_ASSET;

  useEffect(() => {
    const mode = startupMode();
    if (!mode) {
      setOverlay(false);
      return undefined;
    }
    try {
      window.sessionStorage.setItem(STARTUP_SESSION_KEY, 'seen');
    } catch {
      // A blocked session store still lets this launch finish.
    }
    const duration = mode === 'brief' ? STARTUP_TIMING.briefMs : STARTUP_TIMING.cinematicMs;
    const timer = window.setTimeout(() => {
      delete document.documentElement.dataset.startup;
      setOverlay(false);
    }, duration);
    return () => window.clearTimeout(timer);
  }, []);

  function failBee() {
    if (beeSrc === STARTUP_ASSET) {
      setBeeHidden(true);
      return;
    }
    setBeeSrc(STARTUP_ASSET);
  }

  const beeClass = matte ? ' is-matte' : '';

  return (
    <div
      className="min-h-screen"
      data-startup-ready={overlay ? 'playing' : 'complete'}
      data-startup-asset={STARTUP_ASSET}
      data-startup-phases={STARTUP_PHASES.map((phase) => phase.id).join(' ')}
    >
      {overlay ? (
        <div className="startup-veil" aria-hidden="true" inert>
          <div className="startup-stage">
            <div className="startup-flight">
              {beeHidden ? null : (
                <div className="startup-anchor">
                  {/* Official artwork is served as-is. next/image would re-encode it. */}
                  {/* eslint-disable @next/next/no-img-element */}
                  <img
                    src={beeSrc}
                    alt=""
                    draggable="false"
                    className={`startup-trail startup-trail-a${beeClass}`}
                    onError={failBee}
                  />
                  <img
                    src={beeSrc}
                    alt=""
                    draggable="false"
                    className={`startup-trail startup-trail-b${beeClass}`}
                    onError={failBee}
                  />
                  <img
                    src={beeSrc}
                    alt=""
                    draggable="false"
                    className={`startup-bee${beeClass}`}
                    onError={failBee}
                  />
                  {/* eslint-enable @next/next/no-img-element */}
                </div>
              )}
            </div>
            <p className="startup-wordmark">
              Beez<span className="startup-wordmark-gold">Movies</span>
            </p>
          </div>
        </div>
      ) : null}
      {children}
    </div>
  );
}

'use client';

import { useEffect, useId, useRef, useState } from 'react';

export function releaseTrailer(video) {
  if (!video) return;
  if (typeof document !== 'undefined' && document.pictureInPictureElement === video) {
    document.exitPictureInPicture().catch(() => {});
  }
  video.pause();
  video.removeAttribute('src');
  video.load();
}

export function TrailerPlayer({ src, poster, title }) {
  const videoRef = useRef(null);
  const seekId = useId();
  const volumeId = useId();
  const [playback, setPlayback] = useState('loading');
  const [paused, setPaused] = useState(true);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduceMotion(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => () => releaseTrailer(videoRef.current), []);

  function video() {
    return videoRef.current;
  }

  function togglePlay() {
    const element = video();
    if (!element) return;
    if (element.paused) {
      element.play().catch(() => setPlayback('error'));
    } else {
      element.pause();
    }
  }

  function toggleMute() {
    const element = video();
    if (!element) return;
    element.muted = !element.muted;
    setMuted(element.muted);
  }

  function toggleFullscreen() {
    const element = video();
    if (!element) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    element.requestFullscreen?.().catch(() => setPlayback('error'));
  }

  if (playback === 'error') {
    return (
      <p className="media-state media-state-muted" role="alert">
        This trailer could not be played.
      </p>
    );
  }

  return (
    <div className="trailer-player">
      <div className="relative aspect-video w-full bg-obsidian">
        <video
          ref={videoRef}
          className="h-full w-full bg-obsidian object-contain"
          controls
          controlsList="nodownload noplaybackrate"
          playsInline
          preload="none"
          poster={poster || undefined}
          autoPlay={!reduceMotion}
          aria-label={title ? `${title} trailer` : 'Trailer'}
          onLoadStart={() => setPlayback('loading')}
          onLoadedData={() => setPlayback('ready')}
          onPlaying={() => {
            setPlayback('ready');
            setPaused(false);
          }}
          onPause={() => setPaused(true)}
          onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime || 0)}
          onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
          onVolumeChange={(event) => {
            setVolume(event.currentTarget.volume);
            setMuted(event.currentTarget.muted);
          }}
          onError={() => setPlayback('error')}
          src={src}
        >
          This trailer could not be played.
        </video>
        {playback === 'loading' ? (
          <p className="pointer-events-none absolute inset-x-0 top-3 text-center text-sm text-ink" role="status">
            Loading trailer…
          </p>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <button type="button" className="min-h-11 min-w-11 px-4 text-sm font-semibold text-ink" onClick={togglePlay}>
          {paused ? 'Play' : 'Pause'}
        </button>
        <label className="block min-w-40 flex-1 text-xs text-muted">
          Seek
          <input
            id={seekId}
            className="mt-1 block min-h-11 w-full"
            type="range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={Math.min(current, duration || 0)}
            onChange={(event) => {
              const element = video();
              if (!element) return;
              element.currentTime = Number(event.target.value);
            }}
          />
        </label>
        <button
          type="button"
          className="min-h-11 min-w-11 px-4 text-sm font-semibold text-ink"
          aria-pressed={muted}
          onClick={toggleMute}
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <label className="block text-xs text-muted">
          Volume
          <input
            id={volumeId}
            className="mt-1 block min-h-11 w-full sm:w-28"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(event) => {
              const element = video();
              if (!element) return;
              element.volume = Number(event.target.value);
            }}
          />
        </label>
        <button type="button" className="min-h-11 min-w-11 px-4 text-sm font-semibold text-ink" onClick={toggleFullscreen}>
          Fullscreen
        </button>
      </div>
    </div>
  );
}

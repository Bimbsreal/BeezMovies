'use client';

import { useState } from 'react';

export function Artwork({ src, alt = '', priority = false, className = '' }) {
  const [failed, setFailed] = useState(!src);

  if (failed) {
    return (
      <div className={`h-full w-full bg-elevated ${className}`} role="img" aria-label="Artwork unavailable" />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      width={priority ? 1280 : 300}
      height={priority ? 720 : 450}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
      className={`h-full w-full object-cover ${className}`}
      onError={() => setFailed(true)}
    />
  );
}

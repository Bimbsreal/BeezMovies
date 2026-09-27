export const MEDIA_QUALITIES = ['480p', '720p', '1080p', '2160p'];
export const RESOLUTION_TIMEOUT_MS = 1500;
export const HANDOFF_TTL_SECONDS = 60;
export const MAX_PROVIDER_ATTEMPTS = 2;
export const HEALTH_TTL_MS = 30_000;

export const ADAPTER_METHODS = [
  'resolveMedia',
  'checkAvailability',
  'getFileStatus',
  'getMetadata',
  'getDownloadReference',
  'getDownloadUrl',
  'getStreamUrl',
  'validateReference',
  'healthCheck',
];

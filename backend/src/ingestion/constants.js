export const TRANSFORMATION_VERSION = 'catalog-normalize-v1';
export const DEFAULT_MAX_ATTEMPTS = 5;
export const DISCOVER_BATCH_LIMIT = 25;
export const SCHEDULE_MIN_SECONDS = 3600;
export const FAILURES_DEGRADED = 3;
export const FAILURES_DISABLED = 5;
export const DISABLE_MINUTES = 15;
export const PROTECTED_PRIORITY = 1000;
export const JOB_TYPES = [
  'metadata:discover',
  'metadata:fetch',
  'metadata:normalize',
  'metadata:resolve',
  'metadata:upsert',
  'metadata:index',
];

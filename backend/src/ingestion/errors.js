const TRANSIENT_PG = new Set([
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '57P01',
  '57P02',
  '57P03',
  '40001',
  '40P01',
  '53300',
  '55P03',
]);

export class IngestionError extends Error {
  constructor(code, message, { transient = false, retryAfterMs = null } = {}) {
    super(message);
    this.name = 'IngestionError';
    this.code = code;
    this.transient = transient;
    this.retryAfterMs = retryAfterMs;
  }
}

export function publicFailure(error) {
  if (error instanceof IngestionError) {
    return {
      code: error.code,
      message: error.message.slice(0, 500),
      transient: error.transient,
      retryAfterMs: error.retryAfterMs,
    };
  }

  if (error && TRANSIENT_PG.has(error.code)) {
    return {
      code: 'DATABASE_UNAVAILABLE',
      message: 'The catalog is temporarily unavailable',
      transient: true,
      retryAfterMs: null,
    };
  }

  if (error && (error.code === '23514' || error.code === '23505' || error.code === '23503')) {
    return {
      code: 'MALFORMED_METADATA',
      message: 'Metadata did not satisfy the catalog rules',
      transient: false,
      retryAfterMs: null,
    };
  }

  if (error && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) {
    return {
      code: 'DATABASE_UNAVAILABLE',
      message: 'The catalog write failed',
      transient: false,
      retryAfterMs: null,
    };
  }

  return {
    code: 'INGESTION_FAILED',
    message: 'Ingestion failed',
    transient: true,
    retryAfterMs: null,
  };
}

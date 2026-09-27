import { getPool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { invalidateCatalogCache } from '../catalog/admin.js';
import { DISCOVER_BATCH_LIMIT } from './constants.js';
import { IngestionError, publicFailure } from './errors.js';
import { fingerprintValue, normalizeMovie } from './normalize.js';
import { getAdapter, loadSource } from './registry.js';
import { resolveMovie } from './resolve.js';
import { importMovie } from './upsert.js';
import { claimJobById, claimNextJob, completeJob, enqueueJob, failJob } from './jobs.js';
import { releaseSource } from './rate-limit.js';
import { recordSourceFailure, recordSourceSuccess } from './health.js';
import { logIngestion } from './log.js';

async function discover(source, discovery = 'NEW_RELEASE_DISCOVERY') {
  const adapter = getAdapter(source.slug);
  if (!adapter) {
    throw new IngestionError('INVALID_SOURCE_ID', 'No adapter is registered for this source', {
      transient: false,
    });
  }
  const titles = await adapter.searchTitles();
  let created = 0;
  for (const title of titles.slice(0, DISCOVER_BATCH_LIMIT)) {
    const queued = await enqueueJob({
      source,
      externalId: title.externalId,
      operation: 'upsert',
      jobType: 'metadata:upsert',
      payload: { origin: 'discover', discovery },
    });
    if (queued.created) created += 1;
  }
  return {
    action: 'discovered',
    considered: Math.min(titles.length, DISCOVER_BATCH_LIMIT),
    created,
  };
}

async function indexExisting(job) {
  const movieId = job.payload?.movieId;
  if (!movieId) {
    throw new IngestionError('MALFORMED_METADATA', 'Index job is missing a movie id', { transient: false });
  }
  const movie = await getPool().query('SELECT id, slug FROM movies WHERE id = $1', [movieId]);
  if (!movie.rowCount) {
    throw new IngestionError('INVALID_SOURCE_ID', 'Movie for the index event was not found', { transient: false });
  }
  await getPool().query(
    `INSERT INTO search_index_events (event_name, movie_id, slug)
     VALUES ('movie.catalog.updated', $1, $2)`,
    [movie.rows[0].id, movie.rows[0].slug],
  );
  return { action: 'indexed', movieId: movie.rows[0].id, slug: movie.rows[0].slug };
}

export async function processClaimedJob(job, { raw } = {}) {
  const started = Date.now();
  let source;
  try {
    const slugRow = await getPool().query(
      'SELECT slug FROM catalog_sources WHERE id = $1',
      [job.catalog_source_id],
    );
    source = await loadSource(slugRow.rows[0].slug);
    logIngestion('INGESTION_STARTED', {
      jobId: job.id,
      correlationId: job.correlation_id,
      source: source.slug,
      externalId: job.external_id,
      jobType: job.job_type,
    });

    if (job.job_type === 'metadata:discover' || job.operation === 'discover') {
      const result = await discover(source, job.payload?.discovery || 'NEW_RELEASE_DISCOVERY');
      await completeJob(job, { result, fingerprint: null });
      await recordSourceSuccess(source.id, Date.now() - started);
      logIngestion('INGESTION_FETCHED', { jobId: job.id, source: source.slug, created: result.created });
      return result;
    }

    if (job.job_type === 'metadata:index') {
      const result = await indexExisting(job);
      await completeJob(job, { result, fingerprint: null });
      logIngestion('INGESTION_UPDATED', { jobId: job.id, slug: result.slug });
      return result;
    }

    const adapter = getAdapter(source.slug);
    if (!adapter) {
      throw new IngestionError('INVALID_SOURCE_ID', 'No adapter is registered for this source', {
        transient: false,
      });
    }

    const record = raw ?? await adapter.getMovie(job.external_id);
    logIngestion('INGESTION_FETCHED', {
      jobId: job.id,
      source: source.slug,
      externalId: job.external_id,
    });
    const normalized = normalizeMovie(record, source.allowedHosts);
    logIngestion('INGESTION_NORMALIZED', { jobId: job.id, externalId: normalized.externalId });
    const fingerprint = fingerprintValue(normalized);

    const outcome = await withTransaction(async (client) => {
      let match = await resolveMovie(client, source, normalized);
      if (match.confidence === 'high') {
        const status = await client.query('SELECT status FROM movies WHERE id = $1', [match.movieId]);
        if (!status.rowCount || status.rows[0].status === 'archived') {
          match = {
            confidence: 'medium',
            reason: 'archived-candidate',
            movieId: null,
            candidates: status.rowCount ? [{ movieId: match.movieId, signals: { archived: true } }] : [],
          };
        }
      }
      logIngestion('INGESTION_MATCHED', {
        jobId: job.id,
        confidence: match.confidence,
        reason: match.reason,
      });
      return importMovie(client, {
        job,
        source,
        raw: record,
        normalized,
        match,
        fingerprint,
      });
    });

    if (outcome.action === 'created' || outcome.action === 'updated') {
      await invalidateCatalogCache({ slug: outcome.slug });
      logIngestion(outcome.action === 'created' ? 'INGESTION_CREATED' : 'INGESTION_UPDATED', {
        jobId: job.id,
        slug: outcome.slug,
      });
    } else {
      logIngestion('INGESTION_SKIPPED', { jobId: job.id, reason: outcome.reason });
    }

    await recordSourceSuccess(source.id, Date.now() - started);
    await completeJob(job, { result: outcome, fingerprint });
    return outcome;
  } catch (error) {
    const failure = publicFailure(error);
    if (source) {
      await recordSourceFailure(source.id, failure.code, { transient: failure.transient });
    }
    const recorded = await failJob(job, error);
    logIngestion(recorded.status === 'dead_letter' ? 'INGESTION_DEAD_LETTER' : 'INGESTION_FAILED', {
      jobId: job.id,
      code: recorded.code,
    });
    if (recorded.status === 'failed') {
      logIngestion('INGESTION_RETRY', { jobId: job.id, code: recorded.code });
    }
    return { action: recorded.status, code: recorded.code };
  }
}

async function finishClaim(claimed, options) {
  if (!claimed || claimed.deferred) return claimed;
  try {
    const outcome = await processClaimedJob(claimed.job, options);
    return { ...claimed, outcome };
  } finally {
    await releaseSource(claimed.job.catalog_source_id);
  }
}

export async function runJobById(jobId, options = {}) {
  return finishClaim(await claimJobById(jobId), options);
}

export async function runAvailableJobs({ limit = 5 } = {}) {
  const results = [];
  for (let index = 0; index < limit; index += 1) {
    const claimed = await claimNextJob();
    if (!claimed) break;
    if (claimed.deferred) continue;
    results.push(await finishClaim(claimed));
  }
  return results;
}

export async function enqueueIngestion({ source, externalId = null, operation, jobType, payload }) {
  return enqueueJob({ source, externalId, operation, jobType, payload });
}

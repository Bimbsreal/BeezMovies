import { config } from '../config/index.js';
import { logger } from '../logger/index.js';
import { markMediaChecked } from '../catalog/repositories/media.js';
import { findMovieBySlug } from '../catalog/repositories/movies.js';
import { AppError } from '../errors/app-error.js';
import { HEALTH_TTL_MS, MAX_PROVIDER_ATTEMPTS, RESOLUTION_TIMEOUT_MS } from './constants.js';
import { mediaError } from './errors.js';
import { mintHandoff, readHandoff } from './handoff.js';
import {
  findResolutionReference,
  listResolutionCandidates,
  recordDownloadEvent,
  recordProviderHealth,
} from './repository.js';
import { getMediaAdapter } from './registry.js';
import { rankCandidates } from './selection.js';
import { assertLocalResolution } from './validate.js';
import { recordAnalytics } from '../analytics/record.js';

const FAILOVER = new Set([
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'DOWNLOAD_NOT_SUPPORTED',
  'MEDIA_NOT_FOUND',
  'MEDIA_EXPIRED',
]);

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(mediaError('PROVIDER_TIMEOUT')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function asMediaError(error) {
  if (error instanceof AppError && error.code) return error;
  return mediaError('PROVIDER_UNAVAILABLE');
}

function recentlyUnavailable(candidate) {
  if (candidate.health !== 'unavailable' || candidate.lastErrorCode !== 'PROVIDER_UNAVAILABLE') return false;
  if (!candidate.lastCheckedAt) return false;
  const checked = Date.parse(candidate.lastCheckedAt);
  return Number.isFinite(checked) && Date.now() - checked < HEALTH_TTL_MS;
}

function safeFilename(name, slug) {
  const fallback = `${String(slug || 'title').replace(/[^a-z0-9-]/g, '') || 'title'}-development.txt`;
  if (typeof name !== 'string') return fallback;
  const cleaned = name.replace(/[^a-z0-9.-]/g, '');
  return cleaned || fallback;
}

export async function resolveMovieDownload(slug, options = {}) {
  const started = Date.now();
  logger.info({ event: 'DOWNLOAD_REQUESTED', slug }, 'DOWNLOAD_REQUESTED');
  const movie = await findMovieBySlug(slug);
  if (!movie || movie.status !== 'active') {
    throw new AppError('Movie not found', { status: 404, code: 'NOT_FOUND' });
  }
  if (movie.content_type_code === 'series' && !options.episodeId) {
    throw new AppError('A series is not downloaded as one movie file', {
      status: 409,
      code: 'DOWNLOAD_NOT_SUPPORTED',
    });
  }
  recordAnalytics({ name: 'DOWNLOAD_REQUEST', subject: slug, outcome: 'request' });

  const enabled = options.enabledSlugs || config.mediaProviders;
  const ranked = rankCandidates(await listResolutionCandidates(movie.id, { episodeId: options.episodeId || null }), {
    enabled,
    preferredQuality: options.quality,
  });
  if (ranked.length === 0) {
    recordAnalytics({
      name: 'DOWNLOAD_FAILED',
      subject: slug,
      outcome: 'failed',
      failureCategory: 'MEDIA_UNAVAILABLE',
    });
    throw mediaError('MEDIA_UNAVAILABLE');
  }

  let lastError = mediaError('MEDIA_UNAVAILABLE');
  const attempts = ranked.slice(0, options.maxAttempts || MAX_PROVIDER_ATTEMPTS);
  for (const candidate of attempts) {
    if (recentlyUnavailable(candidate)) {
      lastError = mediaError('PROVIDER_UNAVAILABLE');
      continue;
    }
    logger.info({
      event: 'MEDIA_RESOLUTION_STARTED',
      slug,
      provider: candidate.providerSlug,
    }, 'MEDIA_RESOLUTION_STARTED');
    const attemptStarted = Date.now();
    try {
      const adapter = getMediaAdapter(candidate.providerSlug);
      if (!adapter) throw mediaError('PROVIDER_UNAVAILABLE');
      await adapter.validateReference(candidate);
      const resolved = assertLocalResolution(await withTimeout(
        adapter.resolveMedia(candidate),
        options.timeoutMs || RESOLUTION_TIMEOUT_MS,
      ));
      if (resolved.resourceType !== 'download') throw mediaError('DOWNLOAD_NOT_SUPPORTED');
      const filename = safeFilename(resolved.filename, movie.slug);
      const href = `/api/v1/media/handoff/${mintHandoff({
        referenceId: candidate.id,
        kind: 'download',
      })}`;
      await markMediaChecked(candidate.id);
      await recordProviderHealth(candidate.providerId, 'available');
      await recordDownloadEvent({
        movieId: movie.id,
        mediaReferenceId: candidate.id,
        providerId: candidate.providerId,
        result: 'success',
        durationMs: Date.now() - attemptStarted,
      });
      recordAnalytics({
        name: 'DOWNLOAD_RESOLVED',
        subject: slug,
        outcome: 'success',
        providerSlug: candidate.providerSlug,
        durationMs: Date.now() - started,
      });
      logger.info({
        event: 'MEDIA_RESOLUTION_SUCCESS',
        slug,
        provider: candidate.providerSlug,
        durationMs: Date.now() - started,
      }, 'MEDIA_RESOLUTION_SUCCESS');
      return {
        state: 'ready',
        resourceType: 'download',
        filename,
        href,
      };
    } catch (error) {
      lastError = asMediaError(error);
      logger.warn({
        event: lastError.code === 'PROVIDER_TIMEOUT' || lastError.code === 'PROVIDER_UNAVAILABLE'
          ? 'PROVIDER_FAILURE'
          : 'MEDIA_RESOLUTION_FAILED',
        slug,
        provider: candidate.providerSlug,
        code: lastError.code,
        durationMs: Date.now() - started,
      }, 'MEDIA_RESOLUTION_FAILED');
      if (lastError.code === 'PROVIDER_TIMEOUT' || lastError.code === 'PROVIDER_UNAVAILABLE') {
        await recordProviderHealth(
          candidate.providerId,
          lastError.code === 'PROVIDER_TIMEOUT' ? 'degraded' : 'unavailable',
          lastError.code,
        );
      }
      await recordDownloadEvent({
        movieId: movie.id,
        mediaReferenceId: candidate.id,
        providerId: candidate.providerId,
        result: 'failed',
        failureCategory: lastError.code,
        durationMs: Date.now() - attemptStarted,
      });
      recordAnalytics({
        name: 'DOWNLOAD_FAILED',
        subject: slug,
        outcome: 'failed',
        providerSlug: candidate.providerSlug,
        failureCategory: lastError.code,
        durationMs: Date.now() - started,
      });
      if (!FAILOVER.has(lastError.code)) throw lastError;
    }
  }
  throw lastError;
}

export async function openDownloadHandoff(token) {
  const payload = readHandoff(token);
  const reference = await findResolutionReference(payload.ref);
  if (!reference || reference.status !== 'available' || reference.availability !== 'available') {
    throw mediaError('MEDIA_UNAVAILABLE');
  }
  if (reference.providerStatus !== 'active') throw mediaError('PROVIDER_UNAVAILABLE');
  const adapter = getMediaAdapter(reference.providerSlug);
  if (!adapter || typeof adapter.readLocalBody !== 'function') {
    throw mediaError('DOWNLOAD_NOT_SUPPORTED');
  }
  await adapter.validateReference(reference);
  const resolved = assertLocalResolution(await withTimeout(
    adapter.resolveMedia(reference),
    RESOLUTION_TIMEOUT_MS,
  ));
  if (resolved.resourceType !== 'download') throw mediaError('DOWNLOAD_NOT_SUPPORTED');
  logger.info({
    event: 'DOWNLOAD_COMPLETED',
    slug: reference.movieSlug,
    provider: reference.providerSlug,
  }, 'DOWNLOAD_COMPLETED');
  return {
    filename: safeFilename(resolved.filename, reference.movieSlug),
    contentType: 'text/plain; charset=utf-8',
    body: adapter.readLocalBody(reference),
  };
}

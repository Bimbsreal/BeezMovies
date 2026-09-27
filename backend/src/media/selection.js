import { MEDIA_QUALITIES } from './constants.js';

const HEALTH_RANK = {
  available: 0,
  unknown: 1,
  degraded: 2,
  unavailable: 3,
};

const QUALITY_RANK = {
  '2160p': 4,
  '1080p': 3,
  '720p': 2,
  '480p': 1,
};

export function rankCandidates(candidates, { enabled, preferredQuality } = {}) {
  const allowed = new Set(enabled || []);
  return candidates
    .filter((candidate) => candidate.mediaType === 'download')
    .filter((candidate) => candidate.providerStatus === 'active')
    .filter((candidate) => allowed.has(candidate.providerSlug))
    .filter((candidate) => !candidate.quality || MEDIA_QUALITIES.includes(candidate.quality))
    .slice()
    .sort((left, right) => {
      const qualityBoost = (candidate) => (
        preferredQuality && candidate.quality === preferredQuality ? 1 : 0
      );
      const qualityPreference = qualityBoost(right) - qualityBoost(left);
      if (qualityPreference) return qualityPreference;
      const health = (HEALTH_RANK[left.health] ?? 1) - (HEALTH_RANK[right.health] ?? 1);
      if (health) return health;
      const quality = (QUALITY_RANK[right.quality] || 0) - (QUALITY_RANK[left.quality] || 0);
      if (quality) return quality;
      const priority = (right.priority || 0) - (left.priority || 0);
      if (priority) return priority;
      const leftSuccess = left.lastSuccessAt ? Date.parse(left.lastSuccessAt) : 0;
      const rightSuccess = right.lastSuccessAt ? Date.parse(right.lastSuccessAt) : 0;
      if (rightSuccess !== leftSuccess) return rightSuccess - leftSuccess;
      return left.providerSlug.localeCompare(right.providerSlug);
    });
}

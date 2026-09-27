export function qualityIssues(normalized) {
  const issues = [];
  if (!normalized?.displayTitle) issues.push('title');
  if (!normalized?.releaseDate && !normalized?.releaseYear) issues.push('release');
  if (!normalized?.synopsis) issues.push('synopsis');
  if (!normalized?.genres?.length) issues.push('genre');
  if (!(normalized?.images || []).some((image) => image.type === 'poster' && image.url)) issues.push('poster');
  if (!normalized?.externalId) issues.push('identifier');
  if (!normalized?.countries?.length) issues.push('country');
  if (!normalized?.contentType) issues.push('content_type');
  return issues;
}

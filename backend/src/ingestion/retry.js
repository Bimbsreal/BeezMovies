export function backoffSeconds(attempt) {
  const milliseconds = 200 * (2 ** Math.max(0, attempt - 1));
  return Math.min(60, Math.ceil(milliseconds / 1000));
}

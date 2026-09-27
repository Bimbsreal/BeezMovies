const SECRET_PATTERN =
  /((?:postgres|postgresql|redis|rediss):\/\/\S+)|((?:password|secret|token)\s*[:=]\s*\S+)/gi;

export function sanitize(value) {
  return String(value ?? '').replace(SECRET_PATTERN, '[redacted]');
}

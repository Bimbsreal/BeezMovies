import { performance } from 'node:perf_hooks';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run a synthetic load check with NODE_ENV=production');
  process.exit(1);
}

const base = process.env.LOAD_BASE_URL || 'http://127.0.0.1:5000';
const rounds = 20;

const targets = [
  ['GET', '/api/v1/discovery/home'],
  ['GET', '/api/v1/movies/nosferatu'],
  ['GET', '/api/v1/search?q=nosferatu'],
  ['GET', '/api/v1/genres'],
  ['GET', '/api/v1/collections'],
  ['POST', '/api/v1/movies/nosferatu/download'],
];

function percentile(samples, ratio) {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

async function once(method, path) {
  const started = performance.now();
  const response = await fetch(`${base}${path}`, {
    method,
    headers: method === 'POST' ? { 'content-type': 'application/json', 'x-beezmovies-request': '1' } : {},
    body: method === 'POST' ? '{}' : undefined,
  });
  await response.arrayBuffer();
  return { status: response.status, ms: performance.now() - started };
}

const report = [];
for (const [method, path] of targets) {
  const samples = [];
  let errors = 0;
  for (let index = 0; index < rounds; index += 1) {
    try {
      const result = await once(method, path);
      samples.push(result.ms);
      if (result.status >= 400) errors += 1;
    } catch {
      errors += 1;
    }
  }
  report.push({
    path,
    requests: rounds,
    errors,
    p50: Math.round(percentile(samples, 0.5)),
    p95: Math.round(percentile(samples, 0.95)),
    p99: Math.round(percentile(samples, 0.99)),
  });
}

const memory = process.memoryUsage();
console.log(JSON.stringify({
  base,
  note: 'Local synthetic check. Not a production capacity result.',
  scriptRssMb: Math.round(memory.rss / 1e6),
  report,
}, null, 2));

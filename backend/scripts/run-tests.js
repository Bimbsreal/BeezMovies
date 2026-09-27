import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(path.join(backendRoot, 'tests'))
  .filter((file) => file.endsWith('.test.js'))
  .map((file) => path.join('tests', file));

const child = spawn(process.execPath, ['--test', '--test-force-exit', ...files], {
  cwd: backendRoot,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test' },
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

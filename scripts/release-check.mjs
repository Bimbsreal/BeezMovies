import { readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (entry.endsWith('.js')) files.push(full);
  }
  return files;
}

for (const file of [
  ...walk(path.join(root, 'backend', 'src')),
  ...walk(path.join(root, 'workers', 'src')),
]) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) failures.push(`${path.relative(root, file)} failed syntax check`);
}

const migrations = readdirSync(path.join(root, 'database', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort();
if (migrations.length === 0 || migrations[0] !== '001_foundation.sql') {
  failures.push('Migration sequence is missing 001_foundation.sql');
}
const expected = migrations.map((file, index) => `${String(index + 1).padStart(3, '0')}_`);
migrations.forEach((file, index) => {
  if (!file.startsWith(expected[index].slice(0, 4))) {
    failures.push(`Migration ${file} is out of numeric order`);
  }
});

const examples = [
  'backend/.env.example',
  'backend/.env.staging.example',
  'backend/.env.production.example',
  'frontend/.env.example',
  'frontend/.env.staging.example',
  'frontend/.env.production.example',
];
for (const relative of examples) {
  const text = readFileSync(path.join(root, relative), 'utf8');
  if (/AKIA[0-9A-Z]{16}|sk_live_|BEGIN PRIVATE KEY/.test(text)) {
    failures.push(`${relative} contains a credential pattern`);
  }
}

const productionBackend = readFileSync(path.join(root, 'backend', '.env.production.example'), 'utf8');
const activeProduction = productionBackend
  .split('\n')
  .filter((line) => line.trim() && !line.trim().startsWith('#'))
  .join('\n');
if (/beezmovies_local|beezmovies-local-handoff|CHANGE_ME=/.test(activeProduction)) {
  failures.push('backend/.env.production.example has a development fixture or an empty secret assignment');
}
if (!activeProduction.includes('NODE_ENV=production')) {
  failures.push('backend/.env.production.example must set NODE_ENV=production');
}

const productionFrontend = readFileSync(path.join(root, 'frontend', '.env.production.example'), 'utf8');
if (/SECRET|PASSWORD|DATABASE_URL|HANDOFF/.test(productionFrontend)) {
  failures.push('frontend/.env.production.example must not name a secret');
}

const packages = ['package.json', 'backend/package.json', 'frontend/package.json'].map((file) => {
  return JSON.parse(readFileSync(path.join(root, file), 'utf8')).version;
});
if (new Set(packages).size !== 1) failures.push('Package versions differ');

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log(JSON.stringify({
  version: packages[0],
  migrations: migrations.length,
  latestMigration: migrations.at(-1),
  syntaxChecked: true,
}));

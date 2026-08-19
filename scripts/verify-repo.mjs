import { readFileSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const target = path.join(dir, name);
    if (target.includes(`${path.sep}.git${path.sep}`) || target.includes(`${path.sep}node_modules${path.sep}`) || target.includes(`${path.sep}dist${path.sep}`) || target.includes(`${path.sep}.turbo${path.sep}`)) {
      continue;
    }
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) {
      continue;
    }
    if (stat.isDirectory()) {
      entries.push(...walk(target));
    } else {
      entries.push(target);
    }
  }
  return entries;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const requiredFiles = [
  'README.md',
  'docs/README.md',
  'docs/01-workspace-overview.md',
  'docs/02-architecture-and-boundaries.md',
  'docs/03-build-deploy-and-compose.md',
  'docs/04-runtime-contract.md',
  'docs/05-migration-and-data-contract.md',
  'docs/06-agent-guardrails.md',
  'docs/07-cutover-and-migration.md',
  'docs/08-verification-and-evidence.md',
  'packages/pdfit/README.md',
  'packages/pdfit/docs/overview.md',
  'packages/pdfit/docs/architecture.md',
  'packages/pdfit/docs/api.md',
  'packages/pdfit/docs/usage.md',
  'packages/pdfit/docs/constraints.md',
  'packages/pdfit/docs/internals.md',
  'packages/pdfit/docs/testing.md',
  'apps/pdfit/README.md',
  'apps/pdfit/docs/overview.md',
  'apps/pdfit/docs/architecture.md',
  'apps/pdfit/docs/api.md',
  'apps/pdfit/docs/usage.md',
  'apps/pdfit/docs/constraints.md',
  'apps/pdfit/docs/internals.md',
  'apps/pdfit/docs/testing.md',
];

for (const file of requiredFiles) {
  assert(existsSync(path.join(root, file)), `Missing required file: ${file}`);
}

const compose = spawnSync('docker', ['compose', 'config'], { cwd: root, encoding: 'utf-8' });
assert(compose.status === 0, 'docker compose config failed');
assert(compose.stdout.includes('pdfit:'), 'compose config missing integrated pdfit service');
assert(compose.stdout.includes('published: "15201"') && compose.stdout.includes('target: 15201'), 'compose config missing integrated port');
assert(!compose.stdout.includes('pdfit-free') && !compose.stdout.includes('pdfit-pro'), 'compose config still exposes split services');
assert(compose.stdout.includes('service:') && compose.stdout.includes('target: 15202'), 'compose config missing hosted service');

const parity = spawnSync(process.execPath, ['scripts/verify-service-parity.mjs'], { cwd: root, encoding: 'utf-8' });
assert(parity.status === 0, parity.stderr || parity.stdout || 'service parity check failed');

const legacyDistLiteral = 'apps/' + 'legacy/dist';

for (const file of walk(root)) {
  if (file.includes(`${path.sep}.git${path.sep}`) || file.includes(`${path.sep}node_modules${path.sep}`) || file.includes(`${path.sep}dist${path.sep}`)) {
    continue;
  }
  const text = readFileSync(file, 'utf-8');
  assert(!text.includes(legacyDistLiteral), `Forbidden legacy dist reference in ${path.relative(root, file)}`);
}

console.log('verify:repo passed');

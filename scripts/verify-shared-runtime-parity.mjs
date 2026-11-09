import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , appDirArg] = process.argv;
if (!appDirArg) throw new Error('Usage: node scripts/verify-shared-runtime-parity.mjs <app-dir>');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'packages/pdfit/dist');
const runtimeDir = path.join(root, appDirArg, 'dist/node_modules/@pdfit/pdfit/dist');

/** Returns content hashes keyed by portable relative paths. */
function collectHashes(directory, current = directory, result = new Map()) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) collectHashes(directory, absolute, result);
    else if (entry.isFile()) {
      const relative = path.relative(directory, absolute).split(path.sep).join('/');
      result.set(relative, createHash('sha256').update(readFileSync(absolute)).digest('hex'));
    }
  }
  return result;
}

if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) throw new Error('Shared package dist is missing.');
if (!existsSync(runtimeDir) || !statSync(runtimeDir).isDirectory()) throw new Error(`Shared runtime is missing from ${appDirArg}.`);

const source = collectHashes(sourceDir);
const runtime = collectHashes(runtimeDir);
const mismatches = [];
for (const [file, hash] of source) {
  if (runtime.get(file) !== hash) mismatches.push(file);
}
for (const file of runtime.keys()) {
  if (!source.has(file)) mismatches.push(file);
}

if (mismatches.length > 0) {
  throw new Error(`Shared runtime parity failed for ${appDirArg}: ${[...new Set(mismatches)].sort().join(', ')}`);
}

console.log(`Shared runtime parity verified for ${appDirArg}: ${source.size} files.`);

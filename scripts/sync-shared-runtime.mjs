import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , appDirArg] = process.argv;
if (!appDirArg) {
  throw new Error('Usage: node scripts/sync-shared-runtime.mjs <app-dir>');
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, appDirArg);
const packageDir = path.join(root, 'packages/pdfit');
const sourceDist = path.join(packageDir, 'dist');
const sourcePackageJson = path.join(packageDir, 'package.json');
const runtimePackageDir = path.join(appDir, 'dist/node_modules/@pdfit/pdfit');

if (!existsSync(sourceDist)) {
  throw new Error('Shared package dist is missing. Build packages/pdfit first.');
}

mkdirSync(runtimePackageDir, { recursive: true });
cpSync(sourceDist, path.join(runtimePackageDir, 'dist'), { recursive: true, force: true });
cpSync(sourcePackageJson, path.join(runtimePackageDir, 'package.json'), { force: true });

console.log(`Synced shared runtime into ${path.relative(root, runtimePackageDir)}`);

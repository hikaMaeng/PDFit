import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(process.env.PDFGPU_SOURCE_DIR ?? join(repoRoot, '..', 'pdfgpu'));
const packageDir = join(sourceRoot, 'packages', 'pdfgpu');
const targetDir = join(repoRoot, 'packages', 'pdfit', 'vendor');
const manifestPath = join(targetDir, 'pdfgpu-build.json');
const expectedVersion = process.env.PDFGPU_VERSION ?? '0.1.9';
const sourceSpec = `file:vendor/pdfgpu-core-${expectedVersion}.tgz`;
const releaseTarball = `pdfgpu-core-${expectedVersion}.tgz`;
const refresh = process.env.PDFGPU_REFRESH !== '0';
const allowDirty = process.env.PDFGPU_ALLOW_DIRTY === '1';

function run(command, args, cwd) {
  let executable = command;
  let spawnArgs = args;
  if (process.platform === 'win32' && command === 'npm') {
    executable = process.env.ComSpec ?? 'cmd.exe';
    spawnArgs = ['/d', '/s', '/c', ['npm.cmd', ...args].join(' ')];
  }
  const result = spawnSync(executable, spawnArgs, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe'
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status ?? result.error?.message}`);
  }
  return result.stdout.trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function git(cwd, args) {
  return run('git', args, cwd);
}

function validateArtifact(manifest) {
  if (!existsSync(manifestPath)) {
    throw new Error('pdfgpu build manifest is missing; run npm run sync:pdfgpu');
  }
  if (manifest.packageVersion !== expectedVersion || manifest.sourceSpec !== sourceSpec) {
    throw new Error(`pdfgpu source mismatch: expected ${sourceSpec}@${expectedVersion}`);
  }
  return manifest;
}

if (!refresh) {
  const manifest = readJson(manifestPath);
  validateArtifact(manifest);
  console.log(`[pdfgpu] using pinned @pdfgpu/core ${manifest.packageVersion} at ${manifest.sourceCommit}`);
  process.exit(0);
}

if (!existsSync(packageDir)) {
  throw new Error(`pdfgpu source package not found: ${packageDir}`);
}

const packageJson = readJson(join(packageDir, 'package.json'));
if (packageJson.version !== expectedVersion) {
  throw new Error(`pdfgpu source version is ${packageJson.version}; expected ${expectedVersion}`);
}
const status = git(sourceRoot, ['status', '--short']);
if (status && !allowDirty) {
  throw new Error(`pdfgpu source is dirty; commit it before integration:\n${status}`);
}

run('npm', ['run', 'build', '--workspace=@pdfgpu/core'], sourceRoot);
const packDir = targetDir;
const packOutput = run('npm', ['pack', '--workspace=@pdfgpu/core', '--pack-destination', packDir], sourceRoot);
const expectedName = `${packageJson.name.replace('@', '').replace('/', '-')}-${packageJson.version}.tgz`;
const packedTarball = join(packDir, expectedName);
if (!existsSync(packedTarball)) {
  throw new Error(`pdfgpu pack did not produce ${packedTarball}\n${packOutput}`);
}

const nextHash = sha256(packedTarball);
const previousManifest = existsSync(manifestPath) ? readJson(manifestPath) : null;
const sourceCommit = git(sourceRoot, ['rev-parse', 'HEAD']);
const manifest = {
  packageName: packageJson.name,
  packageVersion: packageJson.version,
  sourceRepo: 'sibling:pdfgpu',
  sourceCommit,
  sourceDirty: Boolean(status),
  sourceSpec,
  tarball: releaseTarball,
  tarballSha256: nextHash
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

if (
  !previousManifest ||
  previousManifest.sourceCommit !== manifest.sourceCommit ||
  previousManifest.tarballSha256 !== manifest.tarballSha256 ||
  previousManifest.sourceSpec !== manifest.sourceSpec
) {
  run('npm', ['install', '--no-fund', '--no-audit'], repoRoot);
}

console.log(`[pdfgpu] pinned ${packageJson.name}@${packageJson.version} from ${sourceCommit}`);
console.log(`[pdfgpu] tarball sha256 ${nextHash}`);

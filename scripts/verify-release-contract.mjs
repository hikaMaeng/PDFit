import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');

function readJson(relativePath) {
  const path = join(repoRoot, relativePath);
  if (!existsSync(path)) throw new Error(`missing release contract input: ${relativePath}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function requireEqual(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

const rootPackage = readJson('package.json');
const contractPath = `release-contracts/pdfit/v${rootPackage.version}.json`;
const contract = readJson(contractPath);
const pdfitPackage = readJson('packages/pdfit/package.json');
const appPackage = readJson('apps/pdfit/package.json');
const dockerPackage = readJson('apps/pdfit/docker/package.json');
const pdfgpuManifest = readJson('packages/pdfit/vendor/pdfgpu-build.json');
const installedPdfgpu = readJson(existsSync(join(repoRoot, 'packages/pdfit/node_modules/@pdfgpu/core/package.json'))
  ? 'packages/pdfit/node_modules/@pdfgpu/core/package.json'
  : 'node_modules/@pdfgpu/core/package.json');
const expectedPdfitVersion = contract.pdfitVersion;
const expectedPdfgpu = contract.pdfgpu;

requireEqual('contract PDFit version', expectedPdfitVersion, rootPackage.version);

requireEqual('root PDFit version', rootPackage.version, expectedPdfitVersion);
requireEqual('@pdfit/pdfit version', pdfitPackage.version, expectedPdfitVersion);
requireEqual('apps/pdfit version', appPackage.version, expectedPdfitVersion);
requireEqual('apps/pdfit/docker version', dockerPackage.version, expectedPdfitVersion);
requireEqual('apps/pdfit workspace dependency', appPackage.dependencies['@pdfit/pdfit'], '*');
requireEqual('pdfgpu package name', pdfitPackage.dependencies['@pdfgpu/core'] && expectedPdfgpu.packageName, expectedPdfgpu.packageName);
requireEqual('pdfgpu dependency source', pdfitPackage.dependencies['@pdfgpu/core'], expectedPdfgpu.sourceSpec);
requireEqual('installed pdfgpu package name', installedPdfgpu.name, expectedPdfgpu.packageName);
requireEqual('installed pdfgpu package version', installedPdfgpu.version, expectedPdfgpu.packageVersion);

for (const [key, expected] of Object.entries(expectedPdfgpu)) {
  if (key === 'packageName' || key === 'packageVersion') {
    requireEqual(`pdfgpu manifest ${key}`, pdfgpuManifest[key], expected);
  } else {
    requireEqual(`pdfgpu manifest ${key}`, pdfgpuManifest[key], expected);
  }
}
if (pdfgpuManifest.sourceDirty !== false) {
  throw new Error('pdfgpu manifest sourceDirty must be false for a release contract');
}

console.log(`source contract passed: PDFit ${expectedPdfitVersion} -> ${expectedPdfgpu.packageName}@${expectedPdfgpu.packageVersion} (${expectedPdfgpu.sourceSpec})`);

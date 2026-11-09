import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const [sourceImageArgument, distArgument, outputImageArgument] = process.argv.slice(2);
if (!sourceImageArgument || !distArgument || !outputImageArgument) {
  throw new Error('Usage: node scripts/repack-service-image.mjs <source-image.tar> <dist> <output-image.tar>');
}

const sourceImage = resolve(sourceImageArgument);
const sourceDist = resolve(distArgument);
const outputImage = resolve(outputImageArgument);
if (!existsSync(sourceImage) || !statSync(sourceImage).isFile()) throw new Error(`Source image not found: ${sourceImage}`);
if (!existsSync(sourceDist) || !statSync(sourceDist).isDirectory()) throw new Error(`Dist directory not found: ${sourceDist}`);
if (sourceImage === outputImage) throw new Error('The source and output image paths must differ.');

const workRoot = mkdtempSync(join(tmpdir(), 'pdfit-oci-repack-'));
const ociRoot = join(workRoot, 'oci');
const layerRoot = join(workRoot, 'layer');
const layerTar = join(workRoot, 'dist-layer.tar');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function blobPath(digest) {
  return join(ociRoot, 'blobs', 'sha256', digest.replace(/^sha256:/, ''));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJsonBlob(value) {
  const bytes = Buffer.from(JSON.stringify(value));
  const digest = sha256(bytes);
  writeFileSync(blobPath(digest), bytes);
  return { digest: `sha256:${digest}`, size: bytes.length };
}

try {
  mkdirSync(ociRoot, { recursive: true });
  execFileSync('tar', ['-xf', sourceImage, '-C', ociRoot], { stdio: 'inherit' });

  const outerIndexPath = join(ociRoot, 'index.json');
  const legacyManifestPath = join(ociRoot, 'manifest.json');
  const outerIndex = readJson(outerIndexPath);
  const outerDescriptor = outerIndex.manifests?.[0];
  if (!outerDescriptor) throw new Error('OCI outer index has no manifest descriptor.');

  const nestedIndex = readJson(blobPath(outerDescriptor.digest));
  const platformDescriptor = nestedIndex.manifests?.find(
    (entry) => entry.platform?.os === 'linux' && entry.platform?.architecture === 'amd64',
  );
  if (!platformDescriptor) throw new Error('OCI image has no linux/amd64 manifest.');

  const imageManifest = readJson(blobPath(platformDescriptor.digest));
  const imageConfig = readJson(blobPath(imageManifest.config.digest));

  const distTarget = join(layerRoot, 'app', 'dist');
  mkdirSync(distTarget, { recursive: true });
  writeFileSync(join(distTarget, '.wh..wh..opq'), '');
  cpSync(sourceDist, distTarget, { recursive: true, force: true });
  execFileSync('tar', ['-cf', layerTar, '-C', layerRoot, 'app'], { stdio: 'inherit' });

  const layerBytes = readFileSync(layerTar);
  const compressedLayer = gzipSync(layerBytes, { level: 9, mtime: 0 });
  const layerDigest = sha256(compressedLayer);
  writeFileSync(blobPath(layerDigest), compressedLayer);

  const created = new Date().toISOString();
  imageConfig.created = created;
  imageConfig.rootfs.diff_ids.push(`sha256:${sha256(layerBytes)}`);
  imageConfig.history.push({
    created,
    created_by: 'COPY dist/ /app/dist/ # PDFit document export release layer',
    comment: 'pdfit offline release repack',
  });
  const configDescriptor = writeJsonBlob(imageConfig);

  imageManifest.config.digest = configDescriptor.digest;
  imageManifest.config.size = configDescriptor.size;
  imageManifest.layers.push({
    mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
    digest: `sha256:${layerDigest}`,
    size: compressedLayer.length,
  });
  const manifestDescriptor = writeJsonBlob(imageManifest);

  platformDescriptor.digest = manifestDescriptor.digest;
  platformDescriptor.size = manifestDescriptor.size;
  nestedIndex.manifests = [platformDescriptor];
  const nestedDescriptor = writeJsonBlob(nestedIndex);
  outerDescriptor.digest = nestedDescriptor.digest;
  outerDescriptor.size = nestedDescriptor.size;
  writeFileSync(outerIndexPath, JSON.stringify(outerIndex));

  const legacyManifest = readJson(legacyManifestPath);
  if (!legacyManifest?.[0]) throw new Error('Legacy Docker manifest is missing.');
  legacyManifest[0].Config = `blobs/sha256/${configDescriptor.digest.replace(/^sha256:/, '')}`;
  legacyManifest[0].Layers.push(`blobs/sha256/${layerDigest}`);
  writeFileSync(legacyManifestPath, JSON.stringify(legacyManifest));

  mkdirSync(dirname(outputImage), { recursive: true });
  execFileSync(
    'tar',
    ['-cf', outputImage, '-C', ociRoot, 'blobs', 'index.json', 'manifest.json', 'oci-layout'],
    { stdio: 'inherit' },
  );

  console.log(JSON.stringify({
    outputImage,
    bytes: statSync(outputImage).size,
    layerDigest: `sha256:${layerDigest}`,
    configDigest: configDescriptor.digest,
    manifestDigest: manifestDescriptor.digest,
  }, null, 2));
} finally {
  const resolvedWorkRoot = resolve(workRoot).toLowerCase();
  const resolvedTempRoot = resolve(tmpdir()).toLowerCase();
  if (resolvedWorkRoot.startsWith(resolvedTempRoot) && resolvedWorkRoot.includes('pdfit-oci-repack-')) {
    rmSync(workRoot, { recursive: true, force: true });
  }
}

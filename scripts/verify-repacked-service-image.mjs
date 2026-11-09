import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const imageArgument = process.argv[2];
if (!imageArgument) throw new Error('Usage: node scripts/verify-repacked-service-image.mjs <image.tar>');
const imagePath = resolve(imageArgument);
if (!existsSync(imagePath)) throw new Error(`Image not found: ${imagePath}`);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const readArchive = (path) => execFileSync('tar', ['-xOf', imagePath, path], { maxBuffer: 64 * 1024 * 1024 });
const readJson = (path) => JSON.parse(readArchive(path).toString('utf8'));
const digestPath = (digest) => `blobs/sha256/${digest.replace(/^sha256:/, '')}`;

const outerIndex = readJson('index.json');
const outerDescriptor = outerIndex.manifests?.[0];
if (!outerDescriptor) throw new Error('Missing outer OCI descriptor.');
const nestedIndexBytes = readArchive(digestPath(outerDescriptor.digest));
if (`sha256:${sha256(nestedIndexBytes)}` !== outerDescriptor.digest) throw new Error('Nested index digest mismatch.');
const nestedIndex = JSON.parse(nestedIndexBytes.toString('utf8'));
const platformDescriptor = nestedIndex.manifests?.find(
  (entry) => entry.platform?.os === 'linux' && entry.platform?.architecture === 'amd64',
);
if (!platformDescriptor) throw new Error('Missing linux/amd64 descriptor.');

const manifestBytes = readArchive(digestPath(platformDescriptor.digest));
if (`sha256:${sha256(manifestBytes)}` !== platformDescriptor.digest) throw new Error('Manifest digest mismatch.');
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const configBytes = readArchive(digestPath(manifest.config.digest));
if (`sha256:${sha256(configBytes)}` !== manifest.config.digest) throw new Error('Config digest mismatch.');
const config = JSON.parse(configBytes.toString('utf8'));

const layerDescriptor = manifest.layers.at(-1);
if (!layerDescriptor) throw new Error('Missing release layer.');
const compressedLayer = readArchive(digestPath(layerDescriptor.digest));
if (`sha256:${sha256(compressedLayer)}` !== layerDescriptor.digest) throw new Error('Layer digest mismatch.');
const layerBytes = gunzipSync(compressedLayer);
const expectedDiffId = config.rootfs?.diff_ids?.at(-1);
if (`sha256:${sha256(layerBytes)}` !== expectedDiffId) throw new Error('Layer diff ID mismatch.');

const listingResult = spawnSync('tar', ['-tf', '-'], { input: layerBytes, encoding: 'utf8' });
if (listingResult.status !== 0) throw new Error(listingResult.stderr || 'Unable to inspect release layer.');
const listing = listingResult.stdout.replaceAll('\\', '/').split(/\r?\n/);
for (const required of [
  'app/dist/.wh..wh..opq',
  'app/dist/index.html',
  'app/dist/server/index.js',
]) {
  if (!listing.includes(required)) throw new Error(`Release layer is missing ${required}.`);
}
if (!listing.some((entry) => /app\/dist\/assets\/PdfViewerPage-.*\.js$/.test(entry))) {
  throw new Error('Release layer is missing the viewer bundle.');
}
if (!listing.includes('app/dist/node_modules/@pdfit/pdfit/dist/front/export/documentExport.js')) {
  throw new Error('Release layer is missing the document export runtime.');
}

const legacyManifest = readJson('manifest.json');
if (legacyManifest?.[0]?.Layers?.at(-1) !== digestPath(layerDescriptor.digest)) {
  throw new Error('Legacy Docker manifest does not reference the release layer.');
}
if (legacyManifest?.[0]?.Config !== digestPath(manifest.config.digest)) {
  throw new Error('Legacy Docker manifest does not reference the release config.');
}

console.log(JSON.stringify({
  image: imagePath,
  platform: 'linux/amd64',
  layerDigest: layerDescriptor.digest,
  layerBytes: layerBytes.length,
  exportRuntime: true,
  legacyManifest: true,
}, null, 2));

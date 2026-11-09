// Copies non-TypeScript source assets that the emitted JavaScript imports.
// tsc emits imported JSON only when the source path is outside node_modules, so
// a checkout installed with `npm install <git url>` (under node_modules) would
// otherwise ship dist/front/i18n/uiText.js without its ./catalog/*.json files.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = [{ from: 'src/front/i18n/catalog', to: 'dist/front/i18n/catalog' }];

for (const asset of assets) {
  const source = path.join(packageDir, asset.from);
  const target = path.join(packageDir, asset.to);
  if (!existsSync(source)) throw new Error(`Missing asset source: ${asset.from}`);
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true, force: true });
  console.log(`[@pdfit/pdfit] copied ${readdirSync(target).length} files to ${asset.to}`);
}

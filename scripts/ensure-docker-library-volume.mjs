import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

const volume = process.env.PDFIT_BOOKS_VOLUME ?? 'linker-models';
const subpath = process.env.PDFIT_BOOKS_SUBPATH ?? 'bside/이북';
const result = spawnSync('docker', ['volume', 'inspect', volume], { encoding: 'utf8', windowsHide: true });

if (result.status !== 0) {
  console.error(`[pdfit] Docker library volume '${volume}' does not exist.`);
  console.error('[pdfit] Create or configure the Docker-managed CIFS volume before deploying.');
  process.exit(result.status ?? 1);
}

const probe = spawnSync(
  'docker',
  ['run', '--rm', '-v', `${volume}:/library:ro`, 'alpine', 'sh', '-lc', `test -d /library/${subpath} && find /library/${subpath} -maxdepth 1 -type f -iname '*.pdf' | wc -l`],
  { encoding: 'utf8', windowsHide: true },
);

if (probe.status !== 0) {
  console.error(`[pdfit] Docker library volume '${volume}' is mounted but the configured library path '${subpath}' is not visible.`);
  process.exit(probe.status ?? 1);
}

console.log(`[pdfit] Docker library volume ready: ${volume} (${subpath})`);

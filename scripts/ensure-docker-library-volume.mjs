import { existsSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { resolve } from 'node:path';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

const volume = process.env.PDFIT_BOOKS_VOLUME ?? 'linker-models';
const subpath = process.env.PDFIT_BOOKS_SUBPATH ?? 'bside/이북';
const smbHost = process.env.PDFIT_SMB_HOST;
const smbShare = process.env.PDFIT_SMB_SHARE;
const smbUsername = process.env.PDFIT_SMB_USERNAME;
const smbPassword = process.env.PDFIT_SMB_PASSWORD;
const smbProxyPort = Number(process.env.PDFIT_SMB_PROXY_PORT ?? '1445');

function isPortOpen(port) {
  return new Promise((resolvePort) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolvePort(true); });
    socket.once('timeout', () => { socket.destroy(); resolvePort(false); });
    socket.once('error', () => resolvePort(false));
  });
}

async function ensureSmbProxy() {
  if (!smbHost) return;
  if (!smbShare || !smbUsername || !smbPassword) {
    console.error('[pdfit] PDFIT_SMB_SHARE, PDFIT_SMB_USERNAME, and PDFIT_SMB_PASSWORD are required with PDFIT_SMB_HOST.');
    process.exit(1);
  }
  if (!Number.isInteger(smbProxyPort) || smbProxyPort < 1024 || smbProxyPort > 65535) {
    console.error('[pdfit] PDFIT_SMB_PROXY_PORT must be between 1024 and 65535.');
    process.exit(1);
  }
  if (await isPortOpen(smbProxyPort)) return;

  const proxy = spawn(process.execPath, [
    resolve('scripts/smb-tcp-proxy.mjs'),
    '--target-host', smbHost,
    '--target-port', '445',
    '--listen-port', String(smbProxyPort),
  ], { detached: true, stdio: 'ignore', windowsHide: true });
  proxy.unref();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    if (await isPortOpen(smbProxyPort)) return;
  }
  console.error(`[pdfit] SMB proxy did not start on 127.0.0.1:${smbProxyPort}.`);
  process.exit(1);
}

await ensureSmbProxy();

let result = spawnSync('docker', ['volume', 'inspect', volume], { encoding: 'utf8', windowsHide: true });

if (result.status !== 0 && smbHost) {
  const mountOptions = `username=${smbUsername},password=${smbPassword},vers=3.0,ro,port=${smbProxyPort}`;
  result = spawnSync('docker', [
    'volume', 'create', '--driver', 'local',
    '--opt', 'type=cifs',
    '--opt', `device=//host.docker.internal/${smbShare}`,
    '--opt', `o=${mountOptions}`,
    volume,
  ], { encoding: 'utf8', windowsHide: true });
}

if (result.status !== 0) {
  console.error(`[pdfit] Docker library volume '${volume}' does not exist.`);
  console.error('[pdfit] Create or configure the Docker-managed CIFS volume before deploying.');
  process.exit(result.status ?? 1);
}

const probe = spawnSync(
  'docker',
  ['run', '--rm', '-e', `LIBRARY_PATH=/library/${subpath}`, '-v', `${volume}:/library:ro`, 'alpine', 'sh', '-lc', 'test -d "$LIBRARY_PATH" && find "$LIBRARY_PATH" -type f -iname "*.pdf" | wc -l'],
  { encoding: 'utf8', windowsHide: true },
);

if (probe.status !== 0) {
  console.error(`[pdfit] Docker library volume '${volume}' is mounted but the configured library path '${subpath}' is not visible.`);
  process.exit(probe.status ?? 1);
}

console.log(`[pdfit] Docker library volume ready: ${volume} (${subpath}, ${probe.stdout.trim()} PDFs)`);

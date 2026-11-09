#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Shell environment first, then the workspace .env (the same precedence Compose uses).
function setting(name) {
  if (process.env[name] !== undefined) return process.env[name];
  const envFile = resolve(root, '.env');
  if (!existsSync(envFile)) return undefined;
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match?.[1] === name) return match[2];
  }
  return undefined;
}

// The standalone service also listens on one LAN address. Docker refuses to bind
// an address the host does not own, so pick a private IPv4 address of this host.
function lanAddress() {
  const candidates = Object.values(networkInterfaces()).flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
  const rank = (address) => address.startsWith('192.168.') ? 0
    : address.startsWith('10.') ? 1
    : /^172\.(1[6-9]|2\d|3[01])\./.test(address) ? 2
    : 3;
  return candidates.filter((address) => rank(address) < 3).sort((a, b) => rank(a) - rank(b))[0];
}

const port = setting('PDFIT_STANDALONE_PORT') || '15203';
const url = `http://127.0.0.1:${port}`;

function fail(message) {
  console.error(`[pdfit] ${message}`);
  process.exit(1);
}

function commandAvailable(command, args) {
  const result = spawnSync(command, args, { stdio: 'ignore', windowsHide: true });
  return result.error === undefined && result.status === 0;
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) fail(`실행할 수 없습니다: ${command} (${result.error.message})`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function openBrowser(target) {
  if (process.platform === 'win32') {
    spawnSync('cmd', ['/c', 'start', '', target], { stdio: 'ignore', windowsHide: true });
  } else if (process.platform === 'darwin') {
    spawnSync('open', [target], { stdio: 'ignore' });
  } else if (commandAvailable('xdg-open', [target])) {
    // xdg-open has already been started by the availability probe.
  } else {
    console.log(`[pdfit] 브라우저에서 열어주세요: ${target}`);
  }
}

if (!commandAvailable('docker', ['info'])) {
  fail('Docker Desktop 또는 Docker Engine이 실행 중이어야 합니다. Docker를 시작한 후 다시 실행하세요.');
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('사용법: npx pdfit [PDF 문서 루트 폴더] [--no-open]');
  console.log('폴더를 생략하면 실행 중 경로를 직접 입력받습니다.');
  console.log('--no-open: 실행 후 브라우저를 열지 않습니다.');
  console.log(`포트: PDFIT_STANDALONE_PORT (기본 15203). LAN 주소: PDFIT_LAN_BIND_ADDRESS (기본 자동 감지).`);
  process.exit(0);
}
const cliPath = args.find((arg) => !arg.startsWith('-'));
let booksPath = cliPath ?? process.env.PDFIT_BOOKS_HOST_PATH;

if (!booksPath) {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  booksPath = await readline.question('PDF 문서가 위치할 루트 폴더 경로를 입력하세요: ');
  readline.close();
}

if (!booksPath?.trim()) fail('문서 루트 폴더가 필요합니다.');
booksPath = booksPath.trim().replace(/^['"]|['"]$/g, '');
if (!isAbsolute(booksPath)) booksPath = resolve(process.cwd(), booksPath);
if (!existsSync(booksPath)) mkdirSync(booksPath, { recursive: true });
if (!statSync(booksPath).isDirectory()) fail(`폴더가 아닙니다: ${booksPath}`);

const resolvedBooksPath = realpathSync(booksPath);
const rootName = basename(resolvedBooksPath) || 'PDF library';
const bindAddress = setting('PDFIT_LAN_BIND_ADDRESS') || lanAddress();
if (!bindAddress) fail('LAN IPv4 주소를 찾지 못했습니다. PDFIT_LAN_BIND_ADDRESS에 이 PC의 IPv4 주소를 지정하세요.');
console.log(`[pdfit] 문서 루트: ${resolvedBooksPath}`);
console.log(`[pdfit] 접속 주소: ${url} (같은 네트워크: http://${bindAddress}:${port})`);
console.log('[pdfit] 빌드와 Docker Compose 업데이트를 시작합니다.');

// `npm install <git url>` copies only this package, not its workspace and build
// dependencies, so the first run installs them inside the package directory.
const npmCommand = process.platform === 'win32' ? 'cmd.exe' : 'npm';
const npmArgs = (script) => process.platform === 'win32' ? ['/d', '/s', '/c', `npm ${script}`] : script.split(' ');
if (!existsSync(resolve(root, 'node_modules', '.bin', process.platform === 'win32' ? 'turbo.cmd' : 'turbo'))) {
  console.log('[pdfit] 빌드 의존성을 설치합니다(처음 한 번).');
  run(npmCommand, npmArgs('install --no-audit --no-fund'));
}

// deploy:standalone recreates only the `pdfit` container. `npm run deploy` is the
// hosted service and needs private modules that the public checkout does not have.
run(npmCommand, npmArgs('run deploy:standalone'), {
  PDFIT_BOOKS_HOST_PATH: resolvedBooksPath,
  // Bind the chosen folder itself as the library root instead of the external NAS volume.
  PDFIT_BOOKS_SOURCE: resolvedBooksPath,
  PDFIT_BOOKS_SUBPATH: '',
  PDFIT_BOOKS_ROOT_NAME: rootName,
  PDFIT_LAN_BIND_ADDRESS: bindAddress,
  PDFIT_STANDALONE_PORT: port,
});

console.log(`[pdfit] PDFit이 실행되었습니다: ${url}`);
if (!args.includes('--no-open')) openBrowser(url);

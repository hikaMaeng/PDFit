#!/usr/bin/env node

import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = 'http://127.0.0.1:15201';

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
  console.log('사용법: npx pdfit [PDF 문서 루트 폴더]');
  console.log('폴더를 생략하면 실행 중 경로를 직접 입력받습니다.');
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
console.log(`[pdfit] 문서 루트: ${resolvedBooksPath}`);
console.log('[pdfit] 빌드와 Docker Compose 업데이트를 시작합니다.');

run(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run deploy'] : ['run', 'deploy'], {
  PDFIT_BOOKS_HOST_PATH: resolvedBooksPath,
  PDFIT_BOOKS_ROOT_NAME: rootName,
});

console.log(`[pdfit] PDFit이 실행되었습니다: ${url}`);
openBrowser(url);

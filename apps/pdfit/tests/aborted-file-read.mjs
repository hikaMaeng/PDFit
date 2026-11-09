// Regression check: a client that aborts a PDF read mid-stream must not crash the
// server. PDF.js aborts range reads when the cover view cancels off-screen
// covers or a tab closes; before the fix the sendFile callback answered again
// after headers were sent and the uncaught ERR_HTTP_HEADERS_SENT killed Node.
//
// Usage: PDFIT_BASE_URL=http://127.0.0.1:15203 PDFIT_FOLDER=<folder> PDFIT_FILE=<large.pdf> \
//        [PDFIT_CONTAINER=pdfit-pdfit-1] node apps/pdfit/tests/aborted-file-read.mjs
// Read-only: it only issues GET requests. Use a file of several MB so the abort
// happens while the body is still streaming.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';

const baseUrl = new URL(process.env.PDFIT_BASE_URL ?? 'http://127.0.0.1:15203');
const folder = process.env.PDFIT_FOLDER;
const file = process.env.PDFIT_FILE;
const container = process.env.PDFIT_CONTAINER;
const attempts = Number(process.env.PDFIT_ABORT_ATTEMPTS ?? '5');
assert.ok(folder && file, 'PDFIT_FOLDER and PDFIT_FILE are required');

function restartCount() {
  if (!container) return null;
  const result = spawnSync('docker', ['inspect', '-f', '{{.RestartCount}} {{.State.StartedAt}}', container], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function abortMidStream() {
  return new Promise((resolve) => {
    const request = http.get({
      host: baseUrl.hostname,
      port: baseUrl.port,
      path: `/api/folders/${encodeURIComponent(folder)}/files/${encodeURIComponent(file)}`,
      headers: { Range: 'bytes=0-' },
    }, (response) => {
      response.once('data', (chunk) => {
        const status = response.statusCode;
        request.destroy();
        resolve({ status, firstChunkBytes: chunk.length });
      });
    });
    // ECONNRESET is our own abort; anything else (e.g. ECONNREFUSED while a
    // crashed server restarts) is recorded as the result of this attempt.
    request.on('error', (error) => { if (error.code !== 'ECONNRESET') resolve({ requestError: error.code ?? error.message }); });
    // A server that dies before the first body chunk closes the socket; the
    // first resolve wins, so this only reports attempts that never saw data.
    request.on('close', () => resolve({ requestError: 'closed-before-data' }));
    request.setTimeout(15_000, () => { resolve({ requestError: 'timeout' }); request.destroy(); });
  });
}

async function health() {
  try {
    const response = await fetch(new URL('/health', baseUrl), { signal: AbortSignal.timeout(5_000) });
    return response.status;
  } catch (error) {
    return `error: ${error.cause?.code ?? error.message}`;
  }
}

const before = restartCount();
const results = [];
for (let index = 0; index < attempts; index += 1) {
  const aborted = await abortMidStream();
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  results.push({ ...aborted, healthAfter: await health() });
}
const after = restartCount();
const summary = { baseUrl: baseUrl.href, folder, file, attempts, results, restartBefore: before, restartAfter: after };
console.log(JSON.stringify(summary, null, 2));
assert.ok(results.every((result) => !result.requestError && result.healthAfter === 200), 'server must stay healthy after aborted reads');
if (before !== null) assert.equal(after, before, 'container must not restart after aborted reads');

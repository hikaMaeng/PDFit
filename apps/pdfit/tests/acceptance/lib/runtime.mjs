import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createPageNumberPdf } from './pdf-fixtures.mjs';

const configuredDataRoot = process.env.PDFIT_ACCEPTANCE_DATA_ROOT;
const dataRoot = configuredDataRoot ?? path.join('apps', 'pdfit', 'docker', 'volumes', 'data');
const booksRoot = path.join(dataRoot, 'books');
const configuredComposeFile = process.env.PDFIT_ACCEPTANCE_COMPOSE_FILE;
const ACCEPTANCE_RESET_CONFIRMATION = 'PDFIT-ACCEPTANCE-ISOLATED-RESET';

function realPathIfPresent(target) {
  try {
    return fs.realpathSync.native(target);
  } catch {
    return path.resolve(target);
  }
}

function assertDestructiveAcceptanceTarget(root, baseUrl) {
  const target = new URL(baseUrl);
  const isProductionPort = target.port === '15201' || (target.hostname === '127.0.0.1' && target.port === '');
  if (isProductionPort) {
    throw new Error(`Refusing destructive acceptance reset against production URL ${baseUrl}. Use an isolated test service on a different port.`);
  }
  if (process.env.PDFIT_ACCEPTANCE_ALLOW_DESTRUCTIVE_RESET !== ACCEPTANCE_RESET_CONFIRMATION) {
    throw new Error(`Refusing destructive acceptance reset. Set PDFIT_ACCEPTANCE_ALLOW_DESTRUCTIVE_RESET=${ACCEPTANCE_RESET_CONFIRMATION} only for an isolated test database.`);
  }
  const rootPath = realPathIfPresent(root);
  const runtimeDataPath = realPathIfPresent(path.join(root, 'apps/pdfit/docker/volumes/data'));
  const acceptanceDataPath = realPathIfPresent(path.resolve(root, dataRoot));
  const workspaceIsInsideData = path.relative(acceptanceDataPath, rootPath) !== ''
    && !path.relative(acceptanceDataPath, rootPath).startsWith(`..${path.sep}`)
    && !path.isAbsolute(path.relative(acceptanceDataPath, rootPath));
  if (!configuredDataRoot || acceptanceDataPath === runtimeDataPath || acceptanceDataPath === rootPath || workspaceIsInsideData) {
    throw new Error('Refusing destructive acceptance reset against the repository runtime data directory. Configure an isolated test data directory.');
  }
  const productionComposePath = realPathIfPresent(path.join(root, 'docker-compose.yml'));
  const acceptanceComposePath = configuredComposeFile ? realPathIfPresent(path.resolve(root, configuredComposeFile)) : null;
  if (!configuredComposeFile || acceptanceComposePath === productionComposePath || !fs.existsSync(acceptanceComposePath)) {
    throw new Error('Refusing destructive acceptance reset through the production Compose file. Configure an isolated acceptance Compose file.');
  }
}

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

export function describeError(error) {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

export async function collectDeployEvidence(root) {
  return {
    deployScript: 'npm run deploy',
    distIndexExists: fs.existsSync(path.join(root, 'apps/pdfit/dist/index.html')),
    viewerIndexExists: fs.existsSync(path.join(root, 'apps/pdfit/dist/viewer/index.html')),
  };
}

export async function collectDockerEvidence(root) {
  if (!configuredComposeFile) throw new Error('Acceptance Compose file is not configured.');
  return {
    composePs: execFileSync('docker', ['compose', '-f', configuredComposeFile, 'ps', 'pdfit'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
  };
}

export async function resetPdfitService(root, baseUrl) {
  assertDestructiveAcceptanceTarget(root, baseUrl);
  const composeArgs = ['compose', '-f', configuredComposeFile];
  try {
    execFileSync('docker', [...composeArgs, 'rm', '-sf', 'pdfit'], {
      cwd: root,
      stdio: 'ignore',
    });
  } catch {
    // container may already be gone after a previous failure
  }
  await rm(booksRoot, { recursive: true, force: true });
  await mkdir(booksRoot, { recursive: true });
  execFileSync('docker', [...composeArgs, 'up', '-d', '--force-recreate', '--remove-orphans', 'pdfit'], {
    cwd: root,
    stdio: 'ignore',
  });
  await waitForService(baseUrl);
  execFileSync('docker', [
    ...composeArgs, 'exec', '-T', 'pdfit',
    'psql', '-U', 'books', '-d', 'books', '-v', 'ON_ERROR_STOP=1', '-c',
    'TRUNCATE reading_progress, book_tags, viewer_state, tags RESTART IDENTITY CASCADE',
  ], { cwd: root, stdio: 'ignore' });
}

export async function waitForService(baseUrl) {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    try {
      const response = await fetch(`${baseUrl}/api/folders`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await sleep(1000);
  }
  throw new Error(`Service did not become ready at ${baseUrl}.`);
}

export async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return data;
}

export async function assertEmptyState(baseUrl) {
  await waitForService(baseUrl);
  const [folders, tags] = await Promise.all([
    fetchJson(`${baseUrl}/api/folders`),
    fetchJson(`${baseUrl}/api/tags`),
  ]);
  // The configured external library is intentionally persistent and is
  // exposed as the root folder. Acceptance cases own only non-root fixtures;
  // never treat the bind-mounted library as disposable test state.
  assert.deepEqual(folders.filter((folder) => !folder.isRoot), []);
  assert.deepEqual(tags, []);
}

export async function seedCase(context, seed) {
  for (const folder of seed.folders ?? []) {
    await fetchJson(`${context.baseUrl}/api/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folder.name }),
    });
    if ((folder.files ?? []).length > 0) {
      const form = new FormData();
      for (const file of folder.files ?? []) {
        const pdf = await createPageNumberPdf(context.browser, file.pages, `${folder.name}/${file.name}`);
        form.append('files', new Blob([pdf], { type: 'application/pdf' }), file.name);
      }
      const response = await fetch(`${context.baseUrl}/api/folders/${encodeURIComponent(folder.name)}/files`, {
        method: 'POST',
        body: form,
      });
      if (!response.ok) {
        throw new Error(`Failed to seed files for ${folder.name}: ${await response.text()}`);
      }
      for (const file of folder.files ?? []) {
        await waitForFile(context.baseUrl, folder.name, file.name);
      }
    }
  }

  for (const tag of seed.tags ?? []) {
    await fetchJson(`${context.baseUrl}/api/tags/book/${encodeURIComponent(tag.folder)}/${encodeURIComponent(tag.filename)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: tag.tag }),
    });
  }

  for (const progress of seed.progress ?? []) {
    await fetchJson(`${context.baseUrl}/api/progress/${encodeURIComponent(progress.folder)}/${encodeURIComponent(progress.filename)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: progress.page }),
    });
  }

  for (const state of seed.viewerStates ?? []) {
    await fetchJson(`${context.baseUrl}/api/viewer-state/${encodeURIComponent(state.folder)}/${encodeURIComponent(state.filename)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
  }
}

export async function cleanupSeed(baseUrl, seed) {
  for (const folder of seed.folders ?? []) {
    const filesResponse = await fetch(`${baseUrl}/api/folders/${encodeURIComponent(folder.name)}/files`);
    if (filesResponse.ok) {
      const files = await filesResponse.json();
      for (const file of files) {
        const deleteFileResponse = await fetch(
          `${baseUrl}/api/folders/${encodeURIComponent(folder.name)}/files/${encodeURIComponent(file.name)}`,
          { method: 'DELETE' },
        );
        if (!deleteFileResponse.ok && deleteFileResponse.status !== 404) {
          throw new Error(`Failed to clean acceptance file ${folder.name}/${file.name}: ${deleteFileResponse.status}`);
        }
      }
    }
    const response = await fetch(`${baseUrl}/api/folders/${encodeURIComponent(folder.name)}`, {
      method: 'DELETE',
    });
    const responseText = response.ok ? '' : await response.text();
    const missingFolder = response.status === 400 && responseText.includes('Folder does not exist');
    if (!response.ok && response.status !== 404 && !missingFolder) {
      throw new Error(`Failed to clean acceptance folder ${folder.name}: ${response.status}`);
    }
  }
}

export async function runCase(context, testCase) {
  await testCase.run(context);
}

export async function waitForFile(baseUrl, folder, filename) {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const files = await fetchJson(`${baseUrl}/api/folders/${encodeURIComponent(folder)}/files`);
    if (Array.isArray(files) && files.some((file) => file.name === filename)) return;
    await sleep(250);
  }
  throw new Error(`Seeded file was not visible: ${folder}/${filename}`);
}

export async function createCaseContext({ browser, baseUrl, root, testCase, reportPath }) {
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: { width: 1600, height: 1200 },
  });
  const page = await context.newPage();
  return {
    browser,
    baseUrl,
    root,
    testCase,
    reportPath,
    context,
    page,
    notes: [],
    async close() {
      await context.close();
    },
  };
}

export async function captureFailureArtifact(caseContext, caseId) {
  const shotDir = path.join(path.dirname(caseContext.reportPath), 'shots');
  await mkdir(shotDir, { recursive: true });
  const shotPath = path.join(shotDir, `${caseId}.png`);
  try {
    await caseContext.page.screenshot({ path: shotPath, fullPage: true });
    return shotPath;
  } catch {
    return null;
  }
}

export function summarizeCases(cases) {
  return {
    total: cases.length,
    passed: cases.filter((item) => item.status === 'passed').length,
    failed: cases.filter((item) => item.status === 'failed').length,
  };
}

export function renderReport(report) {
  const lines = [];
  lines.push('# Test Report: pdfit-acceptance-matrix');
  lines.push('## Timestamp');
  lines.push(report.finishedAt.toISOString());
  lines.push('## Environment');
  lines.push(`- baseUrl: ${report.baseUrl}`);
  lines.push(`- deploy: ${JSON.stringify(report.deploy)}`);
  lines.push(`- docker: ${JSON.stringify(report.docker)}`);
  lines.push('## Executed Steps');
  lines.push('- reset integrated container and clear data');
  lines.push('- seed each selected case');
  lines.push('- run browser and API assertions');
  lines.push('## Case Results');
  lines.push('| id | group | title | status | screenshot |');
  lines.push('|---|---|---|---|---|');
  for (const item of report.cases) {
    lines.push(`| ${item.id} | ${item.group} | ${escapeTable(item.title)} | ${item.status} | ${item.screenshot ?? ''} |`);
  }
  lines.push('## Observed Logs');
  lines.push('- no runtime log capture wired in this runner');
  lines.push('## Failures');
  const failures = report.cases.filter((item) => item.status === 'failed');
  if (failures.length === 0) {
    lines.push('- none');
  } else {
    for (const item of failures) {
      lines.push(`- ${item.id}: ${item.error}`);
      if (item.screenshot) {
        lines.push(`  - screenshot: ${item.screenshot}`);
      }
    }
  }
  lines.push('## Reproducibility');
  lines.push('- npm run verify:pdfit:acceptance -- --case <id>');
  lines.push('- npm run verify:pdfit:acceptance -- --group <name>');
  lines.push('## Uncovered Risks');
  lines.push('- viewer interaction coverage depends on the current MUI DOM structure');
  lines.push('- database reset uses PostgreSQL TRUNCATE; physical pgvector storage corruption/recovery is not covered');
  return `${lines.join('\n')}\n`;
}

export function renderFailureSummary(report) {
  return report.cases
    .filter((item) => item.status === 'failed')
    .map((item) => `${item.id}: ${item.error}`)
    .join('\n');
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeTable(value) {
  return String(value).replace(/\|/g, '\\|');
}

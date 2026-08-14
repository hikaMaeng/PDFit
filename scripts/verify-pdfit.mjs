import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const dist = path.join(root, 'apps/pdfit/dist');
const settingsRoute = path.join(dist, 'server/routes/settings.js');
const manifestPath = path.join(dist, '.vite/manifest.json');
const baseUrl = 'http://127.0.0.1:15201';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForServiceReady(page, url) {
  let lastError = null;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5_000 });
      if (response?.ok()) return;
      lastError = new Error(`unexpected status ${response?.status() ?? 'unknown'}`);
    } catch (error) {
      lastError = error;
    }
    await page.waitForTimeout(2_000);
  }
  throw lastError ?? new Error('service did not become ready in time');
}

assert(existsSync(dist), 'apps/pdfit/dist is missing.');
assert(existsSync(settingsRoute), 'Integrated artifact is missing settings.js.');
assert(existsSync(path.join(dist, 'viewer/index.html')), 'Integrated viewer entry is missing.');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const serviceEntry = manifest['index.html'];
const viewerEntry = manifest['viewer/index.html'];
assert(serviceEntry?.file && viewerEntry?.file, 'Integrated manifest is missing service/viewer entries.');

const serviceBundle = readFileSync(path.join(dist, serviceEntry.file), 'utf8');
const viewerBundle = readFileSync(path.join(dist, viewerEntry.file), 'utf8');
assert(serviceBundle.includes('/settings') && serviceBundle.includes('AI servers'), 'Integrated service bundle is missing settings UI.');
assert(viewerBundle.includes('PDF Viewer'), 'Integrated viewer bundle is missing viewer entry content.');
assert(!viewerBundle.includes('/settings') && !viewerBundle.includes('AI servers'), 'Viewer bundle contains service settings UI.');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await waitForServiceReady(page, baseUrl);
await page.waitForSelector('text=PDFit');
await page.getByRole('button', { name: 'Settings' }).click();
await page.waitForSelector('text=AI servers');

const aiServers = await page.request.get(`${baseUrl}/api/settings/ai-servers`);
const pgvector = await page.request.get(`${baseUrl}/api/settings/pgvector`);
assert(aiServers.ok(), `AI servers endpoint failed with ${aiServers.status()}.`);
assert(pgvector.ok(), `PGVector endpoint failed with ${pgvector.status()}.`);

const originalPgvector = await pgvector.json();
const originalAiServers = await aiServers.json();
const testServerName = `Integrated Verify ${Date.now()}`;
let createdServerId = null;

try {
  const createResponse = await page.request.post(`${baseUrl}/api/settings/ai-servers`, {
    data: {
      name: testServerName,
      type: 'openai-compat',
      url: 'http://localhost:11434/v1',
      headers: { Authorization: 'Bearer codex-test' },
      models: { llm: 'codex-llm', embedding: 'codex-embed' },
    },
  });
  assert(createResponse.ok(), `AI server creation failed with ${createResponse.status()}.`);
  createdServerId = (await createResponse.json()).id;

  const patchResponse = await page.request.patch(`${baseUrl}/api/settings/ai-servers/${createdServerId}`, {
    data: { name: `${testServerName} Updated`, models: { vision: 'codex-vision' } },
  });
  assert(patchResponse.ok(), `AI server update failed with ${patchResponse.status()}.`);

  const updatedServers = await (await page.request.get(`${baseUrl}/api/settings/ai-servers`)).json();
  const updatedServer = updatedServers.find((item) => item.id === createdServerId);
  assert(updatedServer?.name === `${testServerName} Updated`, 'AI server update was not persisted.');
  assert(updatedServer.models.vision === 'codex-vision', 'AI server model update was not persisted.');

  const nextPgvector = { user: `verify-user-${Date.now()}`, password: 'verify-pass' };
  const saveResponse = await page.request.put(`${baseUrl}/api/settings/pgvector`, { data: nextPgvector });
  assert(saveResponse.ok(), `PGVector save failed with ${saveResponse.status()}.`);
  const savedPgvector = await (await page.request.get(`${baseUrl}/api/settings/pgvector`)).json();
  assert(savedPgvector.user === nextPgvector.user && savedPgvector.password === nextPgvector.password, 'PGVector settings were not persisted.');
} finally {
  if (createdServerId !== null) {
    const response = await page.request.delete(`${baseUrl}/api/settings/ai-servers/${createdServerId}`);
    assert(response.ok(), `AI server cleanup failed with ${response.status()}.`);
  }
  const restoreResponse = await page.request.put(`${baseUrl}/api/settings/pgvector`, { data: originalPgvector });
  assert(restoreResponse.ok(), `PGVector restore failed with ${restoreResponse.status()}.`);
  const finalServers = await (await page.request.get(`${baseUrl}/api/settings/ai-servers`)).json();
  assert(finalServers.length === originalAiServers.length, 'AI server cleanup left an unexpected row behind.');
}

await page.goto(`${baseUrl}/viewer`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=PDF Viewer');
assert(await page.locator('text=Settings').count() === 0, 'Viewer entry unexpectedly renders service navigation.');

await browser.close();
console.log('verify:pdfit passed');

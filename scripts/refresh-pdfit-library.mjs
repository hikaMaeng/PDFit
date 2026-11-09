const baseUrl = process.env.PDFIT_LOCAL_BASE_URL ?? 'http://127.0.0.1:15201';

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The container may still be starting PostgreSQL and the application.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`[pdfit] Timed out waiting for ${baseUrl}/health.`);
}

await waitForHealth();
const response = await fetch(`${baseUrl}/api/folders/refresh`, { method: 'POST' });
if (!response.ok) {
  throw new Error(`[pdfit] Library refresh failed with HTTP ${response.status}.`);
}

const folders = await response.json();
if (!Array.isArray(folders)) throw new Error('[pdfit] Library refresh returned an invalid response.');
const pdfCount = folders.reduce((total, folder) => total + (Number(folder?.pdfCount) || 0), 0);
console.log(`[pdfit] Library index ready: ${pdfCount} PDFs across ${folders.length} folders.`);

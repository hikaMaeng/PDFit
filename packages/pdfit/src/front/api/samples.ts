export interface SampleLibraryStatus {
  inLibrary: boolean;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

/** Reads whether a shared-library PDF has already been copied to the user's library. */
export async function getSampleLibraryStatus(sampleId: string): Promise<SampleLibraryStatus> {
  const response = await fetch(`/api/samples/${encodeURIComponent(sampleId)}/status`);
  const body = await readJson(response);
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Sample status could not be loaded.');
  return { inLibrary: body.inLibrary === true };
}

/** Copies a read-only shared-library PDF into the signed-in user's library. */
export async function addSampleToLibrary(sampleId: string): Promise<{ alreadyInLibrary: boolean }> {
  const response = await fetch(`/api/samples/${encodeURIComponent(sampleId)}/import`, { method: 'POST' });
  const body = await readJson(response);
  if (response.status === 409) return { alreadyInLibrary: true };
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Sample PDF could not be added.');
  return { alreadyInLibrary: false };
}

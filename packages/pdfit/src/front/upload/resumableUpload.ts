export const RESUMABLE_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_RECOVERY_ATTEMPTS = 4;

export class ResumableSessionExpiredError extends Error {}

interface UploadResponse { status: number; receivedEnd: number }

function nextOffset(range: string | null): number {
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/.exec(range.trim());
  return match ? Number(match[1]) + 1 : 0;
}

function put(sessionUrl: string, body: Blob | null, contentRange: string, onProgress?: (loaded: number) => void): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', sessionUrl);
    xhr.setRequestHeader('Content-Range', contentRange);
    if (body) xhr.setRequestHeader('Content-Type', 'application/pdf');
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(event.loaded); };
    xhr.onload = () => resolve({ status: xhr.status, receivedEnd: nextOffset(xhr.getResponseHeader('Range')) });
    xhr.onerror = () => reject(new Error('Direct upload network error.'));
    xhr.onabort = () => reject(new Error('Direct upload was interrupted.'));
    xhr.send(body);
  });
}

async function recoverOffset(sessionUrl: string, total: number): Promise<number> {
  const response = await put(sessionUrl, null, `bytes */${total}`);
  if (response.status === 200 || response.status === 201) return total;
  if (response.status === 404) throw new ResumableSessionExpiredError('Resumable upload session expired.');
  if (response.status !== 308) throw new Error(`Upload status query failed (HTTP ${response.status}).`);
  return response.receivedEnd;
}

/** Uploads a PDF directly to a Google resumable session and recovers interrupted chunks. */
export async function uploadPdfToResumableSession(sessionUrl: string, file: File, onProgress?: (loaded: number) => void): Promise<void> {
  if (!sessionUrl.startsWith('https://www.googleapis.com/upload/drive/')) throw new Error('Unexpected resumable upload host.');
  let offset = 0;
  let recoveries = 0;
  while (offset < file.size) {
    const endExclusive = Math.min(offset + RESUMABLE_UPLOAD_CHUNK_BYTES, file.size);
    try {
      const response = await put(sessionUrl, file.slice(offset, endExclusive), `bytes ${offset}-${endExclusive - 1}/${file.size}`, (chunkLoaded) => onProgress?.(offset + chunkLoaded));
      if (response.status === 200 || response.status === 201) { onProgress?.(file.size); return; }
      if (response.status === 404) throw new ResumableSessionExpiredError('Resumable upload session expired.');
      if (response.status !== 308) throw new Error(`Direct upload failed (HTTP ${response.status}).`);
      offset = response.receivedEnd;
      recoveries = 0;
    } catch (error) {
      if (error instanceof ResumableSessionExpiredError) throw error;
      recoveries += 1;
      if (recoveries > MAX_RECOVERY_ATTEMPTS) throw error;
      offset = await recoverOffset(sessionUrl, file.size);
      onProgress?.(offset);
    }
  }
}

/** Fast client-side signature guard retained when binary no longer traverses the service. */
export async function isPdfFile(file: File): Promise<boolean> {
  return file.name.toLowerCase().endsWith('.pdf') && new TextDecoder('ascii').decode(await file.slice(0, 5).arrayBuffer()) === '%PDF-';
}

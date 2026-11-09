import type { Annotation } from '../../common/protocol/annotations/index.js';
import type { BookmarkRecord } from '../../common/protocol/bookmarks/index.js';
import { listAnnotations } from '../api/annotations.js';
import { listBookmarks } from '../api/bookmarks.js';
import { progressApi } from '../api/progress.js';
import { tagsApi } from '../api/tags.js';
import { viewerStateApi, type ViewerStatePayload } from '../api/viewerState.js';

export type DocumentExportFormat = 'pdf' | 'markdown' | 'json';

export interface PortableBookmark extends Omit<BookmarkRecord, 'imageUrl'> {
  imageDataUrl: string | null;
}

export interface DocumentExportBundle {
  formatVersion: 1;
  exportedAt: string;
  document: {
    folder: string;
    filename: string;
    driveFileId: string | null;
    documentId: string;
  };
  tags: string[];
  progressPage: number;
  viewerState: ViewerStatePayload | null;
  annotations: Annotation[];
  bookmarks: PortableBookmark[];
}

/** Converts a same-origin bookmark asset into a portable data URL. */
async function bookmarkImageDataUrl(imageUrl: string): Promise<string | null> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('Bookmark image could not be read.'));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Loads one document's portable PDFIT metadata without modifying the source PDF. */
export async function loadDocumentExportBundle(input: {
  folder: string;
  filename: string;
  driveFileId?: string | null;
  documentId: string;
  currentViewerState?: ViewerStatePayload | null;
}): Promise<DocumentExportBundle> {
  const [tags, progressPage, storedViewerState, annotations, bookmarks] = await Promise.all([
    tagsApi.listForBook(input.folder, input.filename, input.driveFileId),
    progressApi.get(input.folder, input.filename, input.driveFileId),
    input.currentViewerState
      ? Promise.resolve(input.currentViewerState)
      : viewerStateApi.get(input.folder, input.filename, input.driveFileId),
    listAnnotations(input.documentId),
    listBookmarks(input.folder, input.filename),
  ]);
  const portableBookmarks: PortableBookmark[] = [];
  for (const bookmark of bookmarks) {
    const { imageUrl, ...metadata } = bookmark;
    portableBookmarks.push({ ...metadata, imageDataUrl: await bookmarkImageDataUrl(imageUrl) });
  }
  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    document: {
      folder: input.folder,
      filename: input.filename,
      driveFileId: input.driveFileId ?? null,
      documentId: input.documentId,
    },
    tags,
    progressPage,
    viewerState: storedViewerState,
    annotations,
    bookmarks: portableBookmarks,
  };
}

function markdownText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function annotationDescription(annotation: Annotation): string {
  if (annotation.type === 'text') return annotation.geometry.text;
  if (annotation.type === 'ink') return `ink (${annotation.geometry.points.length} points)`;
  if (annotation.type === 'line' || annotation.type === 'arrow') {
    return `${annotation.type} (${annotation.geometry.start.x.toFixed(1)}, ${annotation.geometry.start.y.toFixed(1)}) -> (${annotation.geometry.end.x.toFixed(1)}, ${annotation.geometry.end.y.toFixed(1)})`;
  }
  return `${annotation.type} (${annotation.geometry.x.toFixed(1)}, ${annotation.geometry.y.toFixed(1)}, ${annotation.geometry.width.toFixed(1)} x ${annotation.geometry.height.toFixed(1)})`;
}

/** Serializes a document export as a readable, single-file Markdown note. */
export function formatDocumentExportMarkdown(bundle: DocumentExportBundle): string {
  const lines = [
    `# ${markdownText(bundle.document.filename)}`,
    '',
    `- PDFIT export version: ${bundle.formatVersion}`,
    `- Exported at: ${bundle.exportedAt}`,
    `- Folder: ${markdownText(bundle.document.folder)}`,
    `- Tags: ${bundle.tags.length ? bundle.tags.map(markdownText).join(', ') : '-'}`,
    `- Reading page: ${bundle.progressPage}`,
    '',
    '## Bookmarks',
    '',
  ];
  if (!bundle.bookmarks.length) lines.push('_No bookmarks._', '');
  for (const bookmark of bundle.bookmarks) {
    lines.push(`### Page ${bookmark.pageIndex + 1}`, '');
    if (bookmark.comment) lines.push(`> ${markdownText(bookmark.comment).replace(/\n/g, '\n> ')}`, '');
    if (bookmark.imageDataUrl) lines.push(`![Page ${bookmark.pageIndex + 1} bookmark](${bookmark.imageDataUrl})`, '');
    lines.push(`- Created: ${bookmark.createdAt}`, '');
  }
  lines.push('## Annotations', '');
  if (!bundle.annotations.length) lines.push('_No annotations._', '');
  for (const annotation of bundle.annotations) {
    lines.push(`- Page ${annotation.pageIndex + 1} · ${markdownText(annotationDescription(annotation))}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Starts a browser download while keeping the source document unchanged. */
export function downloadExportFile(filename: string, content: Blob | string, mimeType?: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType ?? 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

type SaveFilePickerHandle = {
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
};

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<SaveFilePickerHandle>;
};

/** Builds a same-origin attachment URL for browsers without a native save picker. */
export function originalPdfDownloadUrl(documentUrl: string): string {
  const url = new URL(documentUrl, window.location.href);
  url.searchParams.set('download', '1');
  return url.toString();
}

/** Downloads the original PDF through the native Save As picker. */
export async function downloadOriginalPdf(documentUrl: string, filename: string): Promise<'saved' | 'cancelled'> {
  const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (!picker) throw new Error('Native save picker is unavailable.');
  let handle: SaveFilePickerHandle;
  try {
    handle = await picker.call(window, {
      suggestedName: filename,
      types: [{ description: 'Adobe Acrobat document', accept: { 'application/pdf': ['.pdf'] } }],
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    throw error;
  }
  const response = await fetch(documentUrl);
  if (!response.ok) throw new Error(`PDF download failed (${response.status}).`);
  const writable = await handle.createWritable();
  try {
    await writable.write(await response.blob());
    await writable.close();
  } catch (error) {
    try { await writable.close(); } catch { /* Preserve the original write failure. */ }
    throw error;
  }
  return 'saved';
}

export function exportBaseName(filename: string): string {
  return filename.replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'pdfit-document';
}

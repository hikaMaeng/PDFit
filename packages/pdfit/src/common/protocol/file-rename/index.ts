export const FILE_RENAME_PATH = '/files/rename';

export interface RenamePdfRequest {
  folder: string;
  filename: string;
  newName: string;
  driveFileId?: string;
}

export interface RenamedPdf {
  name: string;
  size: number;
  modifiedAt: string;
  driveFileId?: string;
  clipCount?: number;
  clipCountRevision?: number;
}

const invalidFilenameCharacters = /[<>:"/\\|?*%\u0000-\u001f]/;

export function isValidPdfFilename(value: string): boolean {
  const stem = value.slice(0, -4);
  return /\.pdf$/i.test(value) && Boolean(stem.trim()) && stem === stem.trim() &&
    !invalidFilenameCharacters.test(value) && !/[.]$/.test(stem) &&
    !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem) &&
    new TextEncoder().encode(value).length <= 255;
}

export function parseRenamePdfRequest(value: unknown): RenamePdfRequest | null {
  if (!value || typeof value !== 'object' || !('folder' in value) || !('filename' in value) || !('newName' in value) ||
    typeof value.folder !== 'string' || typeof value.filename !== 'string' || typeof value.newName !== 'string' ||
    !value.folder || value.folder === '.' || value.folder === '..' || invalidFilenameCharacters.test(value.folder) ||
    !/\.pdf$/i.test(value.filename) || invalidFilenameCharacters.test(value.filename) ||
    !isValidPdfFilename(value.newName)) return null;
  const driveFileId = 'driveFileId' in value ? value.driveFileId : undefined;
  if (driveFileId !== undefined && (typeof driveFileId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(driveFileId))) return null;
  return { folder: value.folder, filename: value.filename, newName: value.newName, driveFileId };
}

export function parseRenamedPdf(value: unknown): RenamedPdf | null {
  if (!value || typeof value !== 'object' || !('name' in value) || !('size' in value) || !('modifiedAt' in value) ||
    typeof value.name !== 'string' || typeof value.size !== 'number' || typeof value.modifiedAt !== 'string') return null;
  return {
    name: value.name,
    size: value.size,
    modifiedAt: value.modifiedAt,
    ...('driveFileId' in value && typeof value.driveFileId === 'string' ? { driveFileId: value.driveFileId } : {}),
    ...('clipCount' in value && typeof value.clipCount === 'number' ? { clipCount: value.clipCount } : {}),
    ...('clipCountRevision' in value && typeof value.clipCountRevision === 'number' ? { clipCountRevision: value.clipCountRevision } : {}),
  };
}

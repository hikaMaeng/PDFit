export interface TagFolder {
  id: string;
  name: string;
  color: string | null;
  tags: string[];
}

export interface EditTagFolderRequest {
  name?: string;
  color?: string | null;
}

export type TagFolderDirection = 'up' | 'down';

export interface MoveTagFolderRequest {
  direction: TagFolderDirection;
  neighborId: string;
}

export const TAG_FOLDERS_PATH = '/api/tag-folders';
export const EDIT_TAG_FOLDER_ROUTE = { method: 'PATCH', path: '/:id/details' } as const;
export const MOVE_TAG_FOLDER_ROUTE = { method: 'POST', path: '/:id/move' } as const;
export const TAG_FOLDER_NAME_MAX = 100;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COLOR = /^#[0-9a-f]{6}$/i;

export function isTagFolderId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

export function normalizeTagFolderName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFC').trim();
  // Existing membership and delete URLs use the folder name as a path segment.
  return name && name.length <= TAG_FOLDER_NAME_MAX && name !== '.' && name !== '..'
    && !/[\u0000\uD800-\uDFFF]/u.test(name) ? name : null;
}

export function parseEditTagFolderRequest(value: unknown): EditTagFolderRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const patch: EditTagFolderRequest = {};
  if ('name' in value) {
    const name = normalizeTagFolderName(value.name);
    if (name === null) return null;
    patch.name = name;
  }
  if ('color' in value) {
    if (value.color !== null && (typeof value.color !== 'string' || !COLOR.test(value.color))) return null;
    patch.color = value.color?.toLowerCase() ?? null;
  }
  return patch.name === undefined && patch.color === undefined ? null : patch;
}

export function parseMoveTagFolderRequest(value: unknown): MoveTagFolderRequest | null {
  if (!value || typeof value !== 'object' || !('direction' in value) || !('neighborId' in value)) return null;
  const { direction, neighborId } = value;
  if ((direction !== 'up' && direction !== 'down') || !isTagFolderId(neighborId)) return null;
  return { direction, neighborId };
}

function isTagFolder(value: unknown): value is TagFolder {
  return !!value && typeof value === 'object'
    && 'id' in value && isTagFolderId(value.id)
    && 'name' in value && typeof value.name === 'string'
    && 'color' in value && (value.color === null || (typeof value.color === 'string' && COLOR.test(value.color)))
    && 'tags' in value && Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === 'string');
}

export function parseTagFolders(value: unknown): TagFolder[] | null {
  return Array.isArray(value) && value.every(isTagFolder) ? value : null;
}

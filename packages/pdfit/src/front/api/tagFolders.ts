import { uiText } from '../i18n/uiText.js';
import {
  EDIT_TAG_FOLDER_ROUTE, MOVE_TAG_FOLDER_ROUTE, TAG_FOLDERS_PATH, parseTagFolders,
  type EditTagFolderRequest, type MoveTagFolderRequest, type TagFolder,
} from '../../common/protocol/tagFolders/index.js';

export type TagFolderError = Error & { status?: number };

async function request(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(TAG_FOLDERS_PATH + url, options);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const error = new Error((data as { error?: string }).error ?? uiText('요청 실패')) as TagFolderError;
    error.status = res.status;
    throw error;
  }
  return res;
}

const tagPath = (folder: string, tag: string) => `/${encodeURIComponent(folder)}/tags/${encodeURIComponent(tag)}`;

export const tagFoldersApi = {
  async list(): Promise<TagFolder[]> {
    const response = await request('');
    const folders = parseTagFolders(await response.json());
    if (!folders) throw new Error('Invalid tag folder list.');
    return folders;
  },
  create: (name: string) => request('', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  }),
  edit: (id: string, patch: EditTagFolderRequest) => request(EDIT_TAG_FOLDER_ROUTE.path.replace(':id', encodeURIComponent(id)), {
    method: EDIT_TAG_FOLDER_ROUTE.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  }),
  move: (id: string, move: MoveTagFolderRequest) => request(MOVE_TAG_FOLDER_ROUTE.path.replace(':id', encodeURIComponent(id)), {
    method: MOVE_TAG_FOLDER_ROUTE.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(move),
  }),
  remove: (name: string) => request(`/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  addTag: (folder: string, tag: string) => request(tagPath(folder, tag), { method: 'PUT' }),
  removeTag: (folder: string, tag: string) => request(tagPath(folder, tag), { method: 'DELETE' }),
};

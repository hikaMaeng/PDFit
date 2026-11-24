import type { EditTagFolderRequest, TagFolderDirection, TagFolder } from '../../common/protocol/tagFolders/index.js';
import { tagFoldersApi } from '../api/tagFolders.js';

/**
 * 사이드바 태그 폴더. 태그는 여러 폴더에 속할 수 있다.
 *
 * - 키: 폴더 ID / 범위: 이 브라우저 탭 / 수명: 탭이 닫힐 때까지
 * - 한도: 서버가 돌려준 폴더 목록(서버 DB가 기준이며 `load()`가 통째로 교체한다)
 * - 정리: `load()`(사이드바 로드, 서버의 `tag-folders-changed` 이벤트)와 변경 실패 되돌리기가 비운다
 * - 접힘 상태(`collapsed`)는 이 모델이 아니라 사이드바가 브라우저 저장소에 둔다.
 */
const TAG_DRAG_TYPE = 'application/pdfit-tag';

export interface TagDragPayload {
  tag: string;
  /** 폴더 안의 행을 끌었다면 그 폴더. 이동이 아니라 다른 폴더에도 넣는 복사로 다룬다. */
  fromFolder?: string;
}

const EMPTY: TagFolder[] = [];
let folders: TagFolder[] = [];
let available = true;
let loaded = false;
let moving = false;
let version = 0;
let loadSerial = 0;
const listeners = new Set<() => void>();

function publish(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function replace(next: TagFolder[]): void {
  folders = next;
  publish();
}

export const tagFoldersModel = {
  dragType: TAG_DRAG_TYPE,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  getVersion(): number { return version; },
  isAvailable(): boolean { return available; },
  isLoaded(): boolean { return loaded; },
  isMoving(): boolean { return moving; },
  /** 서버에서 받은 표시 순서. */
  list(): TagFolder[] { return available ? folders : EMPTY; },
  /** 하나 이상의 폴더에 들어 있는 태그 이름 집합. 아래 일반 태그 목록에서 가리는 데 쓴다. */
  groupedTagNames(): Set<string> {
    const names = new Set<string>();
    if (available) for (const folder of folders) for (const tag of folder.tags) names.add(tag);
    return names;
  },

  async load(): Promise<void> {
    const serial = ++loadSerial;
    try {
      const rows = await tagFoldersApi.list();
      if (serial !== loadSerial) return;
      available = true;
      loaded = true;
      replace(rows);
    } catch (error) {
      if (serial !== loadSerial) return;
      if ((error as { status?: number }).status === 501) {
        if (available) { available = false; loaded = false; replace([]); }
      }
      // 그 밖의 실패(서버 재시작 등)는 마지막으로 알던 상태를 유지한다.
    }
  },

  /** 서버가 중복 이름이면 던진다(`status === 409`). */
  async create(name: string): Promise<void> {
    await tagFoldersApi.create(name);
    await this.load();
  },

  async edit(id: string, patch: EditTagFolderRequest): Promise<void> {
    await tagFoldersApi.edit(id, patch);
    await this.load();
  },

  async move(id: string, direction: TagFolderDirection): Promise<void> {
    if (moving) return;
    const index = folders.findIndex((folder) => folder.id === id);
    const neighbor = folders[index + (direction === 'up' ? -1 : 1)];
    if (index < 0 || !neighbor) return;
    moving = true;
    publish();
    try {
      await tagFoldersApi.move(id, { direction, neighborId: neighbor.id });
    } finally {
      await this.load();
      moving = false;
      publish();
    }
  },

  /** 낙관적으로 지운다. 실패하면 서버 상태로 되돌리고 던진다. */
  async remove(name: string): Promise<void> {
    replace(folders.filter((folder) => folder.name !== name));
    try { await tagFoldersApi.remove(name); } catch (error) { await this.load(); throw error; }
  },

  async addTag(folderName: string, tag: string): Promise<void> {
    const target = folders.find((folder) => folder.name === folderName);
    if (!target || target.tags.includes(tag)) return;
    replace(folders.map((folder) => folder === target ? { ...folder, tags: [...folder.tags, tag].sort() } : folder));
    try { await tagFoldersApi.addTag(folderName, tag); } catch (error) { await this.load(); throw error; }
  },

  async removeTag(folderName: string, tag: string): Promise<void> {
    replace(folders.map((folder) => folder.name === folderName ? { ...folder, tags: folder.tags.filter((name) => name !== tag) } : folder));
    try { await tagFoldersApi.removeTag(folderName, tag); } catch (error) { await this.load(); throw error; }
  },
};

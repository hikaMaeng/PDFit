import { favoritesApi } from '../api/favorites.js';

/**
 * 즐겨찾기 표시 상태. 책의 키는 `folder`와 `filename`이다.
 * 카드는 자기 책의 상태만 구독하므로 한 책을 토글해도 다른 카드는 다시 그려지지 않는다.
 *
 * - 키: `${folder}\0${filename}` / 범위: 이 브라우저 탭 / 수명: 탭이 닫힐 때까지
 * - 한도: 서버가 돌려준 즐겨찾기 수(서버 DB가 기준이며 `load()`가 통째로 교체한다)
 * - 정리: `load()`(사이드바 로드, 서버의 `favorites-changed` 이벤트)와 토글 실패 되돌리기가 비운다
 */
export type FavoriteState = 'on' | 'off' | 'unavailable';

const keys = new Set<string>();
const listeners = new Set<() => void>();
let available = true;
/** 서버에서 한 번이라도 목록을 받았는가. 받기 전의 빈 집합을 '즐겨찾기 아님'으로 읽지 않도록 한다. */
let loaded = false;
let version = 0;
/** 같은 책의 토글이 겹치면 마지막 요청만 서버 상태로 인정한다. */
const pending = new Map<string, number>();
let loadSerial = 0;

const keyOf = (folder: string, filename: string) => `${folder}\u0000${filename}`;

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export const favoritesModel = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  /** 한 책의 상태. `useSyncExternalStore`의 스냅샷으로 쓰는 원시값이라 다른 책 변화에 다시 그려지지 않는다. */
  stateOf(folder: string, filename: string): FavoriteState {
    if (!available) return 'unavailable';
    return keys.has(keyOf(folder, filename)) ? 'on' : 'off';
  },
  /** 사이드바 배지용 개수. */
  count(): number { return available ? keys.size : 0; },
  isAvailable(): boolean { return available; },
  isLoaded(): boolean { return loaded; },
  getVersion(): number { return version; },

  /** 서버의 즐겨찾기 목록으로 통째로 교체한다. 토글이 진행 중인 책은 그 낙관 상태를 유지한다. */
  async load(): Promise<void> {
    const serial = ++loadSerial;
    try {
      const rows = await favoritesApi.listKeys();
      if (serial !== loadSerial) return;
      const next = new Set(rows.map((row) => keyOf(row.folder, row.filename)));
      for (const key of pending.keys()) { if (keys.has(key)) next.add(key); else next.delete(key); }
      keys.clear();
      for (const key of next) keys.add(key);
      available = true;
      loaded = true;
      notify();
    } catch (error) {
      if ((error as { status?: number }).status === 501) {
        if (available || keys.size > 0) { available = false; keys.clear(); notify(); }
      }
      // 그 밖의 실패(서버 재시작 등)는 마지막으로 알던 상태를 유지한다.
    }
  },

  /** 낙관적으로 바꾸고 서버에 반영한다. 실패하면 되돌리고 던진다. */
  async toggle(folder: string, filename: string): Promise<boolean> {
    if (!available) return false;
    const key = keyOf(folder, filename);
    const target = !keys.has(key);
    const ticket = (pending.get(key) ?? 0) + 1;
    pending.set(key, ticket);
    if (target) keys.add(key); else keys.delete(key);
    notify();
    try {
      await favoritesApi.set(folder, filename, target);
      return target;
    } catch (error) {
      if (pending.get(key) === ticket) {
        if (target) keys.delete(key); else keys.add(key);
        notify();
      }
      throw error;
    } finally {
      if (pending.get(key) === ticket) pending.delete(key);
    }
  },
};

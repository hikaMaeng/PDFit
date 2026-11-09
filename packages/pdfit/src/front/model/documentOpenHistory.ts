type DocumentIdentity = { folder: string; filename: string; driveFileId?: string | null };
let scopeForHistory: () => string = () => 'local';
const CHANGE_EVENT = 'pdfit-document-opened';

/** 브라우저 열람 기록을 현재 로그인 계정별로 분리한다. */
export function configureDocumentOpenHistory(scope?: () => string): void {
  scopeForHistory = scope ?? (() => 'local');
}

function storageKey(): string {
  return `pdfit.opened-at.v1.${encodeURIComponent(scopeForHistory() || 'local')}`;
}

function identityKey(document: DocumentIdentity): string {
  return document.driveFileId ?? `${document.folder}\u0000${document.filename}`;
}

function readHistory(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey()) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

/** 실제 뷰어가 열리거나 기존 뷰어에 열기 명령이 전달된 시각을 기록한다. */
export function recordDocumentOpened(document: DocumentIdentity): void {
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify({ ...readHistory(), [identityKey(document)]: new Date().toISOString() }));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // see docs/internals.md#document-list-open-history
  }
}

/** 마지막 열기 시각을 조회한다. 저장 기록이 없으면 null을 반환한다. */
export function getDocumentOpenedAt(document: DocumentIdentity): string | null {
  const value = readHistory()[identityKey(document)];
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

/** 같은 화면 및 별도 뷰어 창에서 저장한 열람 시각 변경을 구독한다. */
export function subscribeDocumentOpenHistory(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === storageKey()) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** 열린 날짜 표시 규칙은 docs/internals.md#document-list-open-history를 따른다. */
export function formatDocumentOpenedDate(value: string | null, language: string, now = new Date()): string {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  if (language.startsWith('ko')) {
    const year = date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}년 `;
    return `${year}${date.getMonth() + 1}월 ${date.getDate()}일`;
  }
  return new Intl.DateTimeFormat(language, {
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' as const }),
    month: '2-digit', day: '2-digit',
  }).format(date);
}

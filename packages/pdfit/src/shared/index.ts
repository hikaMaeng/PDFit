export interface ViewerStateRecord {
  page: number;
  scale: number;
  fitMode: string;
  viewMode: string;
  inverted: boolean;
  uiHidden: boolean;
  scrollTop: number;
}

export { distinctTagColor, withDistinctTagColors } from './tagColor.js';
export { BOOKSTORE_TAG_GROUPS, BOOKSTORE_TAG_TAXONOMY, DOCUMENT_TAG_TAXONOMY, bookstoreTagGroupFor, documentTagFromTitle } from './tagTaxonomy.js';
export type { BookstoreTagGroupId } from './tagTaxonomy.js';

export type { BookmarkRecord, BookmarkRect, CreateBookmarkRequest, UpdateBookmarkRequest } from '../common/protocol/bookmarks/index.js';
export type { Annotation, CreateAnnotationRequest, UpdateAnnotationRequest } from '../common/protocol/annotations/index.js';

export interface TagSummary {
  name: string;
  bookCount: number;
  color: string;
}

export interface BookRecord {
  folder: string;
  filename: string;
  size: number;
  modified_at: string;
}

/** 인덱스 페이지가 책을 식별하고 열기 위해 필요한 최소 정보. */
export interface TagIndexBook {
  folder: string;
  filename: string;
  driveFileId?: string;
}

/** 태그 하나와 그 태그가 붙은 모든 책. 인덱스 페이지의 카드 한 장에 해당한다. */
export interface TagIndexEntry {
  name: string;
  color: string;
  books: TagIndexBook[];
}

export interface TaggedBookRecord extends BookRecord {
  tags: string[];
}

/** `books` 테이블 제목 검색 결과. `total`은 `limit`과 무관한 전체 일치 수다. */
export interface BookTitleSearchResult {
  total: number;
  books: TaggedBookRecord[];
}

export interface MetadataStore {
  /**
   * 책 제목(파일명에서 `.pdf`를 뺀 값)에 `query`가 부분 문자열로 들어 있는 책을 DB 기준으로 찾는다.
   * 대소문자와 유니코드 정규화(NFC/NFD) 차이는 무시한다. 구현하지 않는 저장소는 라우트가 501로 답한다.
   */
  searchBooksByTitle?(query: string, limit?: number): Promise<BookTitleSearchResult>;
  listTrackedBooks(): Promise<Array<{ folder: string; filename: string }>>;
  getProgress(folder: string, filename: string, driveFileId?: string): Promise<number | null>;
  setProgress(folder: string, filename: string, page: number, driveFileId?: string): Promise<void>;
  listTags(): Promise<string[]>;
  listTagSummaries(): Promise<TagSummary[]>;
  listBooksByTag(tag: string): Promise<TaggedBookRecord[]>;
  /** 모든 태그와 각 태그의 책을 한 번에 돌려준다(사이드바 "인덱스"). 구현하지 않는 저장소는 라우트가 501로 답한다. */
  listTagIndex?(): Promise<TagIndexEntry[]>;
  /** 태그가 하나도 붙지 않은 책(사이드바 "미분류"). 구현하지 않는 저장소는 라우트가 501로 답한다. */
  listUntaggedBooks?(): Promise<TaggedBookRecord[]>;
  /** `listUntaggedBooks()`의 개수만 계산한다(사이드바 배지용). */
  countUntaggedBooks?(): Promise<number>;
  listBooksByFolder(folder: string): Promise<BookRecord[]>;
  listFolderBookCounts(): Promise<Record<string, number>>;
  listFolderColors(): Promise<Record<string, string>>;
  updateFolderColor(folder: string, color: string): Promise<void>;
  syncBooks(books: BookRecord[]): Promise<void>;
  listFolderTags(folder: string): Promise<Record<string, string[]>>;
  listBookTags(folder: string, filename: string, driveFileId?: string): Promise<string[]>;
  addTag(folder: string, filename: string, tag: string, driveFileId?: string): Promise<void>;
  addTags?(relations: Array<{ folder: string; filename: string; tag: string; driveFileId?: string }>): Promise<void>;
  removeTag(folder: string, filename: string, tag: string, driveFileId?: string): Promise<void>;
  removeFolderTags?(folder: string): Promise<number>;
  deleteTag(tag: string): Promise<void>;
  deleteAllTags(): Promise<void>;
  updateTagColor(tag: string, color: string): Promise<void>;
  getViewerState(folder: string, filename: string, driveFileId?: string): Promise<ViewerStateRecord | null>;
  setViewerState(folder: string, filename: string, state: ViewerStateRecord, driveFileId?: string): Promise<void>;
  purgeFile(folder: string, filename: string): Promise<void>;
  purgeFolder(folder: string): Promise<void>;
  purgeOrphanTags(): Promise<void>;
  listAllBookmarks(): Promise<import('../common/protocol/bookmarks/index.js').BookmarkRecord[]>;
  listBookmarks(folder: string, filename: string, driveFileId?: string): Promise<import('../common/protocol/bookmarks/index.js').BookmarkRecord[]>;
  createBookmark(folder: string, filename: string, bookmark: import('../common/protocol/bookmarks/index.js').CreateBookmarkRequest, driveFileId?: string): Promise<import('../common/protocol/bookmarks/index.js').BookmarkRecord>;
  updateBookmark(id: string, update: import('../common/protocol/bookmarks/index.js').UpdateBookmarkRequest): Promise<import('../common/protocol/bookmarks/index.js').BookmarkRecord | null>;
  deleteBookmark(id: string): Promise<void>;
  /** Clip OCR (local runtime). Optional: a store without them keeps clips without text. */
  getBookmark?(id: string): Promise<import('../common/protocol/bookmarks/index.js').BookmarkRecord | null>;
  listBookmarksWithOcrStatus?(status: import('../common/protocol/bookmarks/index.js').BookmarkOcr['status'], limit: number): Promise<import('../common/protocol/bookmarks/index.js').BookmarkRecord[]>;
  setBookmarkOcr?(id: string, ocr: Omit<import('../common/protocol/bookmarks/index.js').BookmarkOcr, 'updatedAt'>): Promise<boolean>;
  listAnnotations(documentId: string): Promise<import('../common/protocol/annotations/index.js').Annotation[]>;
  createAnnotation(annotation: import('../common/protocol/annotations/index.js').CreateAnnotationRequest): Promise<import('../common/protocol/annotations/index.js').Annotation>;
  updateAnnotation(id: string, update: import('../common/protocol/annotations/index.js').UpdateAnnotationRequest): Promise<import('../common/protocol/annotations/index.js').Annotation | null>;
  deleteAnnotation(id: string): Promise<void>;
}

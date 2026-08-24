export interface ViewerStateRecord {
  page: number;
  scale: number;
  fitMode: string;
  viewMode: string;
  inverted: boolean;
  uiHidden: boolean;
  scrollTop: number;
}

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

export interface TaggedBookRecord extends BookRecord {
  tags: string[];
}

export interface MetadataStore {
  listTrackedBooks(): Promise<Array<{ folder: string; filename: string }>>;
  getProgress(folder: string, filename: string, driveFileId?: string): Promise<number | null>;
  setProgress(folder: string, filename: string, page: number, driveFileId?: string): Promise<void>;
  listTags(): Promise<string[]>;
  listTagSummaries(): Promise<TagSummary[]>;
  listBooksByTag(tag: string): Promise<TaggedBookRecord[]>;
  listBooksByFolder(folder: string): Promise<BookRecord[]>;
  listFolderBookCounts(): Promise<Record<string, number>>;
  listFolderColors(): Promise<Record<string, string>>;
  updateFolderColor(folder: string, color: string): Promise<void>;
  syncBooks(books: BookRecord[]): Promise<void>;
  listFolderTags(folder: string): Promise<Record<string, string[]>>;
  listBookTags(folder: string, filename: string, driveFileId?: string): Promise<string[]>;
  addTag(folder: string, filename: string, tag: string, driveFileId?: string): Promise<void>;
  removeTag(folder: string, filename: string, tag: string, driveFileId?: string): Promise<void>;
  deleteTag(tag: string): Promise<void>;
  updateTagColor(tag: string, color: string): Promise<void>;
  getViewerState(folder: string, filename: string, driveFileId?: string): Promise<ViewerStateRecord | null>;
  setViewerState(folder: string, filename: string, state: ViewerStateRecord, driveFileId?: string): Promise<void>;
  purgeFile(folder: string, filename: string): Promise<void>;
  purgeFolder(folder: string): Promise<void>;
  purgeOrphanTags(): Promise<void>;
  listAllBookmarks(): Promise<import('../common/protocol/bookmarks/index.js').BookmarkRecord[]>;
  listBookmarks(folder: string, filename: string): Promise<import('../common/protocol/bookmarks/index.js').BookmarkRecord[]>;
  createBookmark(folder: string, filename: string, bookmark: import('../common/protocol/bookmarks/index.js').CreateBookmarkRequest): Promise<import('../common/protocol/bookmarks/index.js').BookmarkRecord>;
  updateBookmark(id: string, update: import('../common/protocol/bookmarks/index.js').UpdateBookmarkRequest): Promise<import('../common/protocol/bookmarks/index.js').BookmarkRecord | null>;
  deleteBookmark(id: string): Promise<void>;
  listAnnotations(documentId: string): Promise<import('../common/protocol/annotations/index.js').Annotation[]>;
  createAnnotation(annotation: import('../common/protocol/annotations/index.js').CreateAnnotationRequest): Promise<import('../common/protocol/annotations/index.js').Annotation>;
  updateAnnotation(id: string, update: import('../common/protocol/annotations/index.js').UpdateAnnotationRequest): Promise<import('../common/protocol/annotations/index.js').Annotation | null>;
  deleteAnnotation(id: string): Promise<void>;
}

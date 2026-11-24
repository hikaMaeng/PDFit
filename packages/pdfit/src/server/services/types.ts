export interface FolderInfo {
  name: string;
  pdfCount: number;
  createdAt: string;
  isRoot: boolean;
  color: string;
  driveFolderId?: string;
  parentFolderId?: string;
}

export interface PdfInfo {
  name: string;
  size: number;
  modifiedAt: string;
  driveFileId?: string;
}

export interface FilesystemService {
  booksRoot: string;
  rootFolderName: string;
  /** Guard for every disk access to the library volume; see `libraryVolume.ts`. */
  volume: import('./libraryVolume.js').LibraryVolumeGuard;
  /** Starts creating the root in the background; never waits for the volume. */
  ensureBooksRoot(): void;
  isRootFolder(name: string): boolean;
  getFolderPath(folder: string): string;
  getFilePath(folder: string, filename: string): string;
  /** Child folder names on disk. Rejects with `LibraryOfflineError` when the volume is unreachable. */
  listChildFolderNames(): Promise<string[]>;
  listFolders(): Promise<FolderInfo[]>;
  listPdfs(folder: string): Promise<PdfInfo[]>;
  createFolder(name: string): Promise<void>;
  deleteFolder(name: string): Promise<void>;
  renameFolder(oldName: string, newName: string): Promise<void>;
  deleteFile(folder: string, filename: string): Promise<void>;
  moveFile(fromFolder: string, toFolder: string, filename: string): Promise<void>;
  relocateFile(fromFolder: string, filename: string, toFolder: string, newName: string): Promise<PdfInfo>;
}

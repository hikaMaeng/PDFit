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
  ensureBooksRoot(): void;
  isRootFolder(name: string): boolean;
  getFolderPath(folder: string): string;
  getFilePath(folder: string, filename: string): string;
  listFolderShells(): FolderInfo[];
  listFolders(): FolderInfo[];
  listPdfs(folder: string): PdfInfo[];
  createFolder(name: string): void;
  deleteFolder(name: string): void;
  renameFolder(oldName: string, newName: string): void;
  deleteFile(folder: string, filename: string): void;
  moveFile(fromFolder: string, toFolder: string, filename: string): void;
}

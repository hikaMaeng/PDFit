import fs from 'node:fs';
import path from 'node:path';
import { createLibraryVolumeGuard, type LibraryVolumeGuard } from './libraryVolume.js';
import type { FilesystemService, FolderInfo, PdfInfo } from './types.js';

export function sanitizeName(name: string): string {
  return path.basename(name).replace(/[/\?%*:|"<>]/g, '_');
}

const exists = (target: string) => fs.promises.access(target).then(() => true, (error: NodeJS.ErrnoException) => {
  if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
  throw error;
});

export function createFilesystemService(booksRoot: string, rootFolderName = path.basename(booksRoot), volume: LibraryVolumeGuard = createLibraryVolumeGuard()): FilesystemService {
  const normalizedRootFolderName = sanitizeName(rootFolderName.trim()) || 'Library';
  /** Every disk access below goes through the volume guard; nothing here blocks the event loop. */
  const disk = <T>(operation: () => Promise<T>) => volume.run(operation);

  function ensureBooksRoot(): void {
    // Boot must not wait for the volume; an unreachable root is created or found later.
    void disk(() => fs.promises.mkdir(booksRoot, { recursive: true })).catch(() => undefined);
  }

  function getFolderPath(folder: string): string {
    return folder === normalizedRootFolderName ? booksRoot : path.join(booksRoot, sanitizeName(folder));
  }

  function getFilePath(folder: string, filename: string): string {
    return path.join(getFolderPath(folder), filename);
  }

  async function listPdfsInDir(dir: string): Promise<PdfInfo[]> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const pdfs: PdfInfo[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) continue;
      const stat = await fs.promises.stat(path.join(dir, entry.name));
      pdfs.push({ name: entry.name, size: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
    return pdfs.sort((left, right) => left.name.localeCompare(right.name, 'ko'));
  }

  return {
    booksRoot,
    rootFolderName: normalizedRootFolderName,
    volume,
    ensureBooksRoot,
    isRootFolder(name: string): boolean {
      return name === normalizedRootFolderName;
    },
    getFolderPath,
    getFilePath,
    listChildFolderNames: () => disk(async () => {
      const entries = await fs.promises.readdir(booksRoot, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    }),
    listFolders: () => disk(async () => {
      await fs.promises.mkdir(booksRoot, { recursive: true });
      const rootStat = await fs.promises.stat(booksRoot);
      const rootFolder: FolderInfo = {
        name: normalizedRootFolderName,
        pdfCount: (await listPdfsInDir(booksRoot)).length,
        createdAt: rootStat.birthtime.toISOString(),
        isRoot: true,
        color: '#3b82f6',
      };
      const childFolders: FolderInfo[] = [];
      for (const entry of await fs.promises.readdir(booksRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const folderPath = path.join(booksRoot, entry.name);
        const pdfs = await listPdfsInDir(folderPath);
        const stat = await fs.promises.stat(folderPath);
        childFolders.push({ name: entry.name, pdfCount: pdfs.length, createdAt: stat.birthtime.toISOString(), isRoot: false, color: '#3b82f6' });
      }
      childFolders.sort((left, right) => left.name.localeCompare(right.name, 'ko'));
      return [rootFolder, ...childFolders];
    }),
    listPdfs: (folder: string) => disk(async () => {
      const dir = getFolderPath(folder);
      if (!(await exists(dir))) throw new Error('Folder does not exist.');
      return listPdfsInDir(dir);
    }),
    createFolder: (name: string) => disk(async () => {
      const safeName = sanitizeName(name);
      if (safeName === normalizedRootFolderName) throw new Error('The library root cannot be recreated.');
      const target = getFolderPath(safeName);
      if (await exists(target)) throw new Error('Folder already exists.');
      await fs.promises.mkdir(target, { recursive: true });
    }),
    deleteFolder: (name: string) => disk(async () => {
      if (name === normalizedRootFolderName) throw new Error('The library root cannot be deleted.');
      const target = getFolderPath(name);
      if (!(await exists(target))) throw new Error('Folder does not exist.');
      await fs.promises.rm(target, { recursive: true, force: true });
    }),
    renameFolder: (oldName: string, newName: string) => disk(async () => {
      if (oldName === normalizedRootFolderName || newName === normalizedRootFolderName) throw new Error('The library root cannot be renamed.');
      const from = getFolderPath(oldName);
      const to = getFolderPath(newName);
      if (!(await exists(from))) throw new Error('Source folder does not exist.');
      if (await exists(to)) throw new Error('Destination folder already exists.');
      await fs.promises.rename(from, to);
    }),
    deleteFile: (folder: string, filename: string) => disk(async () => {
      const target = getFilePath(folder, filename);
      if (!(await exists(target))) throw new Error('File does not exist.');
      await fs.promises.rm(target);
    }),
    moveFile: (fromFolder: string, toFolder: string, filename: string) => disk(async () => {
      const src = getFilePath(fromFolder, filename);
      const destDir = getFolderPath(toFolder);
      const dest = path.join(destDir, filename);
      if (!(await exists(src))) throw new Error('Source file does not exist.');
      if (!(await exists(destDir))) throw new Error('Destination folder does not exist.');
      if (await exists(dest)) throw new Error('Destination file already exists.');
      await fs.promises.rename(src, dest);
    }),
  };
}

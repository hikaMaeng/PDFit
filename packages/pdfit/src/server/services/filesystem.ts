import fs from 'node:fs';
import path from 'node:path';
import type { FilesystemService, FolderInfo, PdfInfo } from './types.js';

export function sanitizeName(name: string): string {
  return path.basename(name).replace(/[/\\?%*:|"<>]/g, '_');
}

export function createFilesystemService(booksRoot: string, rootFolderName = path.basename(booksRoot)): FilesystemService {
  const normalizedRootFolderName = sanitizeName(rootFolderName.trim()) || 'Library';

  function ensureBooksRoot(): void {
    if (!fs.existsSync(booksRoot)) {
      fs.mkdirSync(booksRoot, { recursive: true });
    }
  }

  function getFolderPath(folder: string): string {
    return folder === normalizedRootFolderName ? booksRoot : path.join(booksRoot, sanitizeName(folder));
  }

  function getFilePath(folder: string, filename: string): string {
    return path.join(getFolderPath(folder), filename);
  }

  function listPdfsInDir(dir: string): PdfInfo[] {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
      .map((entry) => {
        const filePath = path.join(dir, entry.name);
        const stat = fs.statSync(filePath);
        return {
          name: entry.name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'ko'));
  }

  function listFolderShells(): FolderInfo[] {
    ensureBooksRoot();
    const root = {
      name: normalizedRootFolderName,
      pdfCount: 0,
      // The regular folder-list path intentionally avoids stat calls. The
      // UI does not use createdAt; the explicit refresh path still returns
      // the detailed filesystem-backed folder metadata.
      createdAt: '',
      isRoot: true,
      color: '#3b82f6',
    };
    const childFolders = fs
      .readdirSync(booksRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        pdfCount: 0,
        createdAt: '',
        isRoot: false,
        color: '#3b82f6',
      }));
    return [root, ...childFolders];
  }

  return {
    booksRoot,
    rootFolderName: normalizedRootFolderName,
    ensureBooksRoot,
    isRootFolder(name: string): boolean {
      return name === normalizedRootFolderName;
    },
    getFolderPath,
    getFilePath,
    listFolderShells,
    listFolders(): FolderInfo[] {
      ensureBooksRoot();
      const rootStat = fs.statSync(booksRoot);
      const rootFolder: FolderInfo = {
        name: normalizedRootFolderName,
        pdfCount: listPdfsInDir(booksRoot).length,
        createdAt: rootStat.birthtime.toISOString(),
        isRoot: true,
        color: '#3b82f6',
      };
      const childFolders = fs
        .readdirSync(booksRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
          const folderPath = path.join(booksRoot, entry.name);
          const pdfs = listPdfsInDir(folderPath);
          const stat = fs.statSync(folderPath);
          return {
            name: entry.name,
            pdfCount: pdfs.length,
            createdAt: stat.birthtime.toISOString(),
            isRoot: false,
            color: '#3b82f6',
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name, 'ko'));
      return [rootFolder, ...childFolders];
    },
    listPdfs(folder: string): PdfInfo[] {
      const dir = getFolderPath(folder);
      if (!fs.existsSync(dir)) {
        throw new Error('Folder does not exist.');
      }
      return listPdfsInDir(dir);
    },
    createFolder(name: string): void {
      const safeName = sanitizeName(name);
      if (safeName === normalizedRootFolderName) {
        throw new Error('The library root cannot be recreated.');
      }
      const target = getFolderPath(safeName);
      if (fs.existsSync(target)) {
        throw new Error('Folder already exists.');
      }
      fs.mkdirSync(target, { recursive: true });
    },
    deleteFolder(name: string): void {
      if (name === normalizedRootFolderName) {
        throw new Error('The library root cannot be deleted.');
      }
      const target = getFolderPath(name);
      if (!fs.existsSync(target)) {
        throw new Error('Folder does not exist.');
      }
      fs.rmSync(target, { recursive: true, force: true });
    },
    renameFolder(oldName: string, newName: string): void {
      if (oldName === normalizedRootFolderName || newName === normalizedRootFolderName) {
        throw new Error('The library root cannot be renamed.');
      }
      const from = getFolderPath(oldName);
      const to = getFolderPath(newName);
      if (!fs.existsSync(from)) {
        throw new Error('Source folder does not exist.');
      }
      if (fs.existsSync(to)) {
        throw new Error('Destination folder already exists.');
      }
      fs.renameSync(from, to);
    },
    deleteFile(folder: string, filename: string): void {
      const target = getFilePath(folder, filename);
      if (!fs.existsSync(target)) {
        throw new Error('File does not exist.');
      }
      fs.rmSync(target);
    },
    moveFile(fromFolder: string, toFolder: string, filename: string): void {
      const src = getFilePath(fromFolder, filename);
      const destDir = getFolderPath(toFolder);
      const dest = path.join(destDir, filename);
      if (!fs.existsSync(src)) {
        throw new Error('Source file does not exist.');
      }
      if (!fs.existsSync(destDir)) {
        throw new Error('Destination folder does not exist.');
      }
      if (fs.existsSync(dest)) {
        throw new Error('Destination file already exists.');
      }
      fs.renameSync(src, dest);
    },
  };
}

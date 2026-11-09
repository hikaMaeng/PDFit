import { uiText } from '../i18n/uiText.js';
import type { FolderInfo, PdfInfo } from '../api/folders.js';
import { foldersApi } from '../api/folders.js';
import { tagsApi } from '../api/tags.js';
import { subscribeLibraryFileMutations } from './libraryMutationEvents.js';

export interface FolderLibraryState {
  files: PdfInfo[];
  fileTags: Record<string, string[]>;
  isRootFolder: boolean;
  loading: boolean;
  error: string | null;
  filesLoaded: boolean;
  tagsLoaded: boolean;
}

export function fileIdentity(filename: string, driveFileId?: string): string {
  return driveFileId || filename;
}

type Listener = () => void;

class FolderModel {
  private version = 0;
  private readonly listeners = new Set<Listener>();
  private filesRequest: Promise<void> | null = null;
  private tagsRequest: Promise<void> | null = null;

  readonly state: FolderLibraryState = {
    files: [],
    fileTags: {},
    isRootFolder: false,
    loading: false,
    error: null,
    filesLoaded: false,
    tagsLoaded: false,
  };

  private hasFileSnapshot = false;

  constructor(readonly folderName: string) {}

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  async ensure(): Promise<void> {
    if (!this.state.filesLoaded && !this.filesRequest) {
      this.filesRequest = this.loadFiles();
    }
    if (this.state.filesLoaded && !this.state.tagsLoaded && !this.tagsRequest) {
      this.tagsRequest = this.loadTags();
    }
    await this.filesRequest;
  }

  async refresh(): Promise<void> {
    this.state.filesLoaded = false;
    this.state.tagsLoaded = false;
    this.state.error = null;
    this.emit();
    await this.ensure();
  }

  invalidateFiles(): void {
    this.state.filesLoaded = false;
    this.state.tagsLoaded = false;
    this.emit();
  }

  invalidateTags(): void {
    this.state.tagsLoaded = false;
    this.emit();
  }

  removeFile(filename: string, driveFileId?: string): void {
    const identity = fileIdentity(filename, driveFileId);
    this.state.files = this.state.files.filter((file) => fileIdentity(file.name, file.driveFileId) !== identity);
    delete this.state.fileTags[identity];
    this.emit();
  }

  upsertFile(file: PdfInfo): void {
    const identity = fileIdentity(file.name, file.driveFileId);
    this.state.files = [...this.state.files.filter((current) => fileIdentity(current.name, current.driveFileId) !== identity), file];
    this.emit();
  }

  addTag(filename: string, tag: string, driveFileId?: string): void {
    const identity = fileIdentity(filename, driveFileId);
    const current = this.state.fileTags[identity] ?? [];
    if (current.includes(tag)) return;
    this.state.fileTags[identity] = [...current, tag];
    this.emit();
  }

  removeTag(filename: string, tag: string, driveFileId?: string): void {
    const identity = fileIdentity(filename, driveFileId);
    const current = this.state.fileTags[identity] ?? [];
    this.state.fileTags[identity] = current.filter((item) => item !== tag);
    this.emit();
  }

  private async loadFiles(): Promise<void> {
    this.state.loading = !this.hasFileSnapshot;
    this.state.error = null;
    this.emit();
    try {
      this.state.files = await foldersApi.listFiles(this.folderName);
      this.state.filesLoaded = true;
      this.hasFileSnapshot = true;
      this.state.loading = false;
      this.emit();
      if (!this.state.tagsLoaded && !this.tagsRequest) {
        this.tagsRequest = this.loadTags();
      }
    } catch (error) {
      this.state.loading = false;
      this.state.error = error instanceof Error ? error.message : uiText("로드 실패");
      this.emit();
    } finally {
      this.filesRequest = null;
    }
  }

  private async loadTags(): Promise<void> {
    try {
      const [tagMap, folders] = await Promise.all([
        tagsApi.listForFolder(this.folderName),
        foldersApi.list(),
      ]);
      this.state.fileTags = tagMap;
      this.state.isRootFolder = folders.some((folder: FolderInfo) => folder.name === this.folderName && folder.isRoot);
      this.state.tagsLoaded = true;
      this.emit();
    } finally {
      this.tagsRequest = null;
    }
  }
}

class FolderLibraryModel {
  private readonly folders = new Map<string, FolderModel>();

  constructor() {
    subscribeLibraryFileMutations((mutation) => {
      const model = this.folders.get(mutation.folder);
      if (!model) return;
      if (mutation.kind === 'remove') model.removeFile(mutation.filename, mutation.driveFileId);
      else model.upsertFile(mutation.file);
    });
  }

  get(folderName: string): FolderModel {
    let model = this.folders.get(folderName);
    if (!model) {
      model = new FolderModel(folderName);
      this.folders.set(folderName, model);
    }
    return model;
  }

  invalidateFiles(folderNames?: Iterable<string>): void {
    if (folderNames) {
      for (const folderName of folderNames) this.folders.get(folderName)?.invalidateFiles();
      return;
    }
    for (const model of this.folders.values()) model.invalidateFiles();
  }

  invalidateTags(folderNames?: Iterable<string>): void {
    if (folderNames) {
      for (const folderName of folderNames) this.folders.get(folderName)?.invalidateTags();
      return;
    }
    for (const model of this.folders.values()) model.invalidateTags();
  }

  drop(folderName: string): void {
    this.folders.delete(folderName);
  }
}

export const folderLibraryModel = new FolderLibraryModel();

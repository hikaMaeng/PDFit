import type { RenamedPdf } from '../common/protocol/file-rename/index.js';

export interface LibraryFileRef {
  folder: string;
  filename: string;
}

export interface LibraryFileOperation {
  id: string;
  source: LibraryFileRef;
  destination: LibraryFileRef | null;
  size: number;
  modifiedAt: string;
  lastError?: string;
}

export type LibraryFileOperationResult =
  | { status: 'applied' | 'restore' }
  | { status: 'source-changed'; size: number; modifiedAt: string };

export interface LibraryFileOperationStore {
  list(): Promise<LibraryFileOperation[]>;
  findDestination(ref: LibraryFileRef): Promise<LibraryFileOperation | undefined>;
  enqueue(source: LibraryFileRef, destination: LibraryFileRef | null): Promise<{ operation: LibraryFileOperation | null; file?: RenamedPdf }>;
  finish(operation: LibraryFileOperation, outcome: LibraryFileOperationResult): Promise<void>;
  fail(id: string, message: string): Promise<void>;
}

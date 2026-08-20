import type { PdfInfo } from '../api/folders.js';

export type LibraryFileMutation =
  | { kind: 'upsert'; folder: string; file: PdfInfo }
  | { kind: 'remove'; folder: string; filename: string };

const listeners = new Set<(mutation: LibraryFileMutation) => void>();

export function publishLibraryFileMutation(mutation: LibraryFileMutation): void {
  listeners.forEach((listener) => listener(mutation));
}

export function subscribeLibraryFileMutations(listener: (mutation: LibraryFileMutation) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

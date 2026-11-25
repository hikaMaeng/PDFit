import { execFile } from 'node:child_process';
import type { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { defineTask } from '../tasks/taskProtocol.js';
import type { LibraryFileOperationResult } from '../../shared/libraryFileOperations.js';

export interface LibraryDiskOperation {
  source: string;
  destination: string | null;
  staging: string;
  size: number;
  modifiedAt: string;
}

const exec = promisify(execFile);
const codeOf = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;

function stat(file: string): Promise<Stats | null> {
  return fs.lstat(file).catch((error: unknown) => {
    if (codeOf(error) === 'ENOENT') return null;
    throw error;
  });
}

function expected(entry: Stats | null, operation: LibraryDiskOperation): boolean {
  return entry?.isFile() === true && entry.size === operation.size && entry.mtime.getTime() === Date.parse(operation.modifiedAt);
}

function changed(entry: Stats): LibraryFileOperationResult {
  if (!entry.isFile()) throw new Error('The original path no longer contains a regular file.');
  return { status: 'source-changed', size: entry.size, modifiedAt: entry.mtime.toISOString() };
}

/** Publish without replacing a file written by an external SMB client. */
async function moveExclusive(source: string, destination: string): Promise<boolean> {
  if (process.platform === 'linux') {
    await exec('mv', ['--no-clobber', '--no-target-directory', '--', source, destination]);
    return !(await stat(source));
  }
  try { await fs.link(source, destination); }
  catch (error) { if (codeOf(error) === 'EEXIST') return false; throw error; }
  await fs.unlink(source);
  return true;
}

const sameFile = (left: Stats, right: Stats) => left.ino !== 0 && left.ino === right.ino && left.dev === right.dev;

export default defineTask<LibraryDiskOperation, LibraryFileOperationResult>({
  async run(operation) {
    const { source, destination, staging } = operation;
    let held = await stat(staging);
    if (!held) {
      let original = await stat(source);
      let target = destination && await stat(destination);
      if (destination && path.dirname(source) === path.dirname(destination) && source.toLowerCase() === destination.toLowerCase()) {
        const names = await fs.readdir(path.dirname(source));
        if (!names.includes(path.basename(source))) original = null;
        if (!names.includes(path.basename(destination))) target = null;
      }
      if (!original) {
        if (!destination || expected(target || null, operation)) return { status: 'applied' };
        throw new Error('The PDF is missing at both the original and destination paths.');
      }
      if (!expected(original, operation)) return changed(original);
      if (target || (destination && !(await stat(path.dirname(destination)))?.isDirectory())) return { status: 'restore' };
      if (!await moveExclusive(source, staging)) throw new Error('The staging path is already in use.');
      held = await stat(staging);
    }

    if (!held) throw new Error('The staged PDF is missing.');
    if (!expected(held, operation)) {
      if (!held.isFile() || !await moveExclusive(staging, source)) throw new Error('The staged file does not match the indexed PDF.');
      return changed(held);
    }
    // On platforms using a link followed by unlink, a process exit may leave both names.
    const original = await stat(source);
    if (original && sameFile(original, held)) await fs.unlink(source);
    if (!destination) {
      await fs.unlink(staging);
      return { status: 'applied' };
    }

    const target = await stat(destination);
    if (target && sameFile(target, held)) {
      await fs.unlink(staging);
      return { status: 'applied' };
    }
    if (!target && (await stat(path.dirname(destination)))?.isDirectory() && await moveExclusive(staging, destination)) return { status: 'applied' };
    if (await moveExclusive(staging, source)) return { status: 'restore' };
    throw new Error('Both the original and destination paths are occupied; the PDF remains staged.');
  },
});

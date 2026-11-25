import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { RenamedPdf } from '../../common/protocol/file-rename/index.js';
import type { LibraryFileOperation, LibraryFileOperationStore, LibraryFileRef } from '../../shared/libraryFileOperations.js';
import { titleChoseong } from '../../shared/choseong.js';
import { LibraryFileOperationError, touches } from '../services/libraryFileOperations.js';

export const libraryFileOperationsSchema = `
  CREATE TABLE IF NOT EXISTS library_file_operations (
    id UUID PRIMARY KEY,
    source_folder TEXT NOT NULL,
    source_filename TEXT NOT NULL,
    destination_folder TEXT,
    destination_filename TEXT,
    size BIGINT NOT NULL,
    modified_at TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT,
    CHECK ((destination_folder IS NULL) = (destination_filename IS NULL))
  );
  CREATE INDEX IF NOT EXISTS library_file_operations_destination ON library_file_operations (destination_folder, destination_filename);
`;

type Projection = {
  relocate(client: PoolClient, source: LibraryFileRef, folder: string, file: RenamedPdf): Promise<RenamedPdf>;
  purge(client: PoolClient, source: LibraryFileRef): Promise<void>;
};

function fromRow(row: Record<string, unknown>): LibraryFileOperation {
  return {
    id: String(row.id),
    source: { folder: String(row.source_folder), filename: String(row.source_filename) },
    destination: row.destination_folder === null ? null : { folder: String(row.destination_folder), filename: String(row.destination_filename) },
    size: Number(row.size), modifiedAt: String(row.modified_at),
    lastError: typeof row.last_error === 'string' ? row.last_error : undefined,
  };
}

async function list(client: Pool | PoolClient): Promise<LibraryFileOperation[]> {
  const { rows } = await client.query('SELECT * FROM library_file_operations ORDER BY created_at, id');
  return rows.map(fromRow);
}

async function book(client: PoolClient, ref: LibraryFileRef): Promise<RenamedPdf | undefined> {
  const { rows: [row] } = await client.query(`
    SELECT size, modified_at, clip_count, clip_count_revision FROM books WHERE (folder, filename) = ($1, $2)
  `, [ref.folder, ref.filename]);
  return row && {
    name: ref.filename, size: Number(row.size), modifiedAt: row.modified_at,
    clipCount: Number(row.clip_count), clipCountRevision: Number(row.clip_count_revision),
  };
}

const samePath = (left: LibraryFileRef, right: LibraryFileRef) => left.folder === right.folder && left.filename === right.filename;

export function createPostgresLibraryFileOperations(db: Pool, projection: Projection): LibraryFileOperationStore {
  async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE library_file_operations IN SHARE ROW EXCLUSIVE MODE');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    list: () => list(db),
    async findDestination({ folder, filename }) {
      const { rows: [row] } = await db.query(`
        SELECT * FROM library_file_operations WHERE (destination_folder, destination_filename) = ($1, $2)
      `, [folder, filename]);
      return row ? fromRow(row) : undefined;
    },
    enqueue: (source, destination) => transaction(async (client) => {
      const pending = await list(client);
      const repeated = pending.find((operation) => samePath(operation.source, source) && (
        destination ? operation.destination && samePath(operation.destination, destination) : operation.destination === null));
      if (repeated) return { operation: repeated, file: destination ? await book(client, destination) : undefined };
      if (pending.some((operation) => touches(operation, source) || (destination && touches(operation, destination)))) {
        throw new LibraryFileOperationError(409, 'A pending file operation is using this path.');
      }
      const current = await book(client, source);
      if (!current) {
        if (!destination) return { operation: null };
        throw new LibraryFileOperationError(404, 'The source PDF is not indexed.');
      }
      if (destination && samePath(source, destination)) return { operation: null, file: current };
      if (destination && await book(client, destination)) throw new LibraryFileOperationError(409, 'Destination file already exists.');

      const operation = { id: randomUUID(), source, destination, size: current.size, modifiedAt: current.modifiedAt };
      await client.query(`
        INSERT INTO library_file_operations (id, source_folder, source_filename, destination_folder, destination_filename, size, modified_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [operation.id, source.folder, source.filename, destination?.folder, destination?.filename, operation.size, operation.modifiedAt]);
      if (destination) {
        const file = await projection.relocate(client, source, destination.folder, { ...current, name: destination.filename });
        return { operation, file };
      }
      await projection.purge(client, source);
      return { operation };
    }),
    finish: (operation, outcome) => transaction(async (client) => {
      const result = await client.query('DELETE FROM library_file_operations WHERE id = $1', [operation.id]);
      if (!result.rowCount || outcome.status === 'applied') return;
      const source = operation.source;
      if (operation.destination) {
        const current = await book(client, operation.destination);
        if (!current) throw new Error('The pending destination row is missing.');
        const metadata = outcome.status === 'source-changed' ? outcome : current;
        await projection.relocate(client, operation.destination, source.folder, {
          name: source.filename, size: metadata.size, modifiedAt: metadata.modifiedAt,
        });
      } else if (outcome.status === 'source-changed') {
        await client.query(`
          INSERT INTO books (folder, filename, size, modified_at, title_choseong) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (folder, filename) DO UPDATE SET size = EXCLUDED.size, modified_at = EXCLUDED.modified_at
        `, [source.folder, source.filename, outcome.size, outcome.modifiedAt, titleChoseong(source.filename)]);
      }
    }),
    fail: async (id, message) => { await db.query('UPDATE library_file_operations SET last_error = $2 WHERE id = $1', [id, message.slice(0, 1000)]); },
  };
}

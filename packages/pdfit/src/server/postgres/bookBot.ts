import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import type { BookBotBook, BookBotSession, BookBotSessionSummary, BookBotTurn } from '../../common/protocol/book-bot/index.js';
import type { MetadataStore } from '../../shared/index.js';
import { bookTitleFromFilename } from '../services/tagSuggestion.js';
import type { BookBotStore } from '../book-bot/types.js';

// See docs/book-bot.md#storage.
export const bookBotSchema = `
  CREATE TABLE IF NOT EXISTS book_bot_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder TEXT NOT NULL,
    filename TEXT NOT NULL,
    title TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    turns JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(turns) = 'array'),
    FOREIGN KEY (folder, filename) REFERENCES books (folder, filename) ON UPDATE CASCADE ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_book_bot_sessions_latest
    ON book_bot_sessions (folder, filename, created_at DESC, id DESC);
  CREATE TABLE IF NOT EXISTS book_bot_clip_descriptions (
    clip_id UUID PRIMARY KEY REFERENCES bookmarks (id) ON DELETE CASCADE,
    model_key TEXT NOT NULL,
    body TEXT NOT NULL
  );
`;

type SessionRow = { id: string; title: string | null; created_at: Date; turns: BookBotTurn[] };
const columns = 'id, title, created_at';

function summary(row: SessionRow): BookBotSessionSummary {
  return { id: row.id, title: row.title, createdAt: row.created_at.toISOString() };
}

function session(row?: SessionRow): BookBotSession | null {
  return row ? { ...summary(row), turns: row.turns } : null;
}

export function createPostgresBookBot(db: Pool, metadata: MetadataStore, bookmarkAssetRoot: string): BookBotStore {
  return {
    async list({ folder, filename }) {
      const { rows } = await db.query<SessionRow>(`
        SELECT ${columns} FROM book_bot_sessions
        WHERE (folder, filename) = ($1, $2) ORDER BY created_at DESC, id DESC
      `, [folder, filename]);
      return rows.map(summary);
    },
    async get({ folder, filename }, id) {
      const { rows } = await db.query<SessionRow>(`
        SELECT ${columns}, turns FROM book_bot_sessions
        WHERE (folder, filename) = ($1, $2) AND ($3::uuid IS NULL OR id = $3)
        ORDER BY created_at DESC, id DESC LIMIT 1
      `, [folder, filename, id ?? null]);
      return session(rows[0]);
    },
    async create({ folder, filename }, id) {
      const { rows } = await db.query<SessionRow>(`
        INSERT INTO book_bot_sessions AS existing (id, folder, filename)
        SELECT $3, folder, filename FROM books WHERE (folder, filename) = ($1, $2)
        ON CONFLICT (id) DO UPDATE SET id = existing.id
        WHERE (existing.folder, existing.filename) = (EXCLUDED.folder, EXCLUDED.filename)
        RETURNING ${columns}, turns
      `, [folder, filename, id]);
      return session(rows[0]);
    },
    async saveTurn({ folder, filename }, sessionId, revision, turn, title) {
      const turns = JSON.stringify([turn]);
      const { rows } = sessionId === null
        ? await db.query<SessionRow>(`
          INSERT INTO book_bot_sessions (id, folder, filename, title, turns)
          SELECT $3, folder, filename, $4, $5::jsonb FROM books WHERE (folder, filename) = ($1, $2)
          ON CONFLICT (id) DO NOTHING RETURNING ${columns}, turns
        `, [folder, filename, turn.id, title, turns])
        : await db.query<SessionRow>(`
          UPDATE book_bot_sessions SET turns = turns || $4::jsonb, title = COALESCE(title, $5)
          WHERE (folder, filename) = ($1, $2) AND id = $3
            AND jsonb_array_length(turns) = $6 AND NOT turns @> $7::jsonb
          RETURNING ${columns}, turns
        `, [folder, filename, sessionId, turns, title, revision, JSON.stringify([{ id: turn.id }])]);
      return session(rows[0]);
    },
    async source({ folder, filename }: BookBotBook) {
      const book = await db.query('SELECT 1 FROM books WHERE (folder, filename) = ($1, $2)', [folder, filename]);
      if (!book.rowCount) return null;
      const [outline, pages, clips, comments] = await Promise.all([
        metadata.getBookOutline?.(folder, filename) ?? null,
        db.query<{ page: number; text: string }>(`
          SELECT o.page_index + 1 AS page, o.body AS text
          FROM book_page_ocr_search o JOIN books b USING (folder, filename)
          WHERE (o.folder, o.filename) = ($1, $2)
            AND o.source_size = b.size AND o.source_modified_at = b.modified_at
            AND o.body <> ''
          ORDER BY o.page_index
        `, [folder, filename]),
        metadata.listBookmarks(folder, filename),
        db.query<{ id: string; body: string; created_at: Date }>(`
          SELECT id, body, created_at FROM book_comments
          WHERE (folder, filename) = ($1, $2) ORDER BY created_at, id
        `, [folder, filename]),
      ]);
      return {
        title: bookTitleFromFilename(filename), outline, pages: pages.rows, clips,
        comments: comments.rows.map(({ id, body, created_at }) => ({ id, body, createdAt: created_at.toISOString() })),
      };
    },
    async clipDescription(clip, modelKey, describe) {
      const { rows } = await db.query<{ body: string }>(`
        SELECT body FROM book_bot_clip_descriptions WHERE clip_id = $1 AND model_key = $2
      `, [clip.id, modelKey]);
      if (rows[0]) return rows[0].body;
      const prefix = '/api/bookmark-assets/';
      if (!clip.imageUrl.startsWith(prefix)) return null;
      const file = path.resolve(bookmarkAssetRoot, clip.imageUrl.slice(prefix.length));
      const relative = path.relative(bookmarkAssetRoot, file);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
      const image = await readFile(file);
      const body = await describe(image);
      await db.query(`
        INSERT INTO book_bot_clip_descriptions (clip_id, model_key, body)
        SELECT id, $2, $3 FROM bookmarks WHERE id = $1
        ON CONFLICT (clip_id) DO UPDATE SET model_key = EXCLUDED.model_key, body = EXCLUDED.body
      `, [clip.id, modelKey, body]);
      return body;
    },
  };
}

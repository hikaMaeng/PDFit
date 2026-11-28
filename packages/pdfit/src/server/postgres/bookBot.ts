import type { Pool } from 'pg';
import type { BookBotSessionSummary } from '../../common/protocol/book-bot/index.js';
import type { MetadataStore } from '../../shared/index.js';
import { bookTitleFromFilename } from '../services/tagSuggestion.js';
import type { BookBotClip, BookBotHistorySummary, BookBotPage, BookBotPageRange, BookBotStore, BookBotStoredSession, BookBotStoredTurn } from '../book-bot/types.js';

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
  ALTER TABLE book_bot_sessions ADD COLUMN IF NOT EXISTS history_summary JSONB;
  CREATE INDEX IF NOT EXISTS idx_book_bot_sessions_latest
    ON book_bot_sessions (folder, filename, created_at DESC, id DESC);
  CREATE TABLE IF NOT EXISTS book_bot_clip_descriptions (
    clip_id UUID PRIMARY KEY REFERENCES bookmarks (id) ON DELETE CASCADE,
    model_key TEXT NOT NULL,
    body TEXT NOT NULL
  );
`;

type SessionRow = { id: string; title: string | null; created_at: Date; turns: BookBotStoredTurn[]; history_summary: BookBotHistorySummary | null };
const columns = 'id, title, created_at';

function summary(row: SessionRow): BookBotSessionSummary {
  return { id: row.id, title: row.title, createdAt: row.created_at.toISOString() };
}

function session(row?: SessionRow): BookBotStoredSession | null {
  return row ? { ...summary(row), turns: row.turns, historySummary: row.history_summary } : null;
}

function pageRangeBounds(ranges: BookBotPageRange[]) {
  return [ranges.map(({ first }) => first), ranges.map(({ last }) => last)];
}

const withinRanges = `EXISTS (
  SELECT 1 FROM unnest($3::int[], $4::int[]) AS scope(first_page, last_page)
  WHERE page_index >= scope.first_page - 1
    AND (scope.last_page IS NULL OR page_index < scope.last_page)
)`;

export function createPostgresBookBot(db: Pool, metadata: MetadataStore): BookBotStore {
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
        SELECT ${columns}, turns, history_summary FROM book_bot_sessions
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
        RETURNING ${columns}, turns, history_summary
      `, [folder, filename, id]);
      return session(rows[0]);
    },
    async saveTurn({ folder, filename }, sessionId, revision, turn, title, historySummary) {
      const turns = JSON.stringify([turn]);
      const { rows } = sessionId === null
        ? await db.query<SessionRow>(`
          INSERT INTO book_bot_sessions (id, folder, filename, title, turns)
          SELECT $3, folder, filename, $4, $5::jsonb FROM books WHERE (folder, filename) = ($1, $2)
          ON CONFLICT (id) DO NOTHING RETURNING ${columns}, turns, history_summary
        `, [folder, filename, turn.id, title, turns])
        : await db.query<SessionRow>(`
          UPDATE book_bot_sessions SET turns = turns || $4::jsonb, title = COALESCE(title, $5),
            history_summary = COALESCE($8::jsonb, history_summary)
          WHERE (folder, filename) = ($1, $2) AND id = $3
            AND jsonb_array_length(turns) = $6 AND NOT turns @> $7::jsonb
          RETURNING ${columns}, turns, history_summary
        `, [folder, filename, sessionId, turns, title, revision, JSON.stringify([{ id: turn.id }]),
          historySummary && JSON.stringify(historySummary)]);
      return session(rows[0]);
    },
    async source({ folder, filename }) {
      const book = await db.query('SELECT 1 FROM books WHERE (folder, filename) = ($1, $2)', [folder, filename]);
      if (!book.rowCount) return null;
      const outline = await (metadata.getBookOutline?.(folder, filename) ?? null);
      return { title: bookTitleFromFilename(filename), outline };
    },
    async relatedBooks({ folder, filename }) {
      const { rows } = await db.query<{ folder: string; filename: string; sharedTags: string[] }>(`
        SELECT b.folder, b.filename, array_agg(t.name ORDER BY t.name) AS "sharedTags"
        FROM book_tags origin JOIN book_tags related USING (tag_id)
        JOIN books b ON (b.folder, b.filename) = (related.folder, related.filename)
        JOIN tags t ON t.id = origin.tag_id
        WHERE (origin.folder, origin.filename) = ($1, $2)
          AND (b.folder, b.filename) <> ($1, $2)
        GROUP BY b.folder, b.filename
        ORDER BY count(*) DESC, b.folder, b.filename LIMIT 10
      `, [folder, filename]);
      return rows.map((row) => ({ ...row, title: bookTitleFromFilename(row.filename) }));
    },
    async findBooks(name, folder) {
      const { rows } = await db.query<{ folder: string; filename: string }>(`
        SELECT folder, filename FROM books
        WHERE ($2::text IS NULL OR folder = $2)
          AND (lower(normalize(filename)) = lower(normalize($1))
            OR lower(btrim(regexp_replace(regexp_replace(normalize(filename), '[.]pdf$', '', 'i'),
              '[_[:space:]]+', ' ', 'g'))) = lower($3))
        ORDER BY folder, filename LIMIT 10
      `, [name, folder ?? null, bookTitleFromFilename(name)]);
      return rows.map((row) => ({ ...row, title: bookTitleFromFilename(row.filename) }));
    },
    async pages({ folder, filename }, ranges) {
      if (!ranges.length) return [];
      const { rows } = await db.query<BookBotPage>(`
        SELECT o.page_index + 1 AS page, o.body AS text
        FROM book_page_ocr_search o JOIN books b USING (folder, filename)
        WHERE (o.folder, o.filename) = ($1, $2)
          AND o.source_size = b.size AND o.source_modified_at = b.modified_at
          AND o.body <> '' AND ${withinRanges}
        ORDER BY o.page_index
      `, [folder, filename, ...pageRangeBounds(ranges)]);
      return rows;
    },
    async clips({ folder, filename }, ranges) {
      const { rows } = await db.query<BookBotClip>(`
        SELECT b.id, b.page_index + 1 AS page, b.created_at::text AS "createdAt",
          CASE WHEN b.ocr_status = 'done' THEN b.ocr_text END AS ocr,
          b.comment, d.body AS "imageDescription"
        FROM bookmarks b LEFT JOIN book_bot_clip_descriptions d ON b.id = d.clip_id
        WHERE (b.folder, b.filename) = ($1, $2)
          AND (cardinality($3::int[]) = 0 OR ${withinRanges})
        ORDER BY b.page_index, b.created_at, b.id
      `, [folder, filename, ...pageRangeBounds(ranges)]);
      return rows;
    },
    async comments({ folder, filename }) {
      const { rows } = await db.query<{ id: string; body: string; created_at: Date }>(`
        SELECT id, body, created_at FROM book_comments
        WHERE (folder, filename) = ($1, $2) ORDER BY created_at, id
      `, [folder, filename]);
      return rows.map(({ id, body, created_at }) => ({ id, body, createdAt: created_at.toISOString() }));
    },
  };
}

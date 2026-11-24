import type { Pool } from 'pg';
import type { BookComment, BookCommentStore } from '../../common/protocol/book-comments/index.js';

export const bookCommentsSchema = `
  CREATE TABLE IF NOT EXISTS book_comments (
    id UUID PRIMARY KEY,
    folder TEXT NOT NULL,
    filename TEXT NOT NULL,
    body TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 10000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (folder, filename) REFERENCES books (folder, filename) ON UPDATE CASCADE ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_book_comments_page ON book_comments (folder, filename, created_at DESC, id DESC);

  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE id = 'book-file-relocation-v1') THEN
      ALTER TABLE book_page_ocr_search DROP CONSTRAINT book_page_ocr_search_folder_filename_fkey,
        ADD FOREIGN KEY (folder, filename) REFERENCES books (folder, filename) ON UPDATE CASCADE ON DELETE CASCADE;
      ALTER TABLE book_outline_search DROP CONSTRAINT book_outline_search_folder_filename_fkey,
        ADD FOREIGN KEY (folder, filename) REFERENCES book_outlines (folder, filename) ON UPDATE CASCADE ON DELETE CASCADE;
      INSERT INTO schema_migrations (id) VALUES ('book-file-relocation-v1');
    END IF;
  END $$;
`;

type CommentRow = { id: string; body: string; created_at: Date; updated_at: Date };
const commentColumns = 'id, body, created_at, updated_at';

function fromRow(row?: CommentRow | null): BookComment | null {
  if (!row?.id) return null;
  return { id: row.id, body: row.body, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}

export function createPostgresBookComments(db: Pool): BookCommentStore {
  return {
    async listBookComments({ folder, filename }, page) {
      const result = await db.query<CommentRow & { total: number; page: number }>(`
        WITH tally AS (
          SELECT COUNT(*)::int AS total FROM book_comments WHERE (folder, filename) = ($1, $2)
        ), position AS (
          SELECT total, LEAST(GREATEST(1, total), $3::bigint)::int AS page FROM tally
        )
        SELECT position.*, item.* FROM position
        LEFT JOIN LATERAL (
          SELECT ${commentColumns} FROM book_comments WHERE (folder, filename) = ($1, $2)
          ORDER BY created_at DESC, id DESC OFFSET (position.page - 1) LIMIT 1
        ) item ON true
      `, [folder, filename, page]);
      const row = result.rows[0];
      return { page: row.page, total: row.total, comment: fromRow(row) };
    },
    async createBookComment({ folder, filename }, { id, body }) {
      const result = await db.query<CommentRow>(`
        INSERT INTO book_comments (id, folder, filename, body)
        SELECT $3, folder, filename, $4 FROM books WHERE (folder, filename) = ($1, $2)
        ON CONFLICT (id) DO UPDATE SET body = book_comments.body
          WHERE (book_comments.folder, book_comments.filename) = (EXCLUDED.folder, EXCLUDED.filename)
        RETURNING ${commentColumns}
      `, [folder, filename, id, body]);
      return fromRow(result.rows[0]);
    },
    async updateBookComment({ folder, filename }, { id, body }) {
      const result = await db.query<CommentRow>(`
        UPDATE book_comments SET body = $4, updated_at = NOW()
        WHERE (folder, filename, id) = ($1, $2, $3)
        RETURNING ${commentColumns}
      `, [folder, filename, id, body]);
      return fromRow(result.rows[0]);
    },
    async deleteBookComment({ folder, filename }, id) {
      await db.query('DELETE FROM book_comments WHERE (folder, filename, id) = ($1, $2, $3)', [folder, filename, id]);
    },
  };
}

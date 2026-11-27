import type { Pool } from 'pg';
import {
  BOOK_COMMENT_PAGE_SIZE, type BookComment, type BookCommentImage, type BookCommentImageType,
  type BookCommentStore, type WriteBookCommentImage,
} from '../../common/protocol/book-comments/index.js';

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
  ALTER TABLE book_comments ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb;
  ALTER TABLE book_comments ADD COLUMN IF NOT EXISTS reference_pages INTEGER[];

  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE id = 'book-comment-images-v1') THEN
      ALTER TABLE book_comments DROP CONSTRAINT IF EXISTS book_comments_body_check;
      ALTER TABLE book_comments ADD CONSTRAINT book_comments_content_check
        CHECK (length(body) <= 10000 AND (length(btrim(body)) > 0 OR jsonb_array_length(images) > 0));
      INSERT INTO schema_migrations (id) VALUES ('book-comment-images-v1');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE id = 'book-file-relocation-v1') THEN
      ALTER TABLE book_page_ocr_search DROP CONSTRAINT book_page_ocr_search_folder_filename_fkey,
        ADD FOREIGN KEY (folder, filename) REFERENCES books (folder, filename) ON UPDATE CASCADE ON DELETE CASCADE;
      ALTER TABLE book_outline_search DROP CONSTRAINT book_outline_search_folder_filename_fkey,
        ADD FOREIGN KEY (folder, filename) REFERENCES book_outlines (folder, filename) ON UPDATE CASCADE ON DELETE CASCADE;
      INSERT INTO schema_migrations (id) VALUES ('book-file-relocation-v1');
    END IF;
  END $$;
`;

type CommentRow = { id: string; body: string; created_at: Date; updated_at: Date; images: BookCommentImage[] | null; reference_pages: number[] | null };
const commentColumns = `id, body, created_at, updated_at, reference_pages,
  (SELECT jsonb_agg(jsonb_build_object('id', image->>'id', 'name', image->>'name') ORDER BY position)
   FROM jsonb_array_elements(images) WITH ORDINALITY AS attachment(image, position)) AS images`;

function serializeImages(images: WriteBookCommentImage[] | undefined): string | null {
  return images ? JSON.stringify(images.map((image) => 'data' in image
    ? { id: image.id, name: image.name, mimeType: image.mimeType, base64: Buffer.from(image.data).toString('base64') }
    : image)) : null;
}

function fromRow(row?: CommentRow | null): BookComment | null {
  if (!row?.id) return null;
  return { id: row.id, body: row.body, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    ...(row.images?.length ? { images: row.images } : {}),
    ...(row.reference_pages ? { referencePages: row.reference_pages } : {}) };
}

export function createPostgresBookComments(db: Pool): BookCommentStore {
  return {
    async listBookCommentCounts(books) {
      const { rows } = await db.query<{ total: number }>(`
        SELECT (SELECT COUNT(*)::int FROM book_comments c
          WHERE (c.folder, c.filename) = (book.folder, book.filename)) AS total
        FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS book(folder, filename, position)
        ORDER BY book.position
      `, [books.map((book) => book.folder), books.map((book) => book.filename)]);
      return rows.map((row) => row.total);
    },
    async listBookComments({ folder, filename }, page, referencePage) {
      const scope = '(folder, filename) = ($1, $2) AND ($5::int IS NULL OR reference_pages @> ARRAY[$5::int])';
      const result = await db.query<CommentRow & { total: number; page: number }>(`
        WITH tally AS (
          SELECT COUNT(*)::int AS total FROM book_comments WHERE ${scope}
        ), position AS (
          SELECT total, LEAST(GREATEST(1, (total - 1) / $4::int + 1), $3::bigint)::int AS page FROM tally
        )
        SELECT position.*, item.* FROM position
        LEFT JOIN LATERAL (
          SELECT ${commentColumns} FROM book_comments WHERE ${scope}
          ORDER BY created_at DESC, id DESC
          OFFSET ((position.page - 1)::bigint * $4::int) LIMIT $4::int
        ) item ON true
        ORDER BY item.created_at DESC, item.id DESC
      `, [folder, filename, page, BOOK_COMMENT_PAGE_SIZE, referencePage ?? null]);
      const row = result.rows[0];
      const comments = result.rows.map(fromRow).filter((comment) => comment !== null);
      return { page: row.page, total: row.total, comments };
    },
    async createBookComment({ folder, filename }, { id, body, images, referencePages }) {
      const result = await db.query<CommentRow>(`
        INSERT INTO book_comments (id, folder, filename, body, images, reference_pages)
        SELECT $3, folder, filename, $4, COALESCE($5::jsonb, '[]'::jsonb), $6::int[]
        FROM books WHERE (folder, filename) = ($1, $2)
        ON CONFLICT (id) DO UPDATE SET body = book_comments.body
          WHERE (book_comments.folder, book_comments.filename) = (EXCLUDED.folder, EXCLUDED.filename)
        RETURNING ${commentColumns}
      `, [folder, filename, id, body, serializeImages(images), referencePages ?? null]);
      return fromRow(result.rows[0]);
    },
    async updateBookComment({ folder, filename }, { id, body, images, referencePages }) {
      const result = await db.query<CommentRow>(`
        UPDATE book_comments SET body = $4, updated_at = NOW(),
          reference_pages = COALESCE($6::int[], reference_pages),
          images = CASE WHEN $5::jsonb IS NULL THEN images ELSE COALESCE((
            SELECT jsonb_agg(COALESCE(stored.image, incoming.image) ORDER BY incoming.position)
            FROM jsonb_array_elements($5::jsonb) WITH ORDINALITY AS incoming(image, position)
            LEFT JOIN jsonb_array_elements(images) AS stored(image)
              ON NOT (incoming.image ? 'base64') AND stored.image->>'id' = incoming.image->>'id'
          ), '[]'::jsonb) END
        WHERE (folder, filename, id) = ($1, $2, $3)
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements($5::jsonb) AS incoming(image)
            WHERE NOT (incoming.image ? 'base64') AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(images) AS stored(image)
              WHERE stored.image->>'id' = incoming.image->>'id'
            )
          )
        RETURNING ${commentColumns}
      `, [folder, filename, id, body, serializeImages(images), referencePages ?? null]);
      return fromRow(result.rows[0]);
    },
    async deleteBookComment({ folder, filename }, id) {
      await db.query('DELETE FROM book_comments WHERE (folder, filename, id) = ($1, $2, $3)', [folder, filename, id]);
    },
    async readBookCommentImage({ folder, filename }, id, imageId) {
      const { rows: [image] } = await db.query<{ mimeType: BookCommentImageType; base64: string }>(`
        SELECT image->>'mimeType' AS "mimeType", image->>'base64' AS base64
        FROM book_comments CROSS JOIN LATERAL jsonb_array_elements(images) AS attachment(image)
        WHERE (folder, filename, id) = ($1, $2, $3) AND image->>'id' = $4
      `, [folder, filename, id, imageId]);
      return image ? { mimeType: image.mimeType, data: Buffer.from(image.base64, 'base64') } : null;
    },
  };
}

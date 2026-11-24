import type { Pool } from 'pg';
import type { ContentSearchResult, ContentSearchScope } from '../../common/protocol/search/index.js';

// Keep the same text-search expression in the GIN definitions and the query.
// See docs/content-search.md#indexes for the tokenizer and migration contract.
const vector = (column: string) => `to_tsvector('pg_catalog.simple', normalize(${column}, NFC))`;

// Exclude old auto-generated placeholder sequences for scanned PDFs.
export const LEGACY_PLACEHOLDER_OUTLINE = `
  o.is_manually_edited IS FALSE
  AND CASE WHEN jsonb_typeof(o.entries) = 'array' THEN jsonb_array_length(o.entries) > 0 ELSE FALSE END
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(o.entries) = 'array' THEN o.entries ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS outline_item(entry, ordinal)
    WHERE entry->>'title' IS DISTINCT FROM ordinal::text OR entry->>'depth' IS DISTINCT FROM '0'
  )`;

export const contentSearchSchema = `
  CREATE TABLE IF NOT EXISTS book_outline_search (
    folder TEXT NOT NULL,
    filename TEXT NOT NULL,
    entry_key TEXT NOT NULL,
    page INTEGER,
    title TEXT NOT NULL,
    terms TSVECTOR GENERATED ALWAYS AS (${vector('title')}) STORED,
    PRIMARY KEY (folder, filename, entry_key),
    FOREIGN KEY (folder, filename) REFERENCES book_outlines (folder, filename) ON DELETE CASCADE
  );
  CREATE OR REPLACE FUNCTION sync_book_outline_search() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    DELETE FROM book_outline_search WHERE folder = NEW.folder AND filename = NEW.filename;
    INSERT INTO book_outline_search (folder, filename, entry_key, page, title)
    SELECT NEW.folder, NEW.filename, entry.key, entry.page, entry.title
    FROM jsonb_to_recordset(NEW.entries) AS entry(key TEXT, page INTEGER, title TEXT)
    WHERE btrim(entry.title) <> '';
    RETURN NEW;
  END $$;
  CREATE OR REPLACE TRIGGER book_outline_search_sync AFTER INSERT OR UPDATE OF entries ON book_outlines
    FOR EACH ROW EXECUTE FUNCTION sync_book_outline_search();
  WITH migration AS (
    INSERT INTO schema_migrations (id) VALUES ('content-search-outline-v1')
    ON CONFLICT DO NOTHING RETURNING id
  )
  INSERT INTO book_outline_search (folder, filename, entry_key, page, title)
  SELECT o.folder, o.filename, entry.key, entry.page, entry.title
  FROM migration CROSS JOIN book_outlines o
  CROSS JOIN LATERAL jsonb_to_recordset(o.entries) AS entry(key TEXT, page INTEGER, title TEXT)
  WHERE btrim(entry.title) <> ''
  ON CONFLICT DO NOTHING;
  CREATE INDEX IF NOT EXISTS idx_outline_search_terms ON book_outline_search USING GIN (terms);

  CREATE TABLE IF NOT EXISTS book_page_ocr_search (
    folder TEXT NOT NULL,
    filename TEXT NOT NULL,
    page_index INTEGER NOT NULL CHECK (page_index >= 0),
    source_size BIGINT NOT NULL,
    source_modified_at TEXT NOT NULL,
    body TEXT NOT NULL,
    terms TSVECTOR GENERATED ALWAYS AS (${vector('body')}) STORED,
    PRIMARY KEY (folder, filename, page_index),
    FOREIGN KEY (folder, filename) REFERENCES books (folder, filename) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_page_ocr_search_terms ON book_page_ocr_search USING GIN (terms);
  CREATE OR REPLACE FUNCTION clear_stale_page_ocr_search() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    DELETE FROM book_page_ocr_search WHERE folder = OLD.folder AND filename = OLD.filename;
    RETURN NEW;
  END $$;
  CREATE OR REPLACE TRIGGER page_ocr_search_invalidate AFTER UPDATE OF size, modified_at ON books
    FOR EACH ROW WHEN ((OLD.size, OLD.modified_at) IS DISTINCT FROM (NEW.size, NEW.modified_at))
    EXECUTE FUNCTION clear_stale_page_ocr_search();

  CREATE INDEX IF NOT EXISTS idx_clip_ocr_search_terms ON bookmarks USING GIN (${vector('ocr_text')})
    WHERE ocr_status = 'done' AND ocr_text IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_clip_memo_search_terms ON bookmarks USING GIN (${vector('comment')})
    WHERE comment IS NOT NULL;
`;

function clipSource(column: 'ocr_text' | 'comment', predicate: string) {
  return {
    id: 'c.id::text', page: 'c.page_index + 1', body: `c.${column}`, terms: vector(`c.${column}`),
    from: 'bookmarks c JOIN books b USING (folder, filename)', predicate,
  };
}

const sources = {
  outline: {
    id: 's.entry_key', page: 's.page', body: 's.title', terms: 's.terms',
    from: 'book_outline_search s JOIN book_outlines o USING (folder, filename) JOIN books b USING (folder, filename)',
    predicate: `o.source_size = b.size AND o.source_modified_at = b.modified_at AND NOT (${LEGACY_PLACEHOLDER_OUTLINE})`,
  },
  'page-ocr': {
    id: 's.page_index::text', page: 's.page_index + 1', body: 's.body', terms: 's.terms',
    from: 'book_page_ocr_search s JOIN books b USING (folder, filename)',
    predicate: 's.source_size = b.size AND s.source_modified_at = b.modified_at',
  },
  'clip-ocr': clipSource('ocr_text', "c.ocr_status = 'done' AND c.ocr_text IS NOT NULL"),
  'clip-memo': clipSource('comment', 'c.comment IS NOT NULL'),
};

export async function searchLibraryContent(db: Pool, scope: ContentSearchScope, query: string, limit = 100): Promise<ContentSearchResult> {
  const { id, page, body, terms, from, predicate } = sources[scope];
  const result = await db.query(`
    WITH matches AS MATERIALIZED (
      SELECT ${id} AS id, b.folder, b.filename, ${page} AS page, ${body} AS body, q,
        ts_rank(${terms}, q, 32) AS rank
      FROM ${from} CROSS JOIN plainto_tsquery('pg_catalog.simple', normalize($1::text, NFC)) AS q
      WHERE ${predicate} AND ${terms} @@ q
      ORDER BY rank DESC, b.folder, b.filename, page NULLS LAST, id
      LIMIT $2
    )
    SELECT id, folder, filename, page, left(
      ts_headline('pg_catalog.simple', normalize(body, NFC), q,
        'StartSel="", StopSel="", MaxFragments=1, MinWords=8, MaxWords=24'), 400
    ) AS snippet
    FROM matches ORDER BY rank DESC, folder, filename, page NULLS LAST, id
  `, [query, limit + 1]);
  return { hits: result.rows.slice(0, limit), hasMore: result.rows.length > limit };
}

function parsePageSourceStamp(stamp: string) {
  const [mtime, size] = stamp.split('-');
  const modifiedAt = new Date(Number(mtime));
  return size && Number.isFinite(modifiedAt.getTime()) ? { size, modifiedAt: modifiedAt.toISOString() } : null;
}

export async function listPageOcrSearchIndexes(
  db: Pool, folder: string, filename: string, stamp: string, pageIndex?: number,
): Promise<number[]> {
  const source = parsePageSourceStamp(stamp);
  if (!source) return [];
  const params = [folder, filename, source.size, source.modifiedAt];
  const pageFilter = pageIndex === undefined ? '' : 'AND page_index = $5';
  const { rows } = await db.query<{ page_index: number }>(`
    SELECT page_index FROM book_page_ocr_search
    WHERE folder = $1 AND filename = $2 AND source_size = $3 AND source_modified_at = $4
      AND btrim(body) <> '' ${pageFilter}
    ORDER BY page_index
  `, pageIndex === undefined ? params : [...params, pageIndex]);
  return rows.map((row) => row.page_index);
}

export async function savePageOcrSearchText(
  db: Pool, folder: string, filename: string, stamp: string, pageIndex: number, text: string,
): Promise<void> {
  const source = parsePageSourceStamp(stamp);
  const body = text.trim().slice(0, 64_000).replaceAll('\u0000', '');
  if (!body || !source) return;
  await db.query(`
    INSERT INTO book_page_ocr_search AS ocr (folder, filename, page_index, source_size, source_modified_at, body)
    SELECT b.folder, b.filename, $5, b.size, b.modified_at, $6 FROM books b
    WHERE b.folder = $1 AND b.filename = $2 AND b.size = $3 AND b.modified_at = $4
    FOR SHARE OF b
    ON CONFLICT (folder, filename, page_index) DO UPDATE SET body = EXCLUDED.body,
      source_size = EXCLUDED.source_size, source_modified_at = EXCLUDED.source_modified_at
    WHERE (ocr.body, ocr.source_size, ocr.source_modified_at)
      IS DISTINCT FROM (EXCLUDED.body, EXCLUDED.source_size, EXCLUDED.source_modified_at)
  `, [folder, filename, source.size, source.modifiedAt, pageIndex, body]);
}

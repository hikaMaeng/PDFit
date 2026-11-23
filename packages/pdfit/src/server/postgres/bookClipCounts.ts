// See docs/internals.md#book-clip-counts.
export const bookClipCountsSchema = `
  ALTER TABLE books ADD COLUMN IF NOT EXISTS clip_count INTEGER NOT NULL DEFAULT 0 CHECK (clip_count >= 0);
  ALTER TABLE books ADD COLUMN IF NOT EXISTS clip_count_revision BIGINT NOT NULL DEFAULT 0;
  CREATE SEQUENCE IF NOT EXISTS book_clip_count_revisions;

  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE id = 'book-clip-counts-v1') THEN
      UPDATE books b
      SET clip_count = counts.total, clip_count_revision = nextval('book_clip_count_revisions')
      FROM (
        SELECT folder, filename, COUNT(*)::int AS total
        FROM bookmarks
        GROUP BY folder, filename
      ) counts
      WHERE (b.folder, b.filename) = (counts.folder, counts.filename);
      INSERT INTO schema_migrations (id) VALUES ('book-clip-counts-v1');
    END IF;
  END $$;

  -- Serialize the first indexing of a book with clip changes for the same key.
  CREATE OR REPLACE FUNCTION lock_book_clip_count(book_folder TEXT, book_filename TEXT)
  RETURNS void LANGUAGE sql AS $$
    SELECT pg_advisory_xact_lock(hashtextextended(jsonb_build_array(book_folder, book_filename)::text, 11831))
  $$;

  CREATE OR REPLACE FUNCTION initialize_book_clip_count()
  RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    PERFORM lock_book_clip_count(NEW.folder, NEW.filename);
    UPDATE books SET
      clip_count = (SELECT COUNT(*)::int FROM bookmarks WHERE (folder, filename) = (NEW.folder, NEW.filename)),
      clip_count_revision = nextval('book_clip_count_revisions')
    WHERE (folder, filename) = (NEW.folder, NEW.filename);
    RETURN NULL;
  END $$;
  CREATE OR REPLACE TRIGGER initialize_book_clip_count
    AFTER INSERT ON books FOR EACH ROW EXECUTE FUNCTION initialize_book_clip_count();

  CREATE OR REPLACE FUNCTION update_book_clip_count()
  RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE
    book_folder TEXT;
    book_filename TEXT;
    delta INTEGER;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      book_folder := NEW.folder;
      book_filename := NEW.filename;
      delta := 1;
    ELSE
      book_folder := OLD.folder;
      book_filename := OLD.filename;
      delta := -1;
    END IF;
    PERFORM lock_book_clip_count(book_folder, book_filename);
    UPDATE books SET clip_count = clip_count + delta,
      clip_count_revision = nextval('book_clip_count_revisions')
    WHERE (folder, filename) = (book_folder, book_filename);
    RETURN NULL;
  END $$;
  CREATE OR REPLACE TRIGGER update_book_clip_count
    AFTER INSERT OR DELETE ON bookmarks FOR EACH ROW EXECUTE FUNCTION update_book_clip_count();
`;

// Sources retain a current revision even after their hourly queue entry is acknowledged.
// Each trigger records only the key. Backfill and embedding reads are bounded separately.
export const embeddingSchema = `
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE TABLE IF NOT EXISTS embedding_profiles (
    profile TEXT PRIMARY KEY, table_name TEXT UNIQUE NOT NULL, model_name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS embedding_control (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
    profile TEXT REFERENCES embedding_profiles(profile), model_choice JSONB, generation UUID NOT NULL DEFAULT gen_random_uuid(),
    selection UUID, scan_cursor BIGINT NOT NULL DEFAULT 0, scan_done BOOLEAN NOT NULL DEFAULT false
  );
  INSERT INTO embedding_control (singleton) VALUES (true) ON CONFLICT DO NOTHING;
  ALTER TABLE embedding_control ADD COLUMN IF NOT EXISTS blocked_error TEXT;
  CREATE TABLE IF NOT EXISTS embedding_sources (
    id BIGSERIAL PRIMARY KEY, scope TEXT NOT NULL, refid TEXT NOT NULL,
    revision UUID NOT NULL DEFAULT gen_random_uuid(), dirty BOOLEAN NOT NULL DEFAULT true,
    clean BOOLEAN NOT NULL DEFAULT true, UNIQUE(scope, refid)
  );
  CREATE INDEX IF NOT EXISTS embedding_dirty ON embedding_sources (id) WHERE dirty;
  CREATE INDEX IF NOT EXISTS embedding_cleanup ON embedding_sources (id) WHERE NOT clean;
  CREATE TABLE IF NOT EXISTS embedding_discovery (
    scope TEXT PRIMARY KEY, cursor JSONB, done BOOLEAN NOT NULL DEFAULT false
  );
  INSERT INTO embedding_discovery(scope) VALUES ('page-ocr'), ('clip-ocr'), ('clip-memo'), ('book-comment') ON CONFLICT DO NOTHING;
  INSERT INTO embedding_discovery(scope) VALUES ('ocr-cache-books') ON CONFLICT DO NOTHING;
  CREATE TABLE IF NOT EXISTS embedding_ocr_books (
    hash TEXT PRIMARY KEY, folder TEXT NOT NULL, filename TEXT NOT NULL
  );
  CREATE OR REPLACE FUNCTION pdfit_ocr_cache_book_key(folder TEXT, filename TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
    SELECT encode(digest(convert_to(folder, 'UTF8') || decode('00', 'hex') || convert_to(filename, 'UTF8'), 'sha1'), 'hex')
  $$;
  CREATE OR REPLACE FUNCTION pdfit_ocr_cache_book() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF TG_OP <> 'INSERT' THEN DELETE FROM embedding_ocr_books WHERE hash = pdfit_ocr_cache_book_key(OLD.folder, OLD.filename); END IF;
    IF TG_OP <> 'DELETE' THEN
      INSERT INTO embedding_ocr_books VALUES (pdfit_ocr_cache_book_key(NEW.folder, NEW.filename), NEW.folder, NEW.filename)
      ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
  END $$;
  CREATE OR REPLACE TRIGGER pdfit_ocr_cache_book AFTER INSERT OR UPDATE OF folder, filename OR DELETE ON books
    FOR EACH ROW EXECUTE FUNCTION pdfit_ocr_cache_book();
  CREATE TABLE IF NOT EXISTS embedding_work (
    profile TEXT NOT NULL REFERENCES embedding_profiles(profile), source BIGINT NOT NULL REFERENCES embedding_sources(id),
    revision UUID NOT NULL, position INTEGER NOT NULL DEFAULT 0, ready BOOLEAN NOT NULL DEFAULT false,
    partial BOOLEAN NOT NULL DEFAULT false, failed BOOLEAN NOT NULL DEFAULT false, attempts INTEGER NOT NULL DEFAULT 0,
    due TIMESTAMPTZ NOT NULL DEFAULT now(), lease UUID, expires TIMESTAMPTZ, error TEXT,
    PRIMARY KEY (profile, source)
  );
  CREATE INDEX IF NOT EXISTS embedding_work_due ON embedding_work(profile, due, source) WHERE NOT ready AND NOT failed;
  CREATE INDEX IF NOT EXISTS embedding_work_failed ON embedding_work(profile, source) WHERE failed;
  CREATE INDEX IF NOT EXISTS embedding_work_partial ON embedding_work(profile, source) WHERE partial AND ready;
  CREATE TABLE IF NOT EXISTS embedding_chunks (
    profile TEXT NOT NULL, source BIGINT NOT NULL, revision UUID NOT NULL,
    id UUID NOT NULL, start_pos INTEGER NOT NULL, end_pos INTEGER NOT NULL,
    PRIMARY KEY (profile, id), UNIQUE(profile, source, revision, start_pos),
    FOREIGN KEY (profile, source) REFERENCES embedding_work(profile, source) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS embedding_chunks_source ON embedding_chunks(source, revision);

  CREATE OR REPLACE FUNCTION pdfit_embedding_mark(category TEXT, key TEXT) RETURNS void LANGUAGE SQL AS $$
    INSERT INTO embedding_sources(scope, refid) SELECT category, key WHERE EXISTS (SELECT 1 FROM embedding_profiles)
    ON CONFLICT (scope, refid) DO UPDATE SET revision = gen_random_uuid(), dirty = true, clean = false
  $$;
  CREATE OR REPLACE FUNCTION pdfit_embedding_page() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE old_key TEXT; new_key TEXT;
  BEGIN
    IF TG_OP <> 'INSERT' THEN old_key := jsonb_build_array(OLD.folder, OLD.filename, OLD.page_index)::text; END IF;
    IF TG_OP <> 'DELETE' THEN new_key := jsonb_build_array(NEW.folder, NEW.filename, NEW.page_index)::text; END IF;
    IF old_key IS DISTINCT FROM new_key THEN
      IF old_key IS NOT NULL THEN PERFORM pdfit_embedding_mark('page-ocr', old_key); END IF;
      IF new_key IS NOT NULL THEN PERFORM pdfit_embedding_mark('page-ocr', new_key); END IF;
    ELSIF (OLD.body, OLD.embedding_body, OLD.source_size, OLD.source_modified_at)
        IS DISTINCT FROM (NEW.body, NEW.embedding_body, NEW.source_size, NEW.source_modified_at) THEN
      PERFORM pdfit_embedding_mark('page-ocr', new_key);
    END IF;
    RETURN NULL;
  END $$;
  CREATE OR REPLACE FUNCTION pdfit_embedding_clip() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      PERFORM pdfit_embedding_mark('clip-ocr', OLD.id::text);
      PERFORM pdfit_embedding_mark('clip-memo', OLD.id::text);
    ELSIF TG_OP = 'INSERT' THEN
      PERFORM pdfit_embedding_mark('clip-ocr', NEW.id::text);
      PERFORM pdfit_embedding_mark('clip-memo', NEW.id::text);
    ELSE
      IF (OLD.ocr_status, OLD.ocr_text, OLD.folder, OLD.filename)
          IS DISTINCT FROM (NEW.ocr_status, NEW.ocr_text, NEW.folder, NEW.filename) THEN
        PERFORM pdfit_embedding_mark('clip-ocr', NEW.id::text);
      END IF;
      IF (OLD.comment, OLD.folder, OLD.filename) IS DISTINCT FROM (NEW.comment, NEW.folder, NEW.filename) THEN
        PERFORM pdfit_embedding_mark('clip-memo', NEW.id::text);
      END IF;
    END IF;
    RETURN NULL;
  END $$;
  CREATE OR REPLACE FUNCTION pdfit_embedding_comment() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN PERFORM pdfit_embedding_mark('book-comment', OLD.id::text);
    ELSIF TG_OP = 'INSERT' THEN PERFORM pdfit_embedding_mark('book-comment', NEW.id::text);
    ELSIF (OLD.body, OLD.folder, OLD.filename) IS DISTINCT FROM (NEW.body, NEW.folder, NEW.filename) THEN
      PERFORM pdfit_embedding_mark('book-comment', NEW.id::text);
    END IF;
    RETURN NULL;
  END $$;
  CREATE OR REPLACE TRIGGER pdfit_embedding_page AFTER INSERT OR UPDATE OR DELETE ON book_page_ocr_search
    FOR EACH ROW EXECUTE FUNCTION pdfit_embedding_page();
  CREATE OR REPLACE TRIGGER pdfit_embedding_clip AFTER INSERT OR UPDATE OR DELETE ON bookmarks
    FOR EACH ROW EXECUTE FUNCTION pdfit_embedding_clip();
  CREATE OR REPLACE TRIGGER pdfit_embedding_comment AFTER INSERT OR UPDATE OR DELETE ON book_comments
    FOR EACH ROW EXECUTE FUNCTION pdfit_embedding_comment();
`;

// Parameters only come from a stored source key. Each branch uses the source's native primary key.
export const lookupSource = `
  SELECT p.folder, p.filename, p.page_index + 1 AS page, COALESCE(p.embedding_body, p.body) AS body,
    p.embedding_body IS NULL AS partial
  FROM book_page_ocr_search p JOIN books b USING (folder, filename)
  WHERE s.scope = 'page-ocr' AND (p.folder, p.filename, p.page_index) =
    ((CASE WHEN s.scope = 'page-ocr' THEN s.refid END)::jsonb->>0,
      (CASE WHEN s.scope = 'page-ocr' THEN s.refid END)::jsonb->>1,
      ((CASE WHEN s.scope = 'page-ocr' THEN s.refid END)::jsonb->>2)::int)
    AND (p.source_size, p.source_modified_at) = (b.size, b.modified_at)
  UNION ALL
  SELECT p.folder, p.filename, p.page_index + 1, CASE s.scope WHEN 'clip-ocr' THEN p.ocr_text ELSE p.comment END, false
  FROM bookmarks p JOIN books b USING (folder, filename)
  WHERE s.scope IN ('clip-ocr','clip-memo') AND p.id = (CASE WHEN s.scope IN ('clip-ocr','clip-memo') THEN s.refid END)::uuid
    AND (s.scope = 'clip-memo' OR p.ocr_status = 'done')
  UNION ALL
  SELECT p.folder, p.filename, p.reference_pages[1], p.body, false
  FROM book_comments p JOIN books b USING (folder, filename)
  WHERE s.scope = 'book-comment' AND p.id = (CASE WHEN s.scope = 'book-comment' THEN s.refid END)::uuid
`;

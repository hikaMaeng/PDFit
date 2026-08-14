import type { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type {
  BookRecord,
  MetadataStore,
  TagSummary,
  TaggedBookRecord,
  ViewerStateRecord,
} from '../../shared/index.js';
import type { BookmarkRecord, CreateBookmarkRequest, UpdateBookmarkRequest } from '../../common/protocol/bookmarks/index.js';

export class PostgresMetadataStore implements MetadataStore {
  constructor(private readonly db: Pool, private readonly bookmarkAssetRoot: string) {}

  async listTrackedBooks(): Promise<Array<{ folder: string; filename: string }>> {
    const result = await this.db.query(`
      SELECT DISTINCT folder, filename FROM (
        SELECT folder, filename FROM reading_progress
        UNION ALL SELECT folder, filename FROM book_tags
        UNION ALL SELECT folder, filename FROM viewer_state
      ) tracked
      ORDER BY folder, filename
    `);
    return result.rows as Array<{ folder: string; filename: string }>;
  }

  async getProgress(folder: string, filename: string): Promise<number | null> {
    const result = await this.db.query(
      'SELECT page FROM reading_progress WHERE folder = $1 AND filename = $2',
      [folder, filename],
    );
    return result.rows[0] ? Number(result.rows[0].page) : null;
  }

  async setProgress(folder: string, filename: string, page: number): Promise<void> {
    await this.db.query(`
      INSERT INTO reading_progress (folder, filename, page, updated_at)
      VALUES ($1, $2, $3, EXTRACT(EPOCH FROM NOW())::BIGINT)
      ON CONFLICT (folder, filename)
      DO UPDATE SET page = EXCLUDED.page, updated_at = EXCLUDED.updated_at
    `, [folder, filename, page]);
  }

  async listTags(): Promise<string[]> {
    const result = await this.db.query(`
      SELECT DISTINCT t.name
      FROM tags t
      JOIN book_tags bt ON bt.tag_id = t.id
      ORDER BY t.name
    `);
    return result.rows.map((row) => String(row.name));
  }

  async listTagSummaries(): Promise<TagSummary[]> {
    const result = await this.db.query(`
      SELECT t.name, t.color, COUNT(DISTINCT (bt.folder, bt.filename))::int AS book_count
      FROM tags t
      JOIN book_tags bt ON bt.tag_id = t.id
      GROUP BY t.id, t.name
      ORDER BY t.name
    `);
    return result.rows.map((row) => ({
      name: String(row.name), color: String(row.color),
      bookCount: Number(row.book_count),
    }));
  }

  async listBooksByTag(tag: string): Promise<TaggedBookRecord[]> {
    const result = await this.db.query(`
      SELECT b.folder, b.filename, b.size, b.modified_at,
        COALESCE(array_agg(all_tags.name ORDER BY all_tags.name) FILTER (WHERE all_tags.name IS NOT NULL), '{}') AS tags
      FROM book_tags bt
      JOIN tags selected_tag ON selected_tag.id = bt.tag_id AND selected_tag.name = $1
      JOIN books b ON b.folder = bt.folder AND b.filename = bt.filename
      LEFT JOIN book_tags all_bt ON all_bt.folder = b.folder AND all_bt.filename = b.filename
      LEFT JOIN tags all_tags ON all_tags.id = all_bt.tag_id
      GROUP BY b.folder, b.filename, b.size, b.modified_at
      ORDER BY b.folder, b.filename
    `, [tag]);
    return result.rows.map((row) => ({
      folder: String(row.folder), filename: String(row.filename), size: Number(row.size),
      modified_at: String(row.modified_at), tags: (row.tags as string[]).map(String),
    }));
  }

  async listBooksByFolder(folder: string): Promise<BookRecord[]> {
    const result = await this.db.query(`
      SELECT folder, filename, size, modified_at
      FROM books
      WHERE folder = $1
      ORDER BY filename
    `, [folder]);
    return result.rows.map((row) => ({
      folder: String(row.folder), filename: String(row.filename),
      size: Number(row.size), modified_at: String(row.modified_at),
    }));
  }

  async listFolderBookCounts(): Promise<Record<string, number>> {
    const result = await this.db.query(`
      SELECT folder, COUNT(*)::int AS pdf_count
      FROM books
      GROUP BY folder
    `);
    return Object.fromEntries(result.rows.map((row) => [String(row.folder), Number(row.pdf_count)]));
  }

  async listFolderColors(): Promise<Record<string, string>> {
    const result = await this.db.query('SELECT name, color FROM folders');
    return Object.fromEntries(result.rows.map((row) => [String(row.name), String(row.color)]));
  }

  async updateFolderColor(folder: string, color: string): Promise<void> {
    await this.db.query('INSERT INTO folders (name, color) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET color = EXCLUDED.color', [folder, color]);
  }

  async syncBooks(books: BookRecord[]): Promise<void> {
    if (books.length === 0) return;
    // One server round-trip for the complete filesystem snapshot. The old
    // implementation issued one INSERT per PDF, which made startup/refresh
    // hold the event loop while a network-backed library was being indexed.
    await this.db.query(`
      INSERT INTO books (folder, filename, size, modified_at)
      SELECT folder, filename, size, modified_at
      FROM jsonb_to_recordset($1::jsonb)
        AS snapshot(folder TEXT, filename TEXT, size BIGINT, modified_at TEXT)
      ON CONFLICT (folder, filename)
      DO UPDATE SET size = EXCLUDED.size, modified_at = EXCLUDED.modified_at
    `, [JSON.stringify(books)]);
  }

  async listFolderTags(folder: string): Promise<Record<string, string[]>> {
    const result = await this.db.query(`
      SELECT bt.filename, t.name
      FROM book_tags bt
      JOIN tags t ON t.id = bt.tag_id
      WHERE bt.folder = $1
      ORDER BY bt.filename, t.name
    `, [folder]);
    const map: Record<string, string[]> = {};
    for (const row of result.rows) {
      const filename = String(row.filename);
      if (!map[filename]) map[filename] = [];
      map[filename].push(String(row.name));
    }
    return map;
  }

  async listBookTags(folder: string, filename: string): Promise<string[]> {
    const result = await this.db.query(`
      SELECT t.name
      FROM book_tags bt
      JOIN tags t ON t.id = bt.tag_id
      WHERE bt.folder = $1 AND bt.filename = $2
      ORDER BY t.name
    `, [folder, filename]);
    return result.rows.map((row) => String(row.name));
  }

  async addTag(folder: string, filename: string, tag: string): Promise<void> {
    await this.db.query('INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [tag]);
    const tagRow = await this.db.query('SELECT id FROM tags WHERE name = $1', [tag]);
    if (!tagRow.rows[0]) throw new Error('Tag was not created.');
    await this.db.query(`
      INSERT INTO book_tags (folder, filename, tag_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (folder, filename, tag_id) DO NOTHING
    `, [folder, filename, (tagRow.rows[0] as { id: string }).id]);
  }

  async removeTag(folder: string, filename: string, tag: string): Promise<void> {
    await this.db.query(`
      DELETE FROM book_tags
      WHERE folder = $1 AND filename = $2
        AND tag_id = (SELECT id FROM tags WHERE name = $3)
    `, [folder, filename, tag]);
  }

  async deleteTag(tag: string): Promise<void> {
    await this.db.query('DELETE FROM tags WHERE name = $1', [tag]);
  }

  async updateTagColor(tag: string, color: string): Promise<void> {
    await this.db.query('UPDATE tags SET color = $2 WHERE name = $1', [tag, color]);
  }

  async getViewerState(folder: string, filename: string): Promise<ViewerStateRecord | null> {
    const result = await this.db.query(`
      SELECT page, scale, fit_mode, view_mode, inverted, ui_hidden, scroll_top
      FROM viewer_state
      WHERE folder = $1 AND filename = $2
    `, [folder, filename]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      page: Number(row.page),
      scale: Number(row.scale),
      fitMode: String(row.fit_mode),
      viewMode: String(row.view_mode),
      inverted: Boolean(row.inverted),
      uiHidden: Boolean(row.ui_hidden),
      scrollTop: Number(row.scroll_top),
    };
  }

  async setViewerState(folder: string, filename: string, state: ViewerStateRecord): Promise<void> {
    await this.db.query(`
      INSERT INTO viewer_state (
        folder, filename, page, scale, fit_mode, view_mode, inverted, ui_hidden, scroll_top, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, EXTRACT(EPOCH FROM NOW())::BIGINT)
      ON CONFLICT (folder, filename)
      DO UPDATE SET
        page = EXCLUDED.page,
        scale = EXCLUDED.scale,
        fit_mode = EXCLUDED.fit_mode,
        view_mode = EXCLUDED.view_mode,
        inverted = EXCLUDED.inverted,
        ui_hidden = EXCLUDED.ui_hidden,
        scroll_top = EXCLUDED.scroll_top,
        updated_at = EXCLUDED.updated_at
    `, [
      folder,
      filename,
      state.page,
      state.scale,
      state.fitMode,
      state.viewMode,
      state.inverted,
      state.uiHidden,
      state.scrollTop,
    ]);
  }

  async purgeFile(folder: string, filename: string): Promise<void> {
    await this.db.query('DELETE FROM books WHERE folder = $1 AND filename = $2', [folder, filename]);
    await this.db.query('DELETE FROM reading_progress WHERE folder = $1 AND filename = $2', [folder, filename]);
    await this.db.query('DELETE FROM book_tags WHERE folder = $1 AND filename = $2', [folder, filename]);
    await this.db.query('DELETE FROM viewer_state WHERE folder = $1 AND filename = $2', [folder, filename]);
    await this.db.query('DELETE FROM bookmarks WHERE folder = $1 AND filename = $2', [folder, filename]);
  }

  async purgeFolder(folder: string): Promise<void> {
    await this.db.query('DELETE FROM books WHERE folder = $1', [folder]);
    await this.db.query('DELETE FROM reading_progress WHERE folder = $1', [folder]);
    await this.db.query('DELETE FROM book_tags WHERE folder = $1', [folder]);
    await this.db.query('DELETE FROM viewer_state WHERE folder = $1', [folder]);
    await this.db.query('DELETE FROM bookmarks WHERE folder = $1', [folder]);
  }

  async purgeOrphanTags(): Promise<void> {
    await this.db.query(`
      DELETE FROM tags t
      WHERE NOT EXISTS (SELECT 1 FROM book_tags bt WHERE bt.tag_id = t.id)
    `);
  }

  async listBookmarks(folder: string, filename: string): Promise<BookmarkRecord[]> {
    const result = await this.db.query('SELECT id, folder, filename, page_index, x, y, width, height, border_color, fill_color, fill_opacity, comment, image_mime_type, image_path, created_at, updated_at FROM bookmarks WHERE folder = $1 AND filename = $2 ORDER BY page_index, created_at', [folder, filename]);
    return result.rows.map((row) => this.bookmarkFromRow(row));
  }

  async listAllBookmarks(): Promise<BookmarkRecord[]> {
    const result = await this.db.query('SELECT id, folder, filename, page_index, x, y, width, height, border_color, fill_color, fill_opacity, comment, image_mime_type, image_path, created_at, updated_at FROM bookmarks ORDER BY created_at DESC');
    return result.rows.map((row) => this.bookmarkFromRow(row));
  }

  async createBookmark(folder: string, filename: string, bookmark: CreateBookmarkRequest): Promise<BookmarkRecord> {
    const id = randomUUID();
    const bookDir = path.join(this.bookmarkAssetRoot, id);
    fs.mkdirSync(bookDir, { recursive: true });
    const input = Buffer.from(bookmark.imageBase64.replace(/^data:[^,]+,/, ''), 'base64');
    const output = path.join(bookDir, 'capture.jpg');
    await sharp(input).jpeg({ quality: 90 }).toFile(output);
    const result = await this.db.query('INSERT INTO bookmarks (id, folder, filename, page_index, x, y, width, height, border_color, fill_color, fill_opacity, comment, image_mime_type, image_path) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, folder, filename, page_index, x, y, width, height, border_color, fill_color, fill_opacity, comment, image_mime_type, image_path, created_at, updated_at', [id, folder, filename, bookmark.pageIndex, bookmark.rect.x, bookmark.rect.y, bookmark.rect.width, bookmark.rect.height, bookmark.borderColor, bookmark.fillColor ?? null, bookmark.fillOpacity ?? 0.2, bookmark.comment ?? null, 'image/jpeg', `${id}/capture.jpg`]);
    return this.bookmarkFromRow(result.rows[0]);
  }

  async updateBookmark(id: string, update: UpdateBookmarkRequest): Promise<BookmarkRecord | null> {
    const result = await this.db.query('UPDATE bookmarks SET border_color = COALESCE($2, border_color), fill_color = CASE WHEN $3::boolean THEN $4 ELSE fill_color END, fill_opacity = COALESCE($5, fill_opacity), comment = CASE WHEN $6::boolean THEN $7 ELSE comment END, updated_at = NOW() WHERE id = $1 RETURNING id, folder, filename, page_index, x, y, width, height, border_color, fill_color, fill_opacity, comment, image_mime_type, image_path, created_at, updated_at', [id, update.borderColor ?? null, update.fillColor !== undefined, update.fillColor ?? null, update.fillOpacity ?? null, update.comment !== undefined, update.comment ?? null]);
    return result.rows[0] ? this.bookmarkFromRow(result.rows[0]) : null;
  }

  async deleteBookmark(id: string): Promise<void> {
    const result = await this.db.query<{ image_path: string }>('DELETE FROM bookmarks WHERE id = $1 RETURNING image_path', [id]);
    const imagePath = result.rows[0]?.image_path;
    if (!imagePath) return;

    const assetRoot = path.resolve(this.bookmarkAssetRoot);
    const assetPath = path.resolve(assetRoot, imagePath);
    if (assetPath !== assetRoot && !assetPath.startsWith(`${assetRoot}${path.sep}`)) return;
    try {
      await fs.promises.unlink(assetPath);
      await fs.promises.rm(path.dirname(assetPath), { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private bookmarkFromRow(row: Record<string, unknown>): BookmarkRecord {
    return { id: String(row.id), folder: String(row.folder), filename: String(row.filename), pageIndex: Number(row.page_index), rect: { x: Number(row.x), y: Number(row.y), width: Number(row.width), height: Number(row.height) }, borderColor: String(row.border_color), fillColor: row.fill_color == null ? null : String(row.fill_color), fillOpacity: Number(row.fill_opacity), comment: row.comment == null ? null : String(row.comment), imageMimeType: 'image/jpeg', imageUrl: `/api/bookmark-assets/${String(row.image_path)}`, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
  }

  async ensureSchema(): Promise<void> {
    await this.db.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TABLE IF NOT EXISTS reading_progress (
        folder TEXT NOT NULL,
        filename TEXT NOT NULL,
        page INTEGER NOT NULL DEFAULT 1,
        updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
        PRIMARY KEY (folder, filename)
      );
      CREATE TABLE IF NOT EXISTS books (
        folder TEXT NOT NULL,
        filename TEXT NOT NULL,
        size BIGINT NOT NULL DEFAULT 0,
        modified_at TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (folder, filename)
      );
      CREATE INDEX IF NOT EXISTS idx_books_folder ON books (folder);
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
      );
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE id = 'remove-bookmarks-v1') THEN
          DROP TABLE IF EXISTS bookmarks;
          DROP SEQUENCE IF EXISTS bookmarks_id_seq;
          INSERT INTO schema_migrations (id) VALUES ('remove-bookmarks-v1');
        END IF;
      END $$;
      CREATE TABLE IF NOT EXISTS tags (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT '#22c55e'
      );
      ALTER TABLE tags ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '#22c55e';
      CREATE TABLE IF NOT EXISTS folders (
        name TEXT PRIMARY KEY,
        color TEXT NOT NULL DEFAULT '#3b82f6'
      );
      CREATE TABLE IF NOT EXISTS book_tags (
        folder TEXT NOT NULL,
        filename TEXT NOT NULL,
        tag_id BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (folder, filename, tag_id)
      );
      CREATE INDEX IF NOT EXISTS idx_book_tags_book ON book_tags (folder, filename);
      CREATE INDEX IF NOT EXISTS idx_book_tags_tag ON book_tags (tag_id);
      INSERT INTO books (folder, filename)
      SELECT folder, filename FROM book_tags
      ON CONFLICT (folder, filename) DO NOTHING;
      CREATE TABLE IF NOT EXISTS viewer_state (
        folder TEXT NOT NULL,
        filename TEXT NOT NULL,
        page INTEGER NOT NULL DEFAULT 1,
        scale DOUBLE PRECISION NOT NULL DEFAULT 1.2,
        fit_mode TEXT NOT NULL DEFAULT 'width',
        view_mode TEXT NOT NULL DEFAULT 'scroll',
        inverted BOOLEAN NOT NULL DEFAULT FALSE,
        ui_hidden BOOLEAN NOT NULL DEFAULT FALSE,
        scroll_top DOUBLE PRECISION NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
        PRIMARY KEY (folder, filename)
      );
      CREATE TABLE IF NOT EXISTS bookmarks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        folder TEXT NOT NULL,
        filename TEXT NOT NULL,
        page_index INTEGER NOT NULL CHECK (page_index >= 0),
        x DOUBLE PRECISION NOT NULL CHECK (x >= 0 AND x <= 1),
        y DOUBLE PRECISION NOT NULL CHECK (y >= 0 AND y <= 1),
        width DOUBLE PRECISION NOT NULL CHECK (width > 0 AND x + width <= 1),
        height DOUBLE PRECISION NOT NULL CHECK (height > 0 AND y + height <= 1),
        border_color TEXT NOT NULL,
        fill_color TEXT,
        fill_opacity DOUBLE PRECISION NOT NULL DEFAULT 0.2 CHECK (fill_opacity >= 0 AND fill_opacity <= 1),
        comment TEXT,
        image_mime_type TEXT NOT NULL DEFAULT 'image/jpeg' CHECK (image_mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
        image_path TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE bookmarks DROP CONSTRAINT IF EXISTS bookmarks_check;
      ALTER TABLE bookmarks DROP CONSTRAINT IF EXISTS bookmarks_width_check;
      ALTER TABLE bookmarks DROP CONSTRAINT IF EXISTS bookmarks_height_check;
      ALTER TABLE bookmarks DROP CONSTRAINT IF EXISTS bookmarks_absolute_rect_check;
      DO $$
      DECLARE constraint_name TEXT;
      BEGIN
        FOR constraint_name IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'bookmarks'::regclass AND contype = 'c'
        LOOP
          EXECUTE format('ALTER TABLE bookmarks DROP CONSTRAINT %I', constraint_name);
        END LOOP;
      END $$;
      ALTER TABLE bookmarks ADD CONSTRAINT bookmarks_absolute_rect_check CHECK (x >= 0 AND y >= 0 AND width > 0 AND height > 0);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_book_page ON bookmarks (folder, filename, page_index);
    `);
  }
}

export async function createPostgresMetadataStore(pool: Pool, bookmarkAssetRoot = path.resolve(process.cwd(), 'data', 'bookmarks')): Promise<PostgresMetadataStore> {
  fs.mkdirSync(bookmarkAssetRoot, { recursive: true });
  const store = new PostgresMetadataStore(pool, bookmarkAssetRoot);
  await store.ensureSchema();
  return store;
}

export async function migrateSqliteMetadata(sqlitePath: string, pool: Pool): Promise<boolean> {
  if (!fs.existsSync(sqlitePath)) return false;

  const { DatabaseSync } = await import('node:sqlite');
  const sqlite = new DatabaseSync(sqlitePath);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const progress = sqlite.prepare('SELECT folder, filename, page, updated_at FROM reading_progress').all() as Array<Record<string, unknown>>;
    for (const row of progress) {
      await client.query(`
        INSERT INTO reading_progress (folder, filename, page, updated_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (folder, filename) DO UPDATE SET page = EXCLUDED.page, updated_at = EXCLUDED.updated_at
      `, [row.folder, row.filename, row.page, row.updated_at]);
    }

    const tags = sqlite.prepare('SELECT id, name FROM tags').all() as Array<Record<string, unknown>>;
    for (const row of tags) {
      await client.query(`
        INSERT INTO tags (id, name) VALUES ($1, $2)
        ON CONFLICT (name) DO NOTHING
      `, [row.id, row.name]);
    }

    const bookTags = sqlite.prepare(`
      SELECT bt.folder, bt.filename, t.name
      FROM book_tags bt JOIN tags t ON t.id = bt.tag_id
    `).all() as Array<Record<string, unknown>>;
    for (const row of bookTags) {
      await client.query(`
        INSERT INTO book_tags (folder, filename, tag_id)
        SELECT $1, $2, id FROM tags WHERE name = $3
        ON CONFLICT (folder, filename, tag_id) DO NOTHING
      `, [row.folder, row.filename, row.name]);
    }

    const viewerStates = sqlite.prepare(`
      SELECT folder, filename, page, scale, fit_mode, view_mode, inverted, ui_hidden, scroll_top, updated_at
      FROM viewer_state
    `).all() as Array<Record<string, unknown>>;
    for (const row of viewerStates) {
      await client.query(`
        INSERT INTO viewer_state (
          folder, filename, page, scale, fit_mode, view_mode, inverted, ui_hidden, scroll_top, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (folder, filename) DO UPDATE SET
          page = EXCLUDED.page, scale = EXCLUDED.scale, fit_mode = EXCLUDED.fit_mode,
          view_mode = EXCLUDED.view_mode, inverted = EXCLUDED.inverted, ui_hidden = EXCLUDED.ui_hidden,
          scroll_top = EXCLUDED.scroll_top, updated_at = EXCLUDED.updated_at
      `, [
        row.folder, row.filename, row.page, row.scale, row.fit_mode, row.view_mode,
        Number(row.inverted) === 1, Number(row.ui_hidden) === 1, row.scroll_top, row.updated_at,
      ]);
    }

    await client.query(`
      SELECT setval('tags_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM tags), 1), 1), true);
    `);
    await client.query('COMMIT');
    sqlite.close();
    fs.renameSync(sqlitePath, `${sqlitePath}.migrated-${Date.now()}`);
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

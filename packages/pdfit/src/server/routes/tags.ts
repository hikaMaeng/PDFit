import { Router, type Request, type Response } from 'express';
import { resolveMetadataStore, type MetadataStoreResolver } from './metadataStoreResolver.js';
import { bookTitleFromFilename, normalizeSuggestedTags, type BookTagSuggestionProvider } from '../services/tagSuggestion.js';
import { BOOKSTORE_TAG_TAXONOMY, DOCUMENT_TAG_TAXONOMY, documentTagFromTitle } from '../../shared/tagTaxonomy.js';

const AUTOMATIC_CATEGORY_SET = new Set<string>([...BOOKSTORE_TAG_TAXONOMY, ...DOCUMENT_TAG_TAXONOMY]);
const LEGACY_AUTOMATIC_CATEGORIES = new Set(['기타', '교양']);
const isReplaceableAutomaticCategory = (tag: string) => AUTOMATIC_CATEGORY_SET.has(tag) || LEGACY_AUTOMATIC_CATEGORIES.has(tag);

/** 호스트 서비스가 AI 처리 횟수 예약과 성공 차감을 연결하는 계약. */
export type AutomaticTagDocument = { filename: string; driveFileId?: string; assignedTag?: string };
export type AutomaticTagUsage = (request: Request, documents: AutomaticTagDocument[]) => Promise<{ finish(successful: AutomaticTagDocument[]): Promise<void> }>;

export function createTagsRouter(metadataStoreResolver: MetadataStoreResolver, suggestBookTags?: BookTagSuggestionProvider, automaticTagUsage?: AutomaticTagUsage): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      res.json(await metadataStore.listTags());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/summary', async (req: Request, res: Response) => {
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      res.json(await metadataStore.listTagSummaries());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // 태그 이름과 겹치지 않도록 `/:tag/books`와 모양이 다른 단일 세그먼트 경로를 쓴다.
  router.get('/untagged-books', async (req: Request, res: Response) => {
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      if (!metadataStore.listUntaggedBooks) { res.status(501).json({ error: 'Untagged listing is not available for this library.' }); return; }
      res.json(await metadataStore.listUntaggedBooks());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/untagged-count', async (req: Request, res: Response) => {
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      if (!metadataStore.countUntaggedBooks) { res.status(501).json({ error: 'Untagged listing is not available for this library.' }); return; }
      res.json({ count: await metadataStore.countUntaggedBooks() });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.delete('/', async (req: Request, res: Response) => {
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      await metadataStore.deleteAllTags();
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.delete('/:tag', async (req: Request, res: Response) => {
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      await metadataStore.deleteTag(req.params.tag);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.patch('/:tag/color', async (req: Request, res: Response) => {
    const { color } = req.body as { color?: string };
    if (!color || !/^#[0-9a-f]{6}$/i.test(color)) {
      res.status(400).json({ error: 'A valid color is required.' }); return;
    }
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      await metadataStore.updateTagColor(req.params.tag, color.toLowerCase());
      res.json({ ok: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  router.get('/:tag/books', async (req: Request, res: Response) => {
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      res.json(await metadataStore.listBooksByTag(req.params.tag));
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/folder/:folder', async (req: Request, res: Response) => {
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      res.json(await metadataStore.listFolderTags(req.params.folder));
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.delete('/folder/:folder', async (req: Request, res: Response) => {
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      let removed = 0;
      if (metadataStore.removeFolderTags) {
        removed = await metadataStore.removeFolderTags(req.params.folder);
      } else {
        const folderTags = await metadataStore.listFolderTags(req.params.folder);
        for (const [filename, tags] of Object.entries(folderTags)) {
          for (const tag of tags) {
            await metadataStore.removeTag(req.params.folder, filename, tag);
            removed += 1;
          }
        }
      }
      res.json({ ok: true, removed });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/book/:folder/:filename', async (req: Request, res: Response) => {
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      const driveFileId = typeof req.query.driveFileId === 'string' ? req.query.driveFileId : undefined;
      res.json(await metadataStore.listBookTags(req.params.folder, req.params.filename, driveFileId));
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/book/:folder/:filename', async (req: Request, res: Response) => {
    const { tag, driveFileId } = req.body as { tag?: string; driveFileId?: string };
    if (!tag?.trim()) {
      res.status(400).json({ error: 'Tag is required.' });
      return;
    }

    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      await metadataStore.addTag(req.params.folder, req.params.filename, tag.trim(), driveFileId);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/book/:folder/:filename/auto', async (req: Request, res: Response) => {
    if (!suggestBookTags) {
      res.status(503).json({ error: 'AI automatic tagging is not configured.' });
      return;
    }
    const { driveFileId } = req.body as { driveFileId?: unknown };
    if (driveFileId !== undefined && (typeof driveFileId !== 'string' || driveFileId.length > 200)) {
      res.status(400).json({ error: 'Invalid driveFileId.' });
      return;
    }
    const title = bookTitleFromFilename(req.params.filename);
    if (!title) {
      res.status(400).json({ error: 'A book title is required.' });
      return;
    }

    let usage: Awaited<ReturnType<AutomaticTagUsage>> | undefined;
    const successful: AutomaticTagDocument[] = [];
    try {
      usage = await automaticTagUsage?.(req, [{ filename: req.params.filename, driveFileId }]);
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      const currentTagsRequest = metadataStore.listBookTags(req.params.folder, req.params.filename, driveFileId).catch(async () => {
        // A Drive file can exist before its metadata-index row is repaired. Do
        // not stop the automatic-tag flow before addTag gets a chance to repair
        // that row with the authenticated Drive file ID.
        const folderTags = await metadataStore.listFolderTags(req.params.folder).catch((): Record<string, string[]> => ({}));
        return folderTags[driveFileId ?? req.params.filename] ?? folderTags[req.params.filename] ?? [];
      });
      const [availableTags, currentTags] = await Promise.all([metadataStore.listTags(), currentTagsRequest]);
      const documentTag = documentTagFromTitle(title);
      const suggestedTags = documentTag
        ? [documentTag]
        : normalizeSuggestedTags(await suggestBookTags({ title, availableTags, currentTags }), 5, true)
          .filter((tag) => BOOKSTORE_TAG_TAXONOMY.includes(tag as typeof BOOKSTORE_TAG_TAXONOMY[number])).slice(0, 1);
      const selectedTag = suggestedTags[0];
      if (!selectedTag) throw new Error('신뢰할 수 있는 도서 분류를 결정하지 못했습니다.');
      const addedTags = selectedTag && !currentTags.includes(selectedTag) ? [selectedTag] : [];
      const removedTags = selectedTag
        ? currentTags.filter((tag) => isReplaceableAutomaticCategory(tag) && tag !== selectedTag)
        : [];
      for (const tag of addedTags) {
        await metadataStore.addTag(req.params.folder, req.params.filename, tag, driveFileId);
      }
      for (const tag of removedTags) await metadataStore.removeTag(req.params.folder, req.params.filename, tag, driveFileId);
      successful.push({ filename: req.params.filename, driveFileId, assignedTag: selectedTag });
      await usage?.finish(successful);
      usage = undefined;
      res.json({ title, suggestedTags, addedTags, removedTags });
    } catch (error) {
      try { await usage?.finish(successful); }
      catch { res.status(503).json({ error: 'AI 처리 사용량을 저장하지 못했습니다. 잠시 후 다시 확인해주세요.' }); return; }
      res.status((error as { statusCode?: number }).statusCode ?? 502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/folder/:folder/auto', async (req: Request, res: Response) => {
    if (!suggestBookTags) {
      res.status(503).json({ error: 'AI automatic tagging is not configured.' });
      return;
    }
    const { books } = req.body as { books?: unknown };
    if (!Array.isArray(books) || books.length < 1 || books.length > 500) {
      res.status(400).json({ error: 'books must contain 1-500 entries.' });
      return;
    }
    const parsed: Array<{ filename: string; driveFileId?: string }> = [];
    const seen = new Set<string>();
    for (const value of books) {
      const candidate = value as { filename?: unknown; driveFileId?: unknown };
      if (typeof candidate?.filename !== 'string' || !candidate.filename.trim() || candidate.filename.length > 500
        || (candidate.driveFileId !== undefined && (typeof candidate.driveFileId !== 'string' || candidate.driveFileId.length > 200))) {
        res.status(400).json({ error: 'Each book requires a valid filename and optional driveFileId.' });
        return;
      }
      const key = `${candidate.filename}\0${candidate.driveFileId ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parsed.push({ filename: candidate.filename, ...(candidate.driveFileId ? { driveFileId: candidate.driveFileId } : {}) });
    }

    let usage: Awaited<ReturnType<AutomaticTagUsage>> | undefined;
    const successful: AutomaticTagDocument[] = [];
    try {
      usage = await automaticTagUsage?.(req, parsed);
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      const [availableTags, folderTags] = await Promise.all([
        metadataStore.listTags(),
        metadataStore.listFolderTags(req.params.folder),
      ]);
      const results: Array<{ filename: string; driveFileId?: string; assignedTag: string; addedTags: string[]; removedTags: string[] }> = [];
      const errors: Array<{ filename: string; driveFileId?: string; error: string }> = [];
      const relations: Array<{ folder: string; filename: string; tag: string; driveFileId?: string }> = [];
      let cursor = 0;
      const worker = async () => {
        while (cursor < parsed.length) {
          const book = parsed[cursor++];
          const title = bookTitleFromFilename(book.filename);
          try {
            if (!title) throw new Error('A book title is required.');
            const currentTags = folderTags[book.driveFileId ?? book.filename] ?? [];
            const documentTag = documentTagFromTitle(title);
            const suggestedTags = documentTag
              ? [documentTag]
              : normalizeSuggestedTags(await suggestBookTags({ title, availableTags, currentTags }), 5, true)
                .filter((tag) => BOOKSTORE_TAG_TAXONOMY.includes(tag as typeof BOOKSTORE_TAG_TAXONOMY[number])).slice(0, 1);
            const selectedTag = suggestedTags[0];
            if (!selectedTag) throw new Error('신뢰할 수 있는 도서 분류를 결정하지 못했습니다.');
            const addedTags = selectedTag && !currentTags.includes(selectedTag) ? [selectedTag] : [];
            const removedTags = selectedTag
              ? currentTags.filter((tag) => isReplaceableAutomaticCategory(tag) && tag !== selectedTag)
              : [];
            results.push({ filename: book.filename, ...(book.driveFileId ? { driveFileId: book.driveFileId } : {}), assignedTag: selectedTag, addedTags, removedTags });
            for (const tag of addedTags) relations.push({ folder: req.params.folder, filename: book.filename, tag, driveFileId: book.driveFileId });
          } catch (error) {
            errors.push({ filename: book.filename, ...(book.driveFileId ? { driveFileId: book.driveFileId } : {}), error: error instanceof Error ? error.message : String(error) });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, parsed.length) }, () => worker()));
      const relationKey = (value: { filename: string; driveFileId?: string }) => `${value.driveFileId ?? ''}\0${value.filename}`;
      const failedPersistence = new Set<string>();
      let persistedRelationCount = 0;
      if (metadataStore.addTags) {
        try {
          await metadataStore.addTags(relations);
          persistedRelationCount = relations.length;
        } catch {
          // One stale metadata row must not prevent the other classified books in
          // the same client batch from being tagged. The single-write fast path
          // stays primary; only a failed batch is isolated relation by relation.
          for (const relation of relations) {
            try {
              await metadataStore.addTag(relation.folder, relation.filename, relation.tag, relation.driveFileId);
              persistedRelationCount += 1;
            } catch (error) {
              failedPersistence.add(relationKey(relation));
              errors.push({ filename: relation.filename, ...(relation.driveFileId ? { driveFileId: relation.driveFileId } : {}), error: error instanceof Error ? error.message : String(error) });
            }
          }
        }
      } else {
        for (const relation of relations) {
          try {
            await metadataStore.addTag(relation.folder, relation.filename, relation.tag, relation.driveFileId);
            persistedRelationCount += 1;
          } catch (error) {
            failedPersistence.add(relationKey(relation));
            errors.push({ filename: relation.filename, ...(relation.driveFileId ? { driveFileId: relation.driveFileId } : {}), error: error instanceof Error ? error.message : String(error) });
          }
        }
      }
      if (failedPersistence.size > 0) {
        for (let index = results.length - 1; index >= 0; index -= 1) {
          if (failedPersistence.has(relationKey(results[index]))) results.splice(index, 1);
        }
      }
      for (const book of results) {
        for (const tag of book.removedTags) await metadataStore.removeTag(req.params.folder, book.filename, tag, book.driveFileId);
        successful.push(book);
      }
      await usage?.finish(successful);
      usage = undefined;
      res.json({ processed: results.length, failed: errors.length, addedTags: persistedRelationCount, books: results, errors });
    } catch (error) {
      try { await usage?.finish(successful); }
      catch { res.status(503).json({ error: 'AI 처리 사용량을 저장하지 못했습니다. 잠시 후 다시 확인해주세요.' }); return; }
      res.status((error as { statusCode?: number }).statusCode ?? 502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete('/book/:folder/:filename/:tag', async (req: Request, res: Response) => {
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      const driveFileId = typeof req.query.driveFileId === 'string' ? req.query.driveFileId : undefined;
      await metadataStore.removeTag(req.params.folder, req.params.filename, req.params.tag, driveFileId);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}

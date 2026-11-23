import { Router, type Request, type Response } from 'express';
import { resolveMetadataStore, type MetadataStoreResolver } from './metadataStoreResolver.js';
import { AUTOMATIC_TAG_MAX, AUTOMATIC_TAG_MIN, bookTitleFromFilename, normalizeSuggestedTags, selectAutomaticTags, type BookTagSuggestionProvider } from '../services/tagSuggestion.js';
import { BOOKSTORE_TAG_TAXONOMY, DOCUMENT_TAG_TAXONOMY, documentTagFromTitle } from '../../shared/tagTaxonomy.js';
import type { MetadataStore } from '../../shared/index.js';
import { isEditableTagName, isTagIconName } from '../../shared/tagDetails.js';

const AUTOMATIC_CATEGORY_SET = new Set<string>([...BOOKSTORE_TAG_TAXONOMY, ...DOCUMENT_TAG_TAXONOMY]);
const LEGACY_AUTOMATIC_CATEGORIES = new Set(['기타', '교양']);
const isReplaceableAutomaticCategory = (tag: string) => AUTOMATIC_CATEGORY_SET.has(tag) || LEGACY_AUTOMATIC_CATEGORIES.has(tag);

/**
 * 분류 결과가 조건을 못 채워 그 책을 건너뛴 실패. 같은 책을 곧바로 다시 분류해도
 * 대개 같은 결과가 나오고 한 번이 수십 초씩 걸리므로, 호출한 쪽이 재시도 대상에서
 * 빼도록 `retryable: false`로 구분한다.
 */
class AutomaticTagQualityError extends Error {
  readonly statusCode = 422;
  readonly retryable = false;
}

/**
 * 자동 태그 한 번이 채워야 하는 조건. 조건을 못 채운 결과를 저장하면 품질이 낮은
 * 한두 개의 태그가 기존 태그를 덮어쓰기 때문에, 여기서 던져 그 책의 태그를
 * 한 글자도 바꾸지 않은 채 실패로 보고한다. 제목이 문서 형식을 확정하는 경로는
 * AI 판단이 아니라 결정적인 규칙이므로 그 한 개를 그대로 인정한다.
 */
function assertAutomaticTagQuality(tags: string[], title: string, minimum: number): void {
  if (tags.length === 0) throw new AutomaticTagQualityError(`"${title}"에서 신뢰할 수 있는 도서 분류를 결정하지 못했습니다. 기존 태그는 그대로 두었습니다.`);
  if (tags.length < minimum) {
    throw new AutomaticTagQualityError(`"${title}"의 태그를 ${tags.length}개만 만들어 최소 ${minimum}개 조건을 채우지 못했습니다. 기존 태그는 그대로 두었습니다.`);
  }
}

/**
 * 한 책의 자동 태그를 전부 적용하거나 전혀 적용하지 않는다. 저장 도중 한 건이라도
 * 실패하면 이 호출이 쓴 관계만 되돌려 호출 전 상태로 남기고 던진다.
 */
async function applyAutomaticTags(
  metadataStore: MetadataStore,
  target: { folder: string; filename: string; driveFileId?: string },
  change: { addedTags: string[]; removedTags: string[] },
): Promise<void> {
  const added: string[] = [];
  const removed: string[] = [];
  try {
    for (const tag of change.addedTags) {
      await metadataStore.addTag(target.folder, target.filename, tag, target.driveFileId);
      added.push(tag);
    }
    for (const tag of change.removedTags) {
      await metadataStore.removeTag(target.folder, target.filename, tag, target.driveFileId);
      removed.push(tag);
    }
  } catch (cause) {
    for (const tag of added) await metadataStore.removeTag(target.folder, target.filename, tag, target.driveFileId).catch(() => undefined);
    for (const tag of removed) await metadataStore.addTag(target.folder, target.filename, tag, target.driveFileId).catch(() => undefined);
    throw cause;
  }
}

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

  // 태그 이름과 겹치지 않도록 `/:tag/books`와 모양이 다른 단일 세그먼트 경로를 쓴다(`/index`, `/untagged-*` 모두).
  router.get('/index', async (req: Request, res: Response) => {
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      if (!metadataStore.listTagIndex) { res.status(501).json({ error: 'Tag index is not available for this library.' }); return; }
      res.json(await metadataStore.listTagIndex());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

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

  router.patch('/:id/details', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { previousName, name, color, icon } = req.body ?? {};
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n
      || typeof previousName !== 'string' || !previousName
      || (name === undefined && color === undefined && icon === undefined)
      || (name !== undefined && !isEditableTagName(trimmedName))
      || (color !== undefined && (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)))
      || (icon !== undefined && !isTagIconName(icon))) {
      res.status(400).json({ error: 'Invalid tag details.' }); return;
    }
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      if (!metadataStore.updateTagDetails) { res.status(501).json({ error: 'Tag editing is not available for this library.' }); return; }
      const result = await metadataStore.updateTagDetails(id, {
        previousName,
        name: name === undefined ? undefined : trimmedName,
        color: color?.toLowerCase(),
        icon,
      });
      switch (result.status) {
        case 'missing': res.status(404).json({ error: 'Tag not found.' }); break;
        case 'stale': res.status(412).json({ error: 'The tag name has changed.' }); break;
        case 'duplicate': res.status(409).json({ error: 'A tag with this name already exists.' }); break;
        case 'updated': res.json(result.tag); break;
      }
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
        : selectAutomaticTags(normalizeSuggestedTags(await suggestBookTags({ title, availableTags, currentTags }), AUTOMATIC_TAG_MAX * 2, true), { availableTags, title });
      assertAutomaticTagQuality(suggestedTags, title, documentTag ? 1 : AUTOMATIC_TAG_MIN);
      const selectedTag = suggestedTags[0];
      const addedTags = suggestedTags.filter((tag) => !currentTags.includes(tag));
      const removedTags = currentTags.filter((tag) => isReplaceableAutomaticCategory(tag) && tag !== selectedTag);
      await applyAutomaticTags(metadataStore, { folder: req.params.folder, filename: req.params.filename, driveFileId }, { addedTags, removedTags });
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
      const results: Array<{ filename: string; driveFileId?: string; assignedTag: string; assignedTags: string[]; addedTags: string[]; removedTags: string[] }> = [];
      const errors: Array<{ filename: string; driveFileId?: string; error: string; retryable?: boolean }> = [];
      let persistedRelationCount = 0;
      // 분류는 워커 여러 개가 동시에 하지만 저장은 이 체인으로 한 줄로 세운다.
      // 두 책이 같은 새 태그 이름을 동시에 만들면 저장소에서 충돌하기 때문이다.
      let persistChain: Promise<unknown> = Promise.resolve();
      const persist = <T>(write: () => Promise<T>): Promise<T> => {
        const next = persistChain.then(write, write);
        persistChain = next.catch(() => undefined);
        return next;
      };
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
              : selectAutomaticTags(normalizeSuggestedTags(await suggestBookTags({ title, availableTags, currentTags }), AUTOMATIC_TAG_MAX * 2, true), { availableTags, title });
            assertAutomaticTagQuality(suggestedTags, title, documentTag ? 1 : AUTOMATIC_TAG_MIN);
            const selectedTag = suggestedTags[0];
            const addedTags = suggestedTags.filter((tag) => !currentTags.includes(tag));
            const removedTags = currentTags.filter((tag) => isReplaceableAutomaticCategory(tag) && tag !== selectedTag);
            // 한 책의 분류와 저장을 그 책 안에서 끝낸다. 실패한 책은 태그가 하나도 바뀌지 않는다.
            await persist(() => applyAutomaticTags(
              metadataStore,
              { folder: req.params.folder, filename: book.filename, driveFileId: book.driveFileId },
              { addedTags, removedTags },
            ));
            persistedRelationCount += addedTags.length;
            results.push({ filename: book.filename, ...(book.driveFileId ? { driveFileId: book.driveFileId } : {}), assignedTag: selectedTag, assignedTags: suggestedTags, addedTags, removedTags });
          } catch (error) {
            errors.push({
              filename: book.filename,
              ...(book.driveFileId ? { driveFileId: book.driveFileId } : {}),
              error: error instanceof Error ? error.message : String(error),
              ...(error instanceof AutomaticTagQualityError ? { retryable: false } : {}),
            });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, parsed.length) }, () => worker()));
      successful.push(...results);
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

import type { EventEmitter } from 'node:events';
import { Router, type Request, type Response } from 'express';
import { resolveMetadataStore, type MetadataStoreResolver } from './metadataStoreResolver.js';

export const TAG_FOLDER_NAME_MAX = 100;

/**
 * 태그 폴더(`/api/tag-folders`). 사이드바에서 태그를 묶어 접고 펴는 그룹이며 책 폴더와 무관하다.
 * 폴더 이름은 공백을 다듬은 뒤 1~100자이고 정확히 같은 이름은 하나만 둔다.
 * 태그가 지워지면 소속 행도 DB(ON DELETE CASCADE)에서 함께 사라진다.
 */
export function createTagFoldersRouter(metadataStoreResolver: MetadataStoreResolver, bus?: EventEmitter): Router {
  const router = Router();
  const unavailable = (res: Response) => res.status(501).json({ error: 'Tag folders are not available for this library.' });
  const changed = () => bus?.emit('change', 'tag-folders-changed');
  const fail = (res: Response, error: unknown) => res.status(500).json({ error: String(error) });

  router.get('/', async (req: Request, res: Response) => {
    try {
      const store = await resolveMetadataStore(metadataStoreResolver, req);
      if (!store.listTagFolders) { unavailable(res); return; }
      res.json(await store.listTagFolders());
    } catch (error) { fail(res, error); }
  });

  router.post('/', async (req: Request, res: Response) => {
    try {
      const store = await resolveMetadataStore(metadataStoreResolver, req);
      if (!store.createTagFolder) { unavailable(res); return; }
      const raw = (req.body as { name?: unknown } | undefined)?.name;
      const name = typeof raw === 'string' ? raw.normalize('NFC').trim() : '';
      if (!name || name.length > TAG_FOLDER_NAME_MAX) { res.status(400).json({ error: `Folder name must be 1-${TAG_FOLDER_NAME_MAX} characters.` }); return; }
      if (!(await store.createTagFolder(name))) { res.status(409).json({ error: 'A tag folder with this name already exists.' }); return; }
      changed();
      res.status(201).json({ ok: true, name });
    } catch (error) { fail(res, error); }
  });

  router.delete('/:name', async (req: Request, res: Response) => {
    try {
      const store = await resolveMetadataStore(metadataStoreResolver, req);
      if (!store.deleteTagFolder) { unavailable(res); return; }
      const removed = await store.deleteTagFolder(req.params.name);
      if (removed) changed();
      res.json({ ok: true, removed });
    } catch (error) { fail(res, error); }
  });

  router.put('/:name/tags/:tag', async (req: Request, res: Response) => {
    try {
      const store = await resolveMetadataStore(metadataStoreResolver, req);
      if (!store.addTagToTagFolder) { unavailable(res); return; }
      if (!(await store.addTagToTagFolder(req.params.name, req.params.tag))) { res.status(404).json({ error: 'Tag folder or tag not found.' }); return; }
      changed();
      res.json({ ok: true });
    } catch (error) { fail(res, error); }
  });

  router.delete('/:name/tags/:tag', async (req: Request, res: Response) => {
    try {
      const store = await resolveMetadataStore(metadataStoreResolver, req);
      if (!store.removeTagFromTagFolder) { unavailable(res); return; }
      const removed = await store.removeTagFromTagFolder(req.params.name, req.params.tag);
      if (removed) changed();
      res.json({ ok: true, removed });
    } catch (error) { fail(res, error); }
  });

  return router;
}

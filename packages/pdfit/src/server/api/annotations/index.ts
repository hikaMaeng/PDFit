import { Router, type Request, type Response, type Router as ExpressRouter } from 'express';
import type { AnnotationStyle, CreateAnnotationRequest, UpdateAnnotationRequest } from '../../../common/protocol/annotations/index.js';
import { resolveMetadataStore, type MetadataStoreResolver } from '../../routes/metadataStoreResolver.js';

const TYPES = new Set(['highlight', 'text', 'ink', 'rectangle', 'circle', 'line', 'arrow']);
function validStyle(style: unknown): style is AnnotationStyle {
  if (!style || typeof style !== 'object') return false;
  const value = style as AnnotationStyle;
  return /^#[0-9a-f]{6}$/i.test(value.color) && Number.isFinite(value.opacity) && value.opacity >= 0 && value.opacity <= 1 && Number.isFinite(value.strokeWidth) && value.strokeWidth > 0 && (value.fillColor == null || /^#[0-9a-f]{6}$/i.test(value.fillColor));
}
function finiteGeometry(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 100_000;
  if (Array.isArray(value)) return value.length <= 20_000 && value.every(finiteGeometry);
  return !!value && typeof value === 'object' && Object.values(value as Record<string, unknown>).every(finiteGeometry);
}
function validCreate(value: unknown): value is CreateAnnotationRequest {
  if (!value || typeof value !== 'object') return false;
  const body = value as CreateAnnotationRequest;
  return /^[0-9a-f-]{36}$/i.test(body.id) && typeof body.documentId === 'string' && body.documentId.length > 0 && body.documentId.length <= 4096 && Number.isInteger(body.pageIndex) && body.pageIndex >= 0 && TYPES.has(body.type) && finiteGeometry(body.geometry) && validStyle(body.style);
}

/** CRUD API for non-destructive annotations stored independently from PDF bytes. */
export function createAnnotationsRouter(storeResolver: MetadataStoreResolver): ExpressRouter {
  const router = Router();
  router.get('/', async (req: Request, res: Response) => {
    const documentId = typeof req.query.documentId === 'string' ? req.query.documentId : '';
    if (!documentId) return res.status(400).json({ error: 'documentId is required' });
    return res.json(await (await resolveMetadataStore(storeResolver, req)).listAnnotations(documentId));
  });
  router.post('/', async (req: Request, res: Response) => {
    if (!validCreate(req.body)) return res.status(400).json({ error: 'invalid annotation' });
    return res.status(201).json(await (await resolveMetadataStore(storeResolver, req)).createAnnotation(req.body));
  });
  router.patch('/:id', async (req: Request, res: Response) => {
    const body = req.body as UpdateAnnotationRequest;
    if (!body || !finiteGeometry(body.geometry) || !validStyle(body.style)) return res.status(400).json({ error: 'invalid annotation update' });
    const result = await (await resolveMetadataStore(storeResolver, req)).updateAnnotation(req.params.id, body);
    return result ? res.json(result) : res.status(404).json({ error: 'annotation not found' });
  });
  router.delete('/:id', async (req: Request, res: Response) => { await (await resolveMetadataStore(storeResolver, req)).deleteAnnotation(req.params.id); return res.status(204).end(); });
  return router;
}

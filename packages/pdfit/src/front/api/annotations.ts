import type { Annotation, CreateAnnotationRequest, UpdateAnnotationRequest } from '../../common/protocol/annotations/index.js';
import { requestWithMetadataOutbox } from '../cache/metadataOutbox.js';

const collectionPath = (documentId: string) => `/api/annotations?documentId=${encodeURIComponent(documentId)}`;

export async function listAnnotations(documentId: string): Promise<Annotation[]> {
  const response = await fetch(collectionPath(documentId));
  if (!response.ok) throw new Error('주석을 불러오지 못했습니다.');
  return response.json() as Promise<Annotation[]>;
}

export async function createAnnotation(annotation: Annotation): Promise<Annotation> {
  const request: CreateAnnotationRequest = { ...annotation, operationId: crypto.randomUUID() };
  const response = await requestWithMetadataOutbox({ operationId: request.operationId, url: '/api/annotations', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  if (!response.ok) throw new Error('주석을 저장하지 못했습니다.');
  return response.json() as Promise<Annotation>;
}

export async function updateAnnotation(annotation: Annotation): Promise<Annotation> {
  const request: UpdateAnnotationRequest = { geometry: annotation.geometry, style: annotation.style };
  const response = await requestWithMetadataOutbox({ coalesceKey: `annotation:update:${annotation.id}`, url: `/api/annotations/${encodeURIComponent(annotation.id)}`, method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  if (!response.ok) throw new Error('주석 변경을 저장하지 못했습니다.');
  return response.json() as Promise<Annotation>;
}

export async function deleteAnnotation(id: string): Promise<void> {
  const response = await requestWithMetadataOutbox({ coalesceKey: `annotation:delete:${id}`, url: `/api/annotations/${encodeURIComponent(id)}`, method: 'DELETE' });
  if (!response.ok) throw new Error('주석 삭제를 저장하지 못했습니다.');
}

export const SEMANTIC_SEARCH_PATH = '/api/search/semantic';
export const SEMANTIC_SCOPES = ['page-ocr', 'clip-ocr', 'clip-memo', 'book-comment'] as const;
export type SemanticScope = typeof SEMANTIC_SCOPES[number];

export interface EmbeddingModel {
  id?: string;
  name: string;
  dimensions: number;
  indexDimensions: number;
  embeddingConcurrency: number;
  maxInputTokens: number;
  matryoshka: boolean;
  revision: string;
  documentPrefix: string;
  queryPrefix: string;
}

export interface LanguageModelCandidate { id?: string; name: string }
export interface ModelChoice { serverId: number; modelId: string }
export interface DefaultAiModels {
  llm: ModelChoice | null;
  llmExplicit: boolean;
  embedding: ModelChoice | null;
}

export interface SemanticHit {
  id: string;
  scope: SemanticScope;
  folder: string;
  filename: string;
  page: number | null;
  snippet: string;
}

export interface SemanticSearchRequest { q: string; scope?: SemanticScope; limit?: number }
export interface SemanticSearchResult {
  status: 'unconfigured' | 'indexing' | 'ready' | 'unavailable';
  hits: SemanticHit[];
}

export function isSemanticScope(value: unknown): value is SemanticScope {
  return SEMANTIC_SCOPES.some((scope) => scope === value);
}

export function isEmbeddingModel(value: unknown): value is EmbeddingModel {
  if (!value || typeof value !== 'object') return false;
  const model = value as Partial<EmbeddingModel>;
  const integer = (x: unknown, min: number, max: number) => typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
  const text = (x: unknown, max: number) => typeof x === 'string' && x.length <= max && !x.includes('\0');
  return text(model.name, 300) && !!model.name?.trim() && (model.id === undefined || text(model.id, 100))
    && integer(model.dimensions, 1, 16_000) && integer(model.indexDimensions, 1, Math.min(model.dimensions!, 2000))
    && typeof model.matryoshka === 'boolean' && (model.dimensions === model.indexDimensions || model.matryoshka)
    && integer(model.embeddingConcurrency, 1, 64) && integer(model.maxInputTokens, 32, 262_144)
    && text(model.revision, 100) && text(model.documentPrefix, 256) && text(model.queryPrefix, 256);
}

export function parseSemanticSearchResult(value: unknown): SemanticSearchResult {
  const result = value as Partial<SemanticSearchResult> | null;
  if (!result || !['unconfigured', 'indexing', 'ready', 'unavailable'].some((status) => status === result.status)
    || !Array.isArray(result.hits) || !result.hits.every((hit) => hit && isSemanticScope(hit.scope) && typeof hit.id === 'string'
      && typeof hit.folder === 'string' && typeof hit.filename === 'string' && typeof hit.snippet === 'string'
      && (hit.page === null || Number.isInteger(hit.page)))) throw new Error('Invalid semantic search response');
  return result as SemanticSearchResult;
}

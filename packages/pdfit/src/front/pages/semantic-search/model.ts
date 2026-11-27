import { SEMANTIC_SEARCH_PATH, parseSemanticSearchResult, type SemanticHit, type SemanticScope, type SemanticSearchRequest, type SemanticSearchResult } from '../../../common/protocol/embedding-search/index.js';

export class SemanticSearchModel {
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private request?: AbortController;
  result: SemanticSearchResult | null = null;
  selected: SemanticHit | null = null;

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getVersion = () => this.version;

  private emit() { this.version += 1; this.listeners.forEach((listener) => listener()); }

  load(q: string, scope?: SemanticScope) {
    this.request?.abort();
    const controller = new AbortController();
    this.request = controller;
    this.result = null;
    this.emit();
    const body = { q, scope } satisfies SemanticSearchRequest;
    void fetch(SEMANTIC_SEARCH_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: controller.signal, body: JSON.stringify(body) }).then(async (response) => {
      if (!response.ok) throw new Error('Semantic search failed');
      return parseSemanticSearchResult(await response.json());
    }).catch((): SemanticSearchResult => ({ status: 'unavailable', hits: [] })).then((result) => {
      if (!controller.signal.aborted) { this.result = result; this.emit(); }
    });
    return () => controller.abort();
  }

  select = (hit: SemanticHit | null) => { this.selected = hit; this.emit(); };
}

export type MutationPerformancePhase =
  | 'ui'
  | 'indexeddb'
  | 'request-start'
  | 'server-response'
  | 'sync-complete'
  | 'failed';

export interface MutationPerformanceDetail {
  operation: string;
  mutationId: string;
  phase: MutationPerformancePhase;
  elapsedMs: number;
  timestamp: string;
  metadata?: Record<string, string | number | boolean>;
}

export const MUTATION_PERFORMANCE_EVENT = 'pdfit-mutation-performance';

/** Records user-perceived mutation timing without blocking the mutation itself. */
export function beginMutationPerformance(operation: string, mutationId: string = crypto.randomUUID()) {
  const startedAt = performance.now();
  const mark = (phase: MutationPerformancePhase, metadata?: MutationPerformanceDetail['metadata']) => {
    const detail: MutationPerformanceDetail = {
      operation,
      mutationId,
      phase,
      elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
      timestamp: new Date().toISOString(),
      metadata,
    };
    console.info('[mutation-performance]', JSON.stringify(detail));
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<MutationPerformanceDetail>(MUTATION_PERFORMANCE_EVENT, { detail }));
    return detail;
  };
  return { mutationId, mark };
}

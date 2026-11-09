export const TAG_SUMMARY_OPTIMISTIC_EVENT = 'pdfit-tag-summary-optimistic';

export interface TagSummaryOptimisticDetail {
  name: string;
  delta: 1 | -1;
}

/** Immediately projects a book/tag relation change into sidebar counts. */
export function publishTagSummaryOptimistic(name: string, delta: 1 | -1): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<TagSummaryOptimisticDetail>(TAG_SUMMARY_OPTIMISTIC_EVENT, {
    detail: { name, delta },
  }));
}

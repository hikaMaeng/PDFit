import { useCallback, useEffect, useState } from 'react';

/**
 * Mounts a long library list in chunks instead of all at once.
 *
 * A folder with thousands of PDFs used to mount every card in one commit: each card
 * carries a MUI subtree, an IntersectionObserver and a thumbnail request, so the first
 * paint blocked the main thread for seconds and every on-screen cover competed with
 * cards far below the fold. Here the list grows from the top, one chunk per idle slot,
 * and jumps ahead whenever the sentinel after the last rendered item comes into view,
 * so scrolling never outruns the list.
 *
 * State: `count` is the number of rendered items, lives for the duration of the mounted
 * list, is bounded by `all.length`, and is reset to the first chunk whenever `resetKey`
 * changes (a different folder, search text or view).
 */

/** One desktop grid holds about 4 rows of 6; the first chunk fills the viewport. */
const FIRST_CHUNK = 24;
const CHUNK = 24;
/** Debounce between chunks: the browser gets the gap for layout, paint and image decoding. */
const CHUNK_DELAY_MS = 32;
/** An idle slot may never come on a busy page; grow anyway after this long. */
const IDLE_TIMEOUT_MS = 300;

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export interface ProgressiveItems<T> {
  /** The items to render now: the first `count` of `all`. */
  rendered: T[];
  /** False while chunks are still being added. */
  done: boolean;
  /** Put on an element right after the rendered items so scrolling grows the list at once. */
  sentinelRef: React.RefCallback<HTMLElement | null>;
}

export function useProgressiveItems<T>(all: T[], resetKey: string): ProgressiveItems<T> {
  const total = all.length;
  const [count, setCount] = useState(() => Math.min(FIRST_CHUNK, total));
  // The node itself is state: a ref object would not re-run the observer effect, and a
  // ref callback that sets other state would run on every render.
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  const sentinelRef = useCallback((node: HTMLElement | null) => setSentinel(node), []);

  useEffect(() => {
    setCount(Math.min(FIRST_CHUNK, all.length));
    // `all` is read once per reset; following length changes are handled by the growth effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    // The list is usually empty on the first render and filled once the fetch lands;
    // the first chunk must then be mounted at once, not one idle slot later.
    if (count === 0 && total > 0) setCount(Math.min(FIRST_CHUNK, total));
  }, [count, total]);

  useEffect(() => {
    if (count >= total || count === 0) return;
    const view = window as IdleWindow;
    let idle: number | null = null;
    const grow = () => setCount((value) => Math.min(value + CHUNK, total));
    const timer = window.setTimeout(() => {
      if (typeof view.requestIdleCallback === 'function') idle = view.requestIdleCallback(grow, { timeout: IDLE_TIMEOUT_MS });
      else grow();
    }, CHUNK_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      if (idle !== null && typeof view.cancelIdleCallback === 'function') view.cancelIdleCallback(idle);
    };
  }, [count, total]);

  useEffect(() => {
    if (!sentinel || count >= total) return;
    const observer = new IntersectionObserver(([entry]) => {
      // Scrolled to the end of what is rendered: skip the idle pace and mount a wider run.
      if (entry.isIntersecting) setCount((value) => Math.min(value + CHUNK * 3, total));
    }, { rootMargin: '600px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [count, total, sentinel]);

  return {
    rendered: count >= total ? all : all.slice(0, count),
    done: count >= total,
    sentinelRef,
  };
}

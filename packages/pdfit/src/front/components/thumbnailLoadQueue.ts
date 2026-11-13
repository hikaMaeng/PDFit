import { useEffect, useState } from 'react';

/**
 * Limits how many cover thumbnails a library page loads at the same time.
 *
 * The images are files the server already rendered, but a folder with thousands of
 * cards opened one request per card the moment it scrolled into range: the browser's
 * connection pool filled with covers far from the viewport and the ones on screen
 * arrived last. Cards ask here instead and are granted in the order they asked, which
 * — with the list mounting from the top — fills the page downwards.
 *
 * State: `waiters` is the queue of cards waiting for a slot and `active` the number of
 * granted slots. Both live in the page session, are bounded by the number of mounted
 * cards, and every waiter is removed either when it is granted or when its card
 * releases (load, error, scrolled away, or unmounted).
 */

/** Six parallel loads fill a desktop grid row without starving the connection pool. */
const MAX_CONCURRENT_THUMBNAIL_LOADS = 6;
/** A stalled image must not hold its slot forever; the <img> keeps loading regardless. */
const SLOT_TIMEOUT_MS = 20_000;

interface Waiter { cancelled: boolean; granted: boolean; grant: () => void }

const waiters: Waiter[] = [];
let active = 0;

function pump(): void {
  while (active < MAX_CONCURRENT_THUMBNAIL_LOADS && waiters.length > 0) {
    const waiter = waiters.shift()!;
    if (waiter.cancelled) continue;
    active += 1;
    waiter.granted = true;
    waiter.grant();
  }
}

/** Reserves one of the parallel loads; the returned function releases or cancels it. */
export function acquireThumbnailSlot(onGranted: () => void): () => void {
  const waiter: Waiter = { cancelled: false, granted: false, grant: onGranted };
  waiters.push(waiter);
  pump();
  return () => {
    if (waiter.cancelled) return;
    waiter.cancelled = true;
    if (waiter.granted) { active -= 1; pump(); }
  };
}

/**
 * True once this card may load its thumbnail. Pass `active` as false as soon as the
 * image is loaded, failed or off screen so the slot moves on to the next card;
 * `key` re-queues the card when the image it waits for changes.
 */
export function useThumbnailSlot(wanted: boolean, key: string): boolean {
  const [granted, setGranted] = useState(false);
  useEffect(() => {
    if (!wanted) { setGranted(false); return; }
    let timer: number | null = null;
    let release: (() => void) | null = null;
    release = acquireThumbnailSlot(() => {
      setGranted(true);
      timer = window.setTimeout(() => { release?.(); release = null; }, SLOT_TIMEOUT_MS);
    });
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      release?.();
      setGranted(false);
    };
  }, [wanted, key]);
  return granted;
}

import type { WheelEvent as ReactWheelEvent } from 'react';

/** Forwards page-mode wheel input from viewer overlays to the native viewer viewport. */
export function forwardPageModeWheel(
  event: ReactWheelEvent<HTMLElement>,
  viewport: HTMLElement | null,
  pageMode: boolean,
): void {
  if (!pageMode || !viewport) return;
  const target = event.target;
  if (target instanceof Node && viewport.contains(target)) return;

  event.preventDefault();
  viewport.dispatchEvent(new WheelEvent('wheel', {
    bubbles: false,
    cancelable: true,
    ctrlKey: event.ctrlKey,
    deltaMode: event.deltaMode,
    deltaX: event.deltaX,
    deltaY: event.deltaY,
  }));
}

import { useEffect, useRef, type PointerEvent } from 'react';
import { Box, type SxProps, type Theme } from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';

interface PointerDrag {
  id: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  transfer?: DataTransfer;
  target: Element | null;
  accepted: boolean;
  frame: number;
  release: () => void;
}

function sendDragEvent(target: EventTarget, type: string, drag: PointerDrag, relatedTarget?: Element | null) {
  return !target.dispatchEvent(new DragEvent(type, {
    bubbles: true, cancelable: true, composed: true, dataTransfer: drag.transfer,
    clientX: drag.x, clientY: drag.y, relatedTarget,
  }));
}

function updateTarget(drag: PointerDrag) {
  const target = document.elementFromPoint(drag.x, drag.y);
  if (target === drag.target) return;
  if (drag.target) sendDragEvent(drag.target, 'dragleave', drag, target);
  drag.target = target;
  drag.accepted = target !== null && sendDragEvent(target, 'dragover', drag);
}

function followPointer(drag: PointerDrag) {
  const scroller = drag.target?.closest<HTMLElement>('[data-library-drop-scroll]');
  if (scroller) {
    const { top, bottom } = scroller.getBoundingClientRect();
    const edge = 30;
    if (drag.y < top + edge) scroller.scrollTop -= (top + edge - drag.y) / 3;
    if (drag.y > bottom - edge) scroller.scrollTop += (drag.y - bottom + edge) / 3;
  }
  updateTarget(drag);
  drag.frame = requestAnimationFrame(() => followPointer(drag));
}

/** Pointer capture keeps a grip drag alive when the drawer opens over the card. */
export function LibraryDragHandle({ type, payload, label, testId, sx }: {
  type: string;
  payload: object;
  label: string;
  testId: string;
  sx?: SxProps<Theme>;
}) {
  const dragRef = useRef<PointerDrag>();

  function finish(drop: boolean) {
    const drag = dragRef.current;
    dragRef.current = undefined;
    if (!drag) return;
    drag.release();
    if (!drag.transfer) return;
    cancelAnimationFrame(drag.frame);
    if (drop) {
      updateTarget(drag);
      if (drag.target && drag.accepted) sendDragEvent(drag.target, 'drop', drag);
    }
    if (drag.target) sendDragEvent(drag.target, 'dragleave', drag);
    sendDragEvent(window, 'dragend', drag);
  }

  useEffect(() => () => finish(false), []);

  function start(event: PointerEvent<HTMLSpanElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const id = event.pointerId;
    handle.setPointerCapture(id);
    const cancelOnEscape = (key: KeyboardEvent) => {
      if (key.key !== 'Escape' || !dragRef.current?.transfer) return;
      key.preventDefault();
      key.stopPropagation();
      finish(false);
    };
    window.addEventListener('keydown', cancelOnEscape, true);
    dragRef.current = {
      id, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, target: null, accepted: false, frame: 0,
      release: () => {
        window.removeEventListener('keydown', cancelOnEscape, true);
        if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
      },
    };
  }

  function move(event: PointerEvent<HTMLSpanElement>) {
    const drag = dragRef.current;
    if (drag?.id !== event.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.transfer) {
      if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
      drag.transfer = new DataTransfer();
      drag.transfer.setData(type, JSON.stringify(payload));
      sendDragEvent(window, 'dragstart', drag);
      followPointer(drag);
    } else {
      updateTarget(drag);
    }
  }

  return <Box component="span" role="img" aria-label={label} title={label} data-testid={testId}
    onPointerDown={start} onPointerMove={move}
    onPointerUp={(event) => {
      const drag = dragRef.current;
      if (drag?.id !== event.pointerId) return;
      drag.x = event.clientX;
      drag.y = event.clientY;
      finish(true);
    }}
    onPointerCancel={() => finish(false)} onLostPointerCapture={() => finish(false)}
    onDragStart={(event) => event.preventDefault()}
    onContextMenu={(event) => event.preventDefault()} onClick={(event) => event.stopPropagation()}
    sx={[{ display: 'inline-grid', placeItems: 'center', flexShrink: 0, cursor: 'grab', touchAction: 'none', userSelect: 'none', '&:active': { cursor: 'grabbing' } }, ...(Array.isArray(sx) ? sx : [sx ?? {}])]}>
    <DragIndicatorIcon aria-hidden sx={{ fontSize: 18, pointerEvents: 'none' }} />
  </Box>;
}

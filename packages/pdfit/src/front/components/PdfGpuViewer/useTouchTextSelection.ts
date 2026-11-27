import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { activePdfTextSelection, selectedPdfText } from '../../viewer/text-selection/selectionDom.js';

const PRESS_MS = 650;
const MOVE_LIMIT = 10;

type Press = { pointerId: number; x: number; y: number; timer: number; selected: boolean };

export function useTouchTextSelection(rootRef: RefObject<HTMLDivElement>, enabled: boolean) {
  const press = useRef<Press | null>(null);
  const [showCopy, setShowCopy] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const syncCopy = () => {
      if (activePdfTextSelection()?.layer !== rootRef.current) setShowCopy(false);
    };
    document.addEventListener('selectionchange', syncCopy);
    return () => {
      document.removeEventListener('selectionchange', syncCopy);
      if (press.current) clearTimeout(press.current.timer);
      press.current = null;
      setShowCopy(false);
    };
  }, [enabled, rootRef]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    const run = (event.target as Element).closest('[data-pdf-text-run]');
    const node = run?.firstChild;
    if (!node?.textContent) return;
    if (press.current) clearTimeout(press.current.timer);
    const { pointerId, clientX: x, clientY: y } = event;
    const current: Press = { pointerId, x, y, selected: false, timer: window.setTimeout(() => {
      if (activePdfTextSelection()?.layer === rootRef.current || !node.isConnected) return;
      const selection = window.getSelection();
      if (!selection) return;
      const caret = document.caretRangeFromPoint?.(x, y);
      const offset = caret?.startContainer === node ? caret.startOffset : 0;
      const text = node.textContent ?? '';
      const words = [...text.matchAll(/\S+/gu)];
      const word = words.find(({ index, 0: value }) => offset <= index + value.length) ?? words.at(-1);
      if (!word) return;
      selection.setBaseAndExtent(node, word.index, node, word.index + word[0].length);
      current.selected = true;
      setShowCopy(true);
    }, PRESS_MS) };
    press.current = current;
  };

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const current = press.current;
    if (!current || event.pointerId !== current.pointerId) return;
    clearTimeout(current.timer);
    press.current = null;
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = press.current;
    if (!current || event.pointerId !== current.pointerId) return;
    if (current.selected) {
      const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY);
      const active = activePdfTextSelection();
      if (caret && active && active.layer === rootRef.current && active.layer.contains(caret.startContainer)) {
        active.selection.extend(caret.startContainer, caret.startOffset);
      }
    } else if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > MOVE_LIMIT) {
      finish(event);
    }
  };

  const copy = async () => {
    const root = rootRef.current;
    if (!root) return;
    const text = selectedPdfText(root);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      document.execCommand('copy');
    }
  };

  return { showCopy: enabled && showCopy, copy, onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish };
}

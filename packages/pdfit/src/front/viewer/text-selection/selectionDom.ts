const TEXT_RUN = '[data-pdf-text-run]';
const TEXT_LAYER = '[data-pdf-document-text]';

function elementOf(node: Node | null) {
  return node instanceof Element ? node : node?.parentElement;
}

export function isPdfTextRun(target: EventTarget | null) {
  return target instanceof Element && target.closest(TEXT_RUN) !== null;
}

export function pdfTextCaretAt(x: number, y: number) {
  const caret = document.caretRangeFromPoint?.(x, y);
  const node = caret?.startContainer;
  if (!(node instanceof Text)) return null;
  const layer = node.parentElement?.closest(TEXT_RUN)?.closest(TEXT_LAYER);
  return layer && caret ? { layer, node, offset: caret.startOffset } : null;
}

const TEXT_DRAG_MARGIN = 6;

export function nearbyPdfTextCaret(x: number, y: number) {
  for (let distance = 1; distance <= TEXT_DRAG_MARGIN; distance++) {
    for (const probeX of [x - distance, x + distance]) {
      if (!isPdfTextRun(document.elementFromPoint(probeX, y))) continue;
      const caret = pdfTextCaretAt(probeX, y);
      if (caret) return caret;
    }
  }
  return null;
}

export function activePdfTextSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return null;
  const layer = elementOf(selection.anchorNode)?.closest(TEXT_LAYER);
  return layer && layer.contains(selection.focusNode) ? { layer, selection } : null;
}

export function selectedPdfText(layer: HTMLElement) {
  const active = activePdfTextSelection();
  if (!active || active.layer !== layer) return '';
  const range = active.selection.getRangeAt(0);
  let text = '';
  for (const run of layer.querySelectorAll<HTMLElement>(TEXT_RUN)) {
    const node = run.firstChild;
    if (!node?.textContent || !range.intersectsNode(node)) continue;
    const start = range.startContainer === node ? range.startOffset : 0;
    const end = range.endContainer === node ? range.endOffset : node.textContent.length;
    const selected = node.textContent.slice(start, end);
    if (!selected) continue;
    if (text) text += run.dataset.before ?? '';
    text += selected;
  }
  return text;
}

export function copyPdfText(event: ClipboardEvent, layer: HTMLElement) {
  if (!event.clipboardData || elementOf(event.target as Node | null)?.closest('input, textarea, [contenteditable="true"]')) return;
  const text = selectedPdfText(layer);
  if (!text) return;
  event.clipboardData.setData('text/plain', text);
  event.preventDefault();
}

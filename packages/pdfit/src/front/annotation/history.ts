import { useCallback, useState } from 'react';
import type { Annotation } from '../../common/protocol/annotations/index.js';

export type AnnotationHistory = {
  past: Annotation[][];
  present: Annotation[];
  future: Annotation[][];
};

export type AnnotationHistoryAction =
  | { type: 'commit'; annotations: Annotation[] }
  | { type: 'preview'; annotations: Annotation[] }
  | { type: 'commit-preview'; previous: Annotation[] }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; annotations: Annotation[] };

/** Pure snapshot reducer used by toolbar actions and keyboard shortcuts. */
export function reduceAnnotationHistory(history: AnnotationHistory, action: AnnotationHistoryAction): AnnotationHistory {
  if (action.type === 'preview') return { ...history, present: action.annotations };
  if (action.type === 'reset') return { past: [], present: action.annotations, future: [] };
  if (action.type === 'commit') return action.annotations === history.present ? history : { past: [...history.past, history.present], present: action.annotations, future: [] };
  if (action.type === 'commit-preview') return action.previous === history.present ? history : { past: [...history.past, action.previous], present: history.present, future: [] };
  if (action.type === 'undo') {
    const previous = history.past.at(-1);
    return previous ? { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] } : history;
  }
  const next = history.future[0];
  return next ? { past: [...history.past, history.present], present: next, future: history.future.slice(1) } : history;
}

/** Maintains page annotation snapshots without coupling history to PDFGPU rendering. */
export function useAnnotationHistory(initial: Annotation[] = []) {
  const [history, setHistory] = useState<AnnotationHistory>({ past: [], present: initial, future: [] });
  const dispatch = useCallback((action: AnnotationHistoryAction) => setHistory((current) => reduceAnnotationHistory(current, action)), []);
  return {
    annotations: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undoTarget: history.past.at(-1) ?? null,
    redoTarget: history.future[0] ?? null,
    preview: useCallback((annotations: Annotation[]) => dispatch({ type: 'preview', annotations }), [dispatch]),
    commit: useCallback((annotations: Annotation[]) => dispatch({ type: 'commit', annotations }), [dispatch]),
    commitPreview: useCallback((previous: Annotation[]) => dispatch({ type: 'commit-preview', previous }), [dispatch]),
    reset: useCallback((annotations: Annotation[]) => dispatch({ type: 'reset', annotations }), [dispatch]),
    undo: useCallback(() => dispatch({ type: 'undo' }), [dispatch]),
    redo: useCallback(() => dispatch({ type: 'redo' }), [dispatch]),
  };
}

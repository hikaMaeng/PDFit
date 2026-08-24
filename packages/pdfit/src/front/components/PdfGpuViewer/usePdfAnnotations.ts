import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation, AnnotationStyle, AnnotationTool } from '../../../common/protocol/annotations/index.js';
import { createAnnotation, deleteAnnotation, listAnnotations, updateAnnotation } from '../../api/annotations.js';
import { useAnnotationHistory } from '../../annotation/history.js';
import { DEFAULT_ANNOTATION_STYLE } from '../../annotation/model.js';

export type AnnotationSaveState = 'loading' | 'saving' | 'saved' | 'error';

/** Owns annotation tools, history, persistence, selection, and keyboard shortcuts. */
export function usePdfAnnotations(documentId: string) {
  const history = useAnnotationHistory();
  const [tool, setTool] = useState<AnnotationTool>('bookmark');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [style, setStyle] = useState<AnnotationStyle>(DEFAULT_ANNOTATION_STYLE);
  const [saveState, setSaveState] = useState<AnnotationSaveState>('loading');
  const retryRef = useRef<{ previous: Annotation[]; next: Annotation[] } | null>(null);

  const persist = useCallback(async (previous: Annotation[], next: Annotation[]) => {
    retryRef.current = { previous, next };
    setSaveState('saving');
    const previousById = new Map(previous.map((annotation) => [annotation.id, annotation]));
    const nextById = new Map(next.map((annotation) => [annotation.id, annotation]));
    try {
      await Promise.all([
        ...next.filter((annotation) => !previousById.has(annotation.id)).map(createAnnotation),
        ...next.filter((annotation) => previousById.has(annotation.id) && JSON.stringify(previousById.get(annotation.id)) !== JSON.stringify(annotation)).map(updateAnnotation),
        ...previous.filter((annotation) => !nextById.has(annotation.id)).map((annotation) => deleteAnnotation(annotation.id)),
      ]);
      retryRef.current = null;
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }, []);

  const commit = useCallback((next: Annotation[], previous?: Annotation[]) => {
    const before = previous ?? history.annotations;
    if (previous) history.commitPreview(previous); else history.commit(next);
    void persist(before, next);
  }, [history.annotations, history.commit, history.commitPreview, persist]);

  const undo = useCallback(() => {
    if (!history.undoTarget) return;
    const before = history.annotations;
    history.undo();
    setSelectedId(null);
    void persist(before, history.undoTarget);
  }, [history.annotations, history.undo, history.undoTarget, persist]);

  const redo = useCallback(() => {
    if (!history.redoTarget) return;
    const before = history.annotations;
    history.redo();
    setSelectedId(null);
    void persist(before, history.redoTarget);
  }, [history.annotations, history.redo, history.redoTarget, persist]);

  const selectTool = useCallback((nextTool: AnnotationTool) => {
    setTool(nextTool);
    setSelectedId(null);
    if (nextTool === 'highlight') setStyle({ color: '#facc15', opacity: 0.35, strokeWidth: 1, fillColor: null });
  }, []);

  const selected = history.annotations.find((annotation) => annotation.id === selectedId) ?? null;
  const displayedStyle = selected?.style ?? style;
  const updateStyle = useCallback((patch: Partial<AnnotationStyle>) => {
    const nextStyle = { ...displayedStyle, ...patch };
    setStyle(nextStyle);
    if (selectedId) commit(history.annotations.map((annotation) => annotation.id === selectedId ? { ...annotation, style: nextStyle, updatedAt: new Date().toISOString() } : annotation));
  }, [commit, displayedStyle, history.annotations, selectedId]);

  const retry = useCallback(() => {
    const pending = retryRef.current;
    if (pending) void persist(pending.previous, pending.next);
  }, [persist]);

  useEffect(() => {
    let active = true;
    setSaveState('loading');
    setSelectedId(null);
    void listAnnotations(documentId).then((loaded) => {
      if (!active) return;
      history.reset(loaded);
      setSaveState('saved');
    }).catch(() => { if (active) setSaveState('error'); });
    return () => { active = false; };
  }, [documentId, history.reset]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [redo, undo]);

  return {
    annotations: history.annotations,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    preview: history.preview,
    commit,
    undo,
    redo,
    tool,
    selectTool,
    selectedId,
    setSelectedId,
    style,
    displayedStyle,
    updateStyle,
    saveState,
    canRetry: saveState === 'error' && retryRef.current !== null,
    retry,
  };
}

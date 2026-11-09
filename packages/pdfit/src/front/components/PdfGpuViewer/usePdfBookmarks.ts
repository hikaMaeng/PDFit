import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PdfGpuCaptureResult, PdfGpuViewerController } from '@pdfgpu/core';
import type { BookmarkRecord, UpdateBookmarkRequest } from '../../../common/protocol/bookmarks/index.js';

type Options = {
  enabled: boolean;
  controller: PdfGpuViewerController | null;
  onCaptured?: (capture: PdfGpuCaptureResult) => Promise<BookmarkRecord | void>;
  onUpdated?: (id: string, request: UpdateBookmarkRequest) => Promise<void>;
  onDeleted?: (id: string) => Promise<void>;
};

async function waitForCaptureDetail(controller: PdfGpuViewerController, timeoutMs = 12000): Promise<boolean> {
  if (controller.getState().renderQuality !== 'preview') return true;
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.queueMicrotask(() => unsubscribe());
      resolve(ready);
    };
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    unsubscribe = controller.subscribe((state) => { if (state.renderQuality !== 'preview') finish(true); });
  });
}

/** Owns bookmark capture gestures, notices, editing, and deletion state. */
export function usePdfBookmarks({ enabled, controller, onCaptured, onUpdated, onDeleted }: Options) {
  const captureStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const recentTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [captureDrag, setCaptureDrag] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureNotice, setCaptureNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [recentId, setRecentId] = useState<string | null>(null);
  const [editing, setEditing] = useState<BookmarkRecord | null>(null);
  const [draft, setDraft] = useState<UpdateBookmarkRequest>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => () => {
    if (recentTimerRef.current !== null) window.clearTimeout(recentTimerRef.current);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

  useEffect(() => {
    if (enabled) return;
    captureStartRef.current = null;
    setCaptureDrag(null);
  }, [enabled]);

  const showNotice = useCallback((message: string, error: boolean) => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setCaptureNotice({ message, error });
    noticeTimerRef.current = window.setTimeout(() => { noticeTimerRef.current = null; setCaptureNotice(null); }, error ? 4200 : 2200);
  }, []);

  const pointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || !onCaptured || captureBusy || event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('button, input, textarea, select, [role="button"], [role="dialog"]')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const start = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    captureStartRef.current = start;
    setCaptureDrag({ start, end: start });
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [captureBusy, enabled, onCaptured]);

  const pointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const start = captureStartRef.current;
    if (!start) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setCaptureDrag({ start, end: { x: event.clientX - rect.left, y: event.clientY - rect.top } });
  }, [enabled]);

  const pointerUp = useCallback(async (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = captureStartRef.current;
    captureStartRef.current = null;
    setCaptureDrag(null);
    if (!enabled || !start || !controller) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const end = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (Math.abs(end.x - start.x) < 8 || Math.abs(end.y - start.y) < 8) return;
    suppressClickRef.current = true;
    setCaptureBusy(true);
    try {
      let capture: PdfGpuCaptureResult;
      try {
        capture = await controller.captureRegion(start, end, { minSize: 8 });
      } catch (error) {
        if ((error as { code?: string }).code !== 'high-resolution-not-ready' || !await waitForCaptureDetail(controller)) throw error;
        capture = await controller.captureRegion(start, end, { minSize: 8 });
      }
      const created = await onCaptured?.(capture);
      if (created) {
        if (recentTimerRef.current !== null) window.clearTimeout(recentTimerRef.current);
        setRecentId(created.id);
        recentTimerRef.current = window.setTimeout(() => { recentTimerRef.current = null; setRecentId((current) => current === created.id ? null : current); }, 3200);
        showNotice('북마크가 저장되었습니다.', false);
      }
    } catch (error) {
      const code = (error as { code?: string }).code;
      const message = error instanceof Error ? error.message : 'Bookmark capture failed';
      const userMessage = code === 'capture-too-small' ? '북마크 영역을 조금 더 크게 드래그하세요.'
        : code === 'invalid-coordinates' ? '한 페이지 안에서 북마크 영역을 드래그하세요.'
          : code === 'high-resolution-not-ready' || message.includes('high-resolution') ? '고해상도 페이지를 불러오는 중입니다. 잠시 후 다시 시도하세요.'
            : `북마크를 저장하지 못했습니다. ${message}`;
      showNotice(userMessage, true);
    } finally {
      setCaptureBusy(false);
    }
  }, [controller, enabled, onCaptured, showNotice]);

  const openEditor = useCallback((bookmark: BookmarkRecord) => {
    setEditing(bookmark);
    setDraft({ borderColor: bookmark.borderColor, fillColor: bookmark.fillColor, fillOpacity: bookmark.fillOpacity, comment: bookmark.comment });
  }, []);

  const saveEditor = useCallback(async () => {
    if (!editing || !onUpdated) return;
    await onUpdated(editing.id, draft);
    setEditing(null);
  }, [draft, editing, onUpdated]);

  const deleteItem = useCallback(async (id: string) => {
    if (!onDeleted || deletingId) return;
    setDeletingId(id);
    try { await onDeleted(id); } finally { setDeletingId(null); }
  }, [deletingId, onDeleted]);

  const cancelCapture = useCallback(() => { captureStartRef.current = null; setCaptureDrag(null); }, []);
  const suppressCaptureClick = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return { panelOpen, setPanelOpen, captureDrag, captureBusy, captureNotice, recentId, editing, setEditing, draft, setDraft, deletingId, pointerDown, pointerMove, pointerUp, cancelCapture, suppressCaptureClick, openEditor, saveEditor, deleteItem };
}

import React, { useEffect, useRef, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Box, CircularProgress } from '@mui/material';
import IconButton from '@mui/material/IconButton';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import type { BookmarkRecord } from '../../../common/protocol/bookmarks/index.js';

interface Props {
  page: PDFPageProxy;
  scale: number;
  pageNumber: number;
  eager?: boolean;
  onVisible?: (pageNumber: number) => void;
  noMargin?: boolean;
  inverted?: boolean;
  bookmarks?: BookmarkRecord[];
  onBookmarkDeleted?: (id: string) => Promise<void>;
}

export default function PdfPage({
  page, scale, pageNumber,
  eager = false, onVisible, noMargin = false, inverted = false,
  bookmarks = [], onBookmarkDeleted,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(eager);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => { if (eager) setRendered(true); }, [eager]);

  // IntersectionObserver (스크롤 모드)
  useEffect(() => {
    if (eager) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setRendered(true);
          onVisible?.(pageNumber);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [eager, pageNumber, onVisible]);

  // 캔버스 렌더링
  useEffect(() => {
    if (!rendered) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    renderTaskRef.current?.cancel();

    const viewport = page.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const task = page.render({ canvasContext: ctx, canvas, viewport });
    renderTaskRef.current = task;
    task.promise.catch(() => {});

    return () => { renderTaskRef.current?.cancel(); };
  }, [page, scale, rendered]);

  const viewport = page.getViewport({ scale });
  const width = Math.floor(viewport.width);
  const height = Math.floor(viewport.height);

  return (
    <Box
      ref={containerRef}
      data-pdf-page
      data-page-number={pageNumber}
      sx={{
        position: 'relative',
        width,
        height,
        mx: 'auto',
        mb: noMargin ? 0 : 2,
        boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
        bgcolor: inverted ? '#000' : '#fff',
        flexShrink: 0,
        transition: 'background-color 0.2s',
        overflow: 'visible',
      }}
    >
      {rendered ? (
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            filter: inverted ? 'invert(1)' : 'none',
            transition: 'filter 0.2s',
          }}
        />
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width, height }}>
          <CircularProgress size={24} />
        </Box>
      )}
      {bookmarks.map((bookmark) => (
        <Box
          key={bookmark.id}
          data-testid="legacy-bookmark-overlay"
          sx={{ position: 'absolute', left: bookmark.rect.x * scale, top: bookmark.rect.y * scale, width: bookmark.rect.width * scale, height: bookmark.rect.height * scale, boxSizing: 'border-box', border: `2px solid ${bookmark.borderColor}`, bgcolor: bookmark.fillColor ?? 'transparent', opacity: bookmark.fillColor ? bookmark.fillOpacity : 1, pointerEvents: 'none' }}
        >
          {onBookmarkDeleted && (
            <IconButton data-testid="legacy-bookmark-delete" aria-label="북마크 삭제" size="small" color="error" onClick={(event) => { event.stopPropagation(); void onBookmarkDeleted(bookmark.id); }} sx={{ position: 'absolute', top: 2, right: 2, p: 0.2, bgcolor: 'rgba(10,10,12,.65)', pointerEvents: 'auto', opacity: 0.75 }}>
              <DeleteOutlineIcon sx={{ fontSize: 16 }} />
            </IconButton>
          )}
        </Box>
      ))}
    </Box>
  );
}

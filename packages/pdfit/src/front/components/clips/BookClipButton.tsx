import { lazy, Suspense, useState, useSyncExternalStore } from 'react';
import { IconButton } from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import type { BookClipCount } from '../../../common/protocol/bookmarks/index.js';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import { bookClipCountModel } from '../../model/bookClipCountModel.js';
import type { ClipBook } from './useClipCollection.js';

const BookClipsDialog = lazy(() => import('./BookClipsDialog.js'));

const graphics = [
  new URL('./assets/book-clip-0.svg', import.meta.url).href,
  new URL('./assets/book-clip-1.svg', import.meta.url).href,
  new URL('./assets/book-clip-2.svg', import.meta.url).href,
  new URL('./assets/book-clip-3.svg', import.meta.url).href,
  new URL('./assets/book-clip-4.svg', import.meta.url).href,
  new URL('./assets/book-clip-5.svg', import.meta.url).href,
  new URL('./assets/book-clip-6.svg', import.meta.url).href,
  new URL('./assets/book-clip-7.svg', import.meta.url).href,
  new URL('./assets/book-clip-8.svg', import.meta.url).href,
  new URL('./assets/book-clip-9.svg', import.meta.url).href,
  new URL('./assets/book-clip-9-plus.svg', import.meta.url).href,
];

export default function BookClipButton({ book, disabled }: { book: ClipBook & Partial<BookClipCount>; disabled: boolean }) {
  const { t } = usePdfitI18n();
  const [open, setOpen] = useState(false);
  const count = useSyncExternalStore(bookClipCountModel.subscribe, () => {
    const latest = bookClipCountModel.get(book.folder, book.filename);
    return latest && book.clipCountRevision !== undefined && latest.clipCountRevision > book.clipCountRevision
      ? latest.clipCount
      : book.clipCount;
  }, () => book.clipCount);
  const label = t('viewBookmarks');
  const countLabel = count === undefined ? undefined : t('bookClipCount', { count });

  return <>
    <IconButton data-testid="pdf-cover-clips" data-clip-graphic={count === undefined ? undefined : count > 9 ? '9+' : count}
      aria-label={label} aria-description={countLabel} aria-haspopup="dialog" title={countLabel ?? label} disabled={disabled} size="small"
      onClick={() => setOpen(true)} sx={{ flexShrink: 0, p: .25, color: '#ffd353', pointerEvents: 'auto', '&:hover, &.Mui-focusVisible': { bgcolor: 'rgba(255,255,255,.18)' } }}>
      {count === undefined
        ? <AttachFileIcon sx={{ width: 28, height: 27 }} />
        : <img src={graphics[Math.min(count, 10)]} alt="" width={28} height={27} draggable={false} />}
    </IconButton>
    {open && <Suspense fallback={null}><BookClipsDialog book={book} onClose={() => setOpen(false)} /></Suspense>}
  </>;
}

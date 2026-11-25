import { useCallback, useState, useSyncExternalStore } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import type { CommentBook } from '../../../common/protocol/book-comments/index.js';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import BookCommentsDialog from './BookCommentsDialog.js';
import { bookCommentCountModel } from './countModel.js';
import { bookCommentsModel } from './model.js';
import { COMMENT } from './resource.js';

const graphics = [
  new URL('./assets/book-comment-0.svg', import.meta.url).href,
  new URL('./assets/book-comment-1.svg', import.meta.url).href,
  new URL('./assets/book-comment-2.svg', import.meta.url).href,
  new URL('./assets/book-comment-3.svg', import.meta.url).href,
  new URL('./assets/book-comment-4.svg', import.meta.url).href,
  new URL('./assets/book-comment-5.svg', import.meta.url).href,
  new URL('./assets/book-comment-6.svg', import.meta.url).href,
  new URL('./assets/book-comment-7.svg', import.meta.url).href,
  new URL('./assets/book-comment-8.svg', import.meta.url).href,
  new URL('./assets/book-comment-9.svg', import.meta.url).href,
  new URL('./assets/book-comment-9-plus.svg', import.meta.url).href,
];
const emptySnapshot = () => undefined;
const noopUnsubscribe = () => {};

export default function BookCommentButton({ book, disabled }: { book: CommentBook; disabled: boolean }) {
  const { folder, filename, driveFileId } = book;
  const { t } = usePdfitI18n();
  const [open, setOpen] = useState(false);
  const subscribe = useCallback((listener: () => void) => disabled ? noopUnsubscribe :
    bookCommentCountModel.subscribe({ folder, filename, driveFileId }, listener), [disabled, folder, filename, driveFileId]);
  const count = useSyncExternalStore(subscribe, () => bookCommentCountModel.get(book), emptySnapshot);
  const label = t(COMMENT.BUTTON);
  const countLabel = count === undefined ? undefined : t(COMMENT.COUNT, { count });

  return <>
    <Tooltip title={countLabel ?? label}><span>
      <IconButton aria-label={label} aria-description={countLabel} aria-haspopup="dialog" size="small" disabled={disabled}
        onClick={() => { bookCommentsModel.open(book); setOpen(true); }} sx={{ color: 'primary.main' }}>
        {count === undefined
          ? <ChatBubbleOutlineIcon fontSize="small" />
          : <img src={graphics[Math.min(count, 10)]} alt="" width={28} height={27} draggable={false} />}
      </IconButton>
    </span></Tooltip>
    {open && <BookCommentsDialog book={book} onClose={() => { bookCommentsModel.close(); setOpen(false); }} />}
  </>;
}

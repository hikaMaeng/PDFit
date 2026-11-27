import { memo, type ReactNode } from 'react';
import { Box, List } from '@mui/material';
import type { BookClipCount } from '../../common/protocol/bookmarks/index.js';
import type { TagIconName } from '../../shared/tagDetails.js';
import { foldersApi } from '../api/folders.js';
import type { BookThumbnailProps } from './BookThumbnail.js';
import { cardPropsEqual } from './cardPropsEqual.js';
import PdfCoverItem from './PdfCoverItem.js';
import PdfListItem from './PdfListItem.js';

type LibraryView = 'list' | 'covers';

export type LibraryBookProps = BookThumbnailProps & Partial<BookClipCount> & {
  size?: number;
  tags: string[];
  tagColors: Record<string, string>;
  tagIcons: Record<string, TagIconName | undefined>;
  hideFileActions?: boolean;
  autoTagging?: boolean;
  autoTagDisabled?: boolean;
  onTagDelete?: (folder: string, filename: string, tag: string) => void;
  onManageTags?: (folder: string, filename: string) => void;
  onAutoTag?: (folder: string, filename: string) => void;
  onEditMetadata?: (folder: string, filename: string) => void;
  onMove?: (folder: string, filename: string) => void;
  onDelete?: (folder: string, filename: string) => void;
  onOpenFolder?: (folder: string, event: React.MouseEvent) => void;
};

type Props = Omit<LibraryBookProps, 'url' | 'thumbnailUrl'> & { view: LibraryView; coverVersion?: number };

function LibraryBookItem({ view, coverVersion, ...book }: Props) {
  const { folder, filename, driveFileId, serverCover, modifiedAt, size } = book;
  const url = foldersApi.fileUrl(folder, filename, driveFileId);
  let thumbnailUrl = serverCover && !driveFileId
    ? foldersApi.localThumbnailUrl(folder, filename, modifiedAt, size)
    : foldersApi.thumbnailUrl(driveFileId, serverCover ? modifiedAt : undefined, serverCover ? size : undefined);
  if (thumbnailUrl && driveFileId && coverVersion) {
    thumbnailUrl += `${thumbnailUrl.includes('?') ? '&' : '?'}cover=${coverVersion}`;
  }
  const Item = view === 'list' ? PdfListItem : PdfCoverItem;
  return <Item {...book} url={url} thumbnailUrl={thumbnailUrl} />;
}

export default memo(LibraryBookItem, cardPropsEqual);

export function LibraryBookCollection({ view, listTestId, children }: { view: LibraryView; listTestId?: string; children: ReactNode }) {
  if (view === 'list') return <List disablePadding data-testid={listTestId}>{children}</List>;
  return <Box data-testid="pdf-cover-grid" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 2, px: 1, py: 1.5 }}>
    {children}
  </Box>;
}

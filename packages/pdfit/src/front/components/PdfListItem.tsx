import React from 'react';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import DeleteIcon from '@mui/icons-material/Delete';
import { useMediaQuery, useTheme } from '@mui/material';
import { DRAG_TYPE } from '../layout/LNB';
import { openViewer } from '../viewer/openViewer.js';

const DATE_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric', month: 'short', day: 'numeric',
});

const ROW_STYLE: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  minHeight: 72,
  boxSizing: 'border-box',
  borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
  contentVisibility: 'auto',
  containIntrinsicSize: '0 72px',
  cursor: 'default',
};

const CONTENT_STYLE: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minWidth: 0,
  alignItems: 'flex-start',
  gap: 16,
  padding: '12px 128px 12px 24px',
  cursor: 'default',
};

const FILE_NAME_STYLE: React.CSSProperties = {
  display: 'inline-block',
  maxWidth: '100%',
  overflow: 'hidden',
  fontWeight: 500,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const FILE_NAME_LINK_STYLE: React.CSSProperties = {
  ...FILE_NAME_STYLE,
  color: 'inherit',
  cursor: 'pointer',
  textDecoration: 'none',
  verticalAlign: 'top',
};

const META_STYLE: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  marginTop: 4,
  color: 'rgba(255, 255, 255, 0.62)',
  cursor: 'default',
  fontSize: '0.75rem',
};

const TAG_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  height: 18,
  padding: '0 6px',
  border: '1px solid rgba(34, 197, 94, 0.7)',
  borderRadius: 9,
  color: '#86efac',
  fontSize: '0.68rem',
  lineHeight: '16px',
};

const ACTIONS_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  right: 20,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  transform: 'translateY(-50%)',
};

const ICON_BUTTON_STYLE: React.CSSProperties = {
  display: 'grid',
  width: 30,
  height: 30,
  padding: 0,
  placeItems: 'center',
  border: 0,
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface PdfListItemProps {
  filename: string;
  href: string;
  folder: string;
  driveFileId?: string;
  size?: number;
  modifiedAt?: string;
  secondaryLinkLabel?: string;
  onSecondaryLink?: (folder: string, event: React.MouseEvent) => void;
  tags?: string[];
  tagColors?: Record<string, string>;
  onTagDelete?: (folder: string, filename: string, tag: string) => void;
  onManageTags?: (folder: string, filename: string) => void;
  onMove?: (folder: string, filename: string) => void;
  onDelete?: (folder: string, filename: string) => void;
  manageTagsLabel?: string;
  moveLabel?: string;
  deleteLabel?: string;
  selected?: boolean;
  onSelectionChange?: (folder: string, filename: string, selected: boolean) => void;
}

function PdfListItem({
  filename,
  href,
  folder,
  driveFileId,
  size,
  modifiedAt,
  secondaryLinkLabel,
  onSecondaryLink,
  tags,
  tagColors,
  onTagDelete,
  onManageTags,
  onMove,
  onDelete,
  manageTagsLabel,
  moveLabel,
  deleteLabel,
  selected = false,
  onSelectionChange,
}: PdfListItemProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const metaParts = [
    size !== undefined ? formatBytes(size) : null,
    modifiedAt ? `수정: ${DATE_FORMATTER.format(new Date(modifiedAt))}` : null,
  ].filter(Boolean).join(' · ');

  const stopLink = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <li style={ROW_STYLE}>
      <div
        style={{
          ...CONTENT_STYLE,
          gap: isMobile ? 10 : CONTENT_STYLE.gap,
          padding: isMobile
            ? (onSelectionChange ? '10px 100px 10px 16px' : '10px 58px 10px 16px')
            : (onSelectionChange ? '12px 164px 12px 24px' : CONTENT_STYLE.padding),
        }}
      >
        <PictureAsPdfIcon color="error" sx={{ mt: 0.25, flexShrink: 0 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <a
            href={href}
            title={`상세보기: ${filename}`}
            draggable
            style={{ ...FILE_NAME_LINK_STYLE, ...(isMobile ? { whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.35 } : {}) }}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'copyMove';
              event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ folder, filename }));
            }}
            onClick={(event) => {
              if (event.button !== 0 || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              openViewer({ folder, filename, driveFileId });
            }}
          >
            {filename}
          </a>
          <div style={META_STYLE}>
            {metaParts && <span>{metaParts}</span>}
            {secondaryLinkLabel && onSecondaryLink && (
              <button
                type="button"
                onClick={(event) => onSecondaryLink(folder, event)}
                style={{ padding: 0, border: 0, background: 'transparent', color: '#60a5fa', cursor: 'pointer', font: 'inherit' }}
              >
                {secondaryLinkLabel}
              </button>
            )}
            {tags?.map((tag) => (
              <span key={tag} style={{ ...TAG_STYLE, borderColor: tagColors?.[tag] ?? '#22c55e', color: tagColors?.[tag] ?? '#86efac' }}>
                {tag}
                {onTagDelete && (
                  <button
                    type="button"
                    onClick={(event) => { stopLink(event); onTagDelete(folder, filename, tag); }}
                    style={{ padding: 0, border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', lineHeight: 1 }}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>
      {(onManageTags || onMove || onDelete || onSelectionChange) && (
        <div style={{ ...ACTIONS_STYLE, ...(isMobile ? { right: 6, gap: 0 } : {}) }}>
          {onManageTags && (
            <button type="button" title={manageTagsLabel} aria-label={manageTagsLabel} style={{ ...ICON_BUTTON_STYLE, color: '#86efac' }} onClick={(event) => { stopLink(event); onManageTags(folder, filename); }}>
              <LocalOfferIcon fontSize="small" />
            </button>
          )}
          {onMove && (
            <button type="button" title={moveLabel} aria-label={moveLabel} style={ICON_BUTTON_STYLE} onClick={(event) => { stopLink(event); onMove(folder, filename); }}>
              <DriveFileMoveIcon fontSize="small" />
            </button>
          )}
          {onDelete && (
            <button type="button" title={deleteLabel} aria-label={deleteLabel} style={{ ...ICON_BUTTON_STYLE, color: '#f87171' }} onClick={(event) => { stopLink(event); onDelete(folder, filename); }}>
              <DeleteIcon fontSize="small" />
            </button>
          )}
          {onSelectionChange && (
            <input
              type="checkbox"
              data-testid="pdf-selection-checkbox"
              aria-label={`${filename} 선택`}
              checked={selected}
              onChange={(event) => onSelectionChange(folder, filename, event.target.checked)}
              onClick={(event) => event.stopPropagation()}
              style={{
                width: 16,
                height: 16,
                margin: '0 2px 0 4px',
                accentColor: '#3b82f6',
                cursor: 'pointer',
              }}
            />
          )}
        </div>
      )}
    </li>
  );
}

export default React.memo(PdfListItem);

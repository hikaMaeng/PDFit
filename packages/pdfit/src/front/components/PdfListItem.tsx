import React, { useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import DeleteIcon from '@mui/icons-material/Delete';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import { useMediaQuery, useTheme } from '@mui/material';
import { DRAG_TYPE } from '../layout/LNB';
import { isPendingUploadDriveFileId, openViewer } from '../viewer/openViewer.js';
import { usePdfitI18n, useTranslatedDisplayText } from '../i18n/usePdfitI18n.js';
import TagChip from './TagChip.js';
import { PDF_LIST_COLUMNS, PDF_LIST_MOBILE_COLUMNS, PDF_LIST_FREE_COLUMNS, PDF_LIST_FREE_MOBILE_COLUMNS, PDF_LIST_WIDE_LAYOUT_QUERY } from './PdfListHeader.js';
import { formatDocumentOpenedDate, getDocumentOpenedAt, subscribeDocumentOpenHistory } from '../model/documentOpenHistory.js';
import { bookMetadataApi } from '../api/bookMetadata.js';
import { cardPropsEqual } from './cardPropsEqual.js';

const ROW_STYLE: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  minHeight: 50,
  boxSizing: 'border-box',
  borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
  contentVisibility: 'auto',
  containIntrinsicSize: '0 50px',
  cursor: 'default',
};

const CONTENT_STYLE: React.CSSProperties = {
  display: 'grid',
  flex: 1,
  minWidth: 0,
  alignItems: 'center',
  columnGap: 8,
  rowGap: 8,
  padding: '6px 18px',
  cursor: 'default',
};

const FILE_NAME_STYLE: React.CSSProperties = {
  display: 'inline-block',
  maxWidth: '100%',
  overflow: 'hidden',
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
  cursor: 'default',
  fontSize: '0.75rem',
};

const ACTIONS_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
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
  transition: 'color 140ms ease, background-color 140ms ease, transform 140ms ease',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface PdfListItemProps {
  compactTagActions?: boolean;
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
  onAutoTag?: (folder: string, filename: string) => void;
  onEditMetadata?: (folder: string, filename: string) => void;
  autoTagLabel?: string;
  autoTagging?: boolean;
  autoTagDisabled?: boolean;
  onMove?: (folder: string, filename: string) => void;
  onDelete?: (folder: string, filename: string) => void;
  manageTagsLabel?: string;
  moveLabel?: string;
  deleteLabel?: string;
  selected?: boolean;
  onSelectionChange?: (folder: string, filename: string, selected: boolean) => void;
}

function DisplayText({ value }: { value: string }) {
  return <>{useTranslatedDisplayText(value)}</>;
}

function PdfListItem({
  compactTagActions = false,
  filename,
  href,
  folder,
  driveFileId,
  size,
  secondaryLinkLabel,
  onSecondaryLink,
  tags,
  tagColors,
  onManageTags,
  onTagDelete,
  onAutoTag,
  autoTagLabel,
  autoTagging = false,
  autoTagDisabled = false,
  onEditMetadata,
  onMove,
  onDelete,
  manageTagsLabel,
  moveLabel,
  deleteLabel,
  selected = false,
  onSelectionChange,
}: PdfListItemProps) {
  const { language, t } = usePdfitI18n();
  const navigate = useNavigate();
  const theme = useTheme();
  const aiAccentColor = theme.palette.mode === 'light' ? '#b7791f' : '#f59e0b';
  const isMobile = !useMediaQuery(PDF_LIST_WIDE_LAYOUT_QUERY);
  const isTablet = useMediaQuery('(min-width: 720px) and (pointer: coarse)');
  const pendingUpload = isPendingUploadDriveFileId(driveFileId);
  const openedAt = useSyncExternalStore(subscribeDocumentOpenHistory, () => getDocumentOpenedAt({ folder, filename, driveFileId }), () => null);
  const openedLabel = formatDocumentOpenedDate(openedAt, language);
  const metaParts = size !== undefined ? formatBytes(size) : '';

  const stopLink = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <li className="pdfit-pdf-row" data-selected={selected || undefined} style={{ ...ROW_STYLE, borderBottomColor: theme.palette.divider }}>
      <div
        style={{
          ...CONTENT_STYLE,
          gridTemplateColumns: compactTagActions ? (isMobile ? PDF_LIST_FREE_MOBILE_COLUMNS : PDF_LIST_FREE_COLUMNS) : (isMobile ? PDF_LIST_MOBILE_COLUMNS : PDF_LIST_COLUMNS),
          padding: isMobile ? '10px 12px' : CONTENT_STYLE.padding,
        }}
      >
        {onSelectionChange ? (
          <input
            className="pdfit-row-selection"
            type="checkbox"
            data-testid="pdf-selection-checkbox"
            aria-label={`${t('selectPdf')}: ${filename}`}
            checked={selected}
            disabled={pendingUpload}
            onChange={(event) => onSelectionChange(folder, filename, event.target.checked)}
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 16,
              height: 16,
              margin: 0,
              accentColor: theme.palette.primary.main,
              cursor: pendingUpload ? 'not-allowed' : 'pointer',
            }}
          />
        ) : <div />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div data-testid="pdf-filename-line" style={{ display: 'flex', alignItems: 'center', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: 4, minWidth: 0 }}>
          <a
            href={href}
            title={pendingUpload ? t('pdfStillUploading') : `${t('viewDetails')}: ${filename}`}
            aria-disabled={pendingUpload || undefined}
            translate="no"
            draggable={!pendingUpload}
            style={{ ...FILE_NAME_LINK_STYLE, fontFamily: theme.typography.fontFamily, fontWeight: theme.palette.mode === 'light' ? 550 : 400, letterSpacing: theme.typography.body2.letterSpacing, cursor: pendingUpload ? 'wait' : 'pointer', opacity: pendingUpload ? 0.72 : 1, ...(isMobile ? { whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.35 } : {}) }}
            onDragStart={(event) => {
              if (pendingUpload) { event.preventDefault(); return; }
              event.dataTransfer.effectAllowed = 'copyMove';
              event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ folder, filename, driveFileId }));
            }}
            onClick={(event) => {
              if (event.button !== 0 || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              openViewer({ folder, filename, driveFileId });
            }}
          >
            {filename}
          </a>

          </div>
          {tags && tags.length > 0 && (
          <div data-testid="pdf-tag-values" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-start', gap: 6, minWidth: 0, marginTop: 4 }}>
            {tags?.map((tag) => <TagChip key={tag} tag={tag} color={tagColors?.[tag]} compact plain onDelete={onTagDelete ? () => onTagDelete(folder, filename, tag) : undefined} onClick={() => navigate(`/tag/${encodeURIComponent(tag)}`)} />)}
          </div>
          )}
          {(pendingUpload || (secondaryLinkLabel && onSecondaryLink)) && <div style={{ ...META_STYLE, color: theme.palette.text.secondary }}>
            {pendingUpload && (
              <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 7px', border: `1px solid ${theme.palette.warning.main}`, borderRadius: 999, color: theme.palette.warning.dark, background: theme.palette.action.hover, fontWeight: 650 }}>
                <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: theme.palette.warning.main, animation: 'pdfit-upload-pulse 900ms ease-in-out infinite alternate' }} />
                {t('uploadPending')}
                <style>{'@keyframes pdfit-upload-pulse { from { opacity: .35; } to { opacity: 1; } }'}</style>
              </span>
            )}
            {secondaryLinkLabel && onSecondaryLink && (
              <button
                type="button"
                data-testid="pdf-folder-location"
                aria-label={`${t('folderLocation')}: ${secondaryLinkLabel}`}
                title={`${t('folderLocation')}: ${secondaryLinkLabel}`}
                onClick={(event) => onSecondaryLink(folder, event)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', border: `1px solid ${theme.palette.divider}`, borderRadius: 4, background: theme.palette.action.hover, color: theme.palette.text.secondary, cursor: 'pointer', font: 'inherit' }}
              >
                <FolderOutlinedIcon sx={{ fontSize: 13, color: theme.palette.primary.main }} />
                <span><DisplayText value={secondaryLinkLabel} /></span>
              </button>
            )}
          </div>}
        </div>
        <div data-testid="pdf-list-tags" style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 12, minWidth: 0 }}>

          <div data-testid="pdf-tag-actions" style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', justifyContent: 'flex-start', flexShrink: 0, gap: 12 }}>
          {onManageTags && (
            <button type="button" className="pdfit-row-action pdfit-row-action-tags" disabled={pendingUpload} title={pendingUpload ? t('pdfStillUploading') : manageTagsLabel} aria-label={pendingUpload ? t('pdfStillUploading') : manageTagsLabel} style={{ ...ICON_BUTTON_STYLE, display: 'inline-flex', alignItems: 'center', width: 'auto', padding: '0 2px', font: 'inherit', fontSize: '0.75rem', textDecoration: 'underline', textUnderlineOffset: 3, whiteSpace: 'nowrap', flexShrink: 0, color: theme.palette.mode === 'light' ? theme.palette.text.secondary : theme.palette.primary.main, opacity: pendingUpload ? 0.38 : 1, cursor: pendingUpload ? 'not-allowed' : 'pointer' }} onClick={(event) => { stopLink(event); if (!pendingUpload) onManageTags(folder, filename); }}>
              {t('manageTags')}
            </button>
          )}
          {onAutoTag && (
            <button
              type="button"
              className="pdfit-row-action pdfit-row-action-ai"
              disabled={pendingUpload || autoTagging || autoTagDisabled}
              data-testid="pdf-ai-auto-tag"
              title={pendingUpload ? t('pdfStillUploading') : autoTagLabel}
              aria-label={pendingUpload ? t('pdfStillUploading') : autoTagLabel}
              style={{
                ...ICON_BUTTON_STYLE,
                flexShrink: 0,
                color: aiAccentColor,
                background: autoTagging ? theme.palette.action.selected : 'transparent',
                opacity: pendingUpload || autoTagDisabled ? 0.38 : 1,
                cursor: pendingUpload || autoTagging || autoTagDisabled ? 'wait' : 'pointer',
              }}
              onClick={(event) => { stopLink(event); if (!pendingUpload && !autoTagging && !autoTagDisabled) onAutoTag(folder, filename); }}
            >
              <AutoAwesomeIcon fontSize="small" sx={autoTagging ? { animation: 'pdfit-ai-pulse 900ms ease-in-out infinite alternate', '@keyframes pdfit-ai-pulse': { from: { opacity: 0.45 }, to: { opacity: 1 } } } : undefined} />
            </button>
          )}
          </div>
        </div>
        <div data-testid="pdf-list-document-info">
          {onEditMetadata && (
            <button type="button" data-testid="pdf-document-info" className="pdfit-row-action pdfit-row-action-metadata" disabled={pendingUpload} title={pendingUpload ? t('pdfStillUploading') : t('documentInfo')} aria-label={pendingUpload ? t('pdfStillUploading') : t('documentInfo')} style={{ ...ICON_BUTTON_STYLE, width: 'auto', padding: '0 2px', font: 'inherit', fontSize: '0.75rem', textDecoration: 'underline', textUnderlineOffset: 3, whiteSpace: 'nowrap', flexShrink: 0, color: theme.palette.mode === 'light' ? theme.palette.text.secondary : theme.palette.primary.main, opacity: pendingUpload ? 0.38 : 1, cursor: pendingUpload ? 'not-allowed' : 'pointer' }} onMouseEnter={() => { if (driveFileId && !pendingUpload) bookMetadataApi.prefetch(driveFileId); }} onFocus={() => { if (driveFileId && !pendingUpload) bookMetadataApi.prefetch(driveFileId); }} onClick={(event) => { stopLink(event); if (!pendingUpload) onEditMetadata(folder, filename); }}>
              {t('documentInfo')}
            </button>
          )}
        </div>
        <time data-testid="pdf-opened-at" dateTime={openedAt ?? undefined} style={{ color: theme.palette.text.secondary, fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{openedLabel}</time>
        <span data-testid="pdf-file-size" style={{ color: theme.palette.text.secondary, fontSize: '0.75rem', textAlign: 'left' }}>{metaParts || '—'}</span>
      {(onMove || onDelete) && (
        <div className="pdfit-row-reveal pdfit-row-actions" aria-label={t('fileActions')} style={{ ...ACTIONS_STYLE, gridColumn: '2 / -1', justifyContent: 'flex-end' }}>
          {onMove && (
            <button type="button" className="pdfit-row-action pdfit-row-action-move" disabled={pendingUpload} title={pendingUpload ? t('pdfStillUploading') : moveLabel} aria-label={pendingUpload ? t('pdfStillUploading') : moveLabel} style={{ ...ICON_BUTTON_STYLE, color: theme.palette.text.secondary, opacity: pendingUpload ? 0.38 : 1, cursor: pendingUpload ? 'not-allowed' : 'pointer' }} onClick={(event) => { stopLink(event); if (!pendingUpload) onMove(folder, filename); }}>
              <DriveFileMoveIcon fontSize="small" />
            </button>
          )}
          {onDelete && (
            <button type="button" className="pdfit-row-action pdfit-row-action-delete" disabled={pendingUpload} title={pendingUpload ? t('pdfStillUploading') : deleteLabel} aria-label={pendingUpload ? t('pdfStillUploading') : deleteLabel} style={{ ...ICON_BUTTON_STYLE, color: theme.palette.text.secondary, opacity: pendingUpload ? 0.38 : 1, cursor: pendingUpload ? 'not-allowed' : 'pointer' }} onClick={(event) => { stopLink(event); if (!pendingUpload) onDelete(folder, filename); }}>
              <DeleteIcon fontSize="small" />
            </button>
          )}
        </div>
      )}
      </div>
    </li>
  );
}

export default React.memo(PdfListItem, cardPropsEqual);

import RefreshIcon from '@mui/icons-material/Refresh';
import ViewListIcon from '@mui/icons-material/ViewList';
import GridViewIcon from '@mui/icons-material/GridView';
import PdfCoverItem from '../components/PdfCoverItem';
import FolderDestinationPicker from '../components/FolderDestinationPicker';
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, List, Checkbox, ToggleButton, ToggleButtonGroup,
  CircularProgress, Alert, Chip, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  MenuItem, Select, FormControl, InputLabel, TextField, Autocomplete,
} from '@mui/material';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import LabelOffOutlinedIcon from '@mui/icons-material/LabelOffOutlined';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import DeleteIcon from '@mui/icons-material/Delete';
import { tagsApi, BookRef } from '../api/tags';
import { foldersApi, FolderInfo } from '../api/folders';
import PdfListItem from '../components/PdfListItem';
import PdfListHeader from '../components/PdfListHeader';
import LibraryFixedControls from '../components/LibraryFixedControls';
import TagColorPicker, { lastTagInputColor, rememberTagInputColor } from '../components/TagColorPicker';
import TagChip from '../components/TagChip';
import HashTagIcon from '../components/HashTagIcon';
import { folderLibraryModel } from '../model/folderLibraryModel';
import { usePdfitI18n, useTranslatedDisplayText } from '../i18n/usePdfitI18n';
import { publishTagSummaryOptimistic } from '../model/tagSummaryEvents';
import TagNoticeSnackbar, { type TagNotice } from '../components/TagNoticeSnackbar';
import SelectedDocumentActions, { type SelectedDocument } from '../components/SelectedDocumentActions';
import BookMetadataDialog, { type BookMetadataTarget } from '../components/BookMetadataDialog';
import { usePdfitFrontConfig } from '../context';
import { isPendingUploadDriveFileId } from '../viewer/openViewer';

function DisplayText({ value }: { value: string }) {
  return <>{useTranslatedDisplayText(value)}</>;
}

interface TagDialogState {
  folder: string;
  file: string;
  driveFileId?: string;
  currentTags: string[];
}

const bookIdentity = (book: Pick<BookRef, 'folder' | 'filename' | 'driveFileId'>) =>
  book.driveFileId ?? `${book.folder}/${book.filename}`;

/** `untagged`이면 `/tag/:name` 대신 태그가 하나도 없는 문서를 보여 주는 "미분류" 보기다. */
export default function TagPage({ untagged = false }: { untagged?: boolean } = {}) {
  const { t, ui } = usePdfitI18n();
  const { bookMetadataEnabled, bookResearchAccess, aiAutoTagAccess, onAiTagRemoved, serverThumbnails } = usePdfitFrontConfig();
  const canUseAiAutoTag = aiAutoTagAccess?.() ?? true;
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const tagName = untagged ? '' : decodeURIComponent(name ?? '');

  const [libraryView, setLibraryView] = useState<'list' | 'covers'>(() => localStorage.getItem('pdfit.library.view') === 'covers' ? 'covers' : 'list');
  const [refreshing, setRefreshing] = useState(false);
  const [books, setBooks] = useState<BookRef[]>([]);
  const [selectedBooks, setSelectedBooks] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tagColor, setTagColor] = useState('#22c55e');
  const [tagColors, setTagColors] = useState<Record<string, string>>({});

  /** `${folder}/${filename}` → 태그 목록 */
  const [bookTags, setBookTags] = useState<Record<string, string[]>>({});

  // ─── 이동 다이얼로그 ──────────────────────────────────────
  const [moveDialog, setMoveDialog] = useState<{ folder: string; file: string; driveFileId?: string } | null>(null);
  const [allFolders, setAllFolders] = useState<FolderInfo[]>([]);
  const [moveTarget, setMoveTarget] = useState('');
  const [moving, setMoving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ folder: string; filename: string; driveFileId?: string; files?: SelectedDocument[] } | null>(null);
  const [deletingSelection, setDeletingSelection] = useState(false);

  // ─── 태그 다이얼로그 ──────────────────────────────────────
  const [tagDialog, setTagDialog] = useState<TagDialogState | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [tagInputColor, setTagInputColor] = useState(lastTagInputColor);
  const [tagLoading, setTagLoading] = useState(false);
  const [tagMutation, setTagMutation] = useState<string | null>(null);
  const [tagNotice, setTagNotice] = useState<TagNotice | null>(null);
  const [metadataTarget, setMetadataTarget] = useState<BookMetadataTarget | null>(null);

  const selectionKeys = new Map<BookRef, string>();
  const identityOccurrences = new Map<string, number>();
  for (const book of books) {
    const identity = bookIdentity(book);
    const occurrence = identityOccurrences.get(identity) ?? 0;
    identityOccurrences.set(identity, occurrence + 1);
    selectionKeys.set(book, `${identity}\u0000${occurrence}`);
  }
  const selectionKey = (book: BookRef) => selectionKeys.get(book) ?? bookIdentity(book);

  const openDocumentMetadata = async (book: BookRef) => {
    if (isPendingUploadDriveFileId(book.driveFileId)) { setTagNotice({ message: t('pdfStillUploading'), severity: 'info' }); return; }
    let driveFileId = book.driveFileId;
    if (!driveFileId) {
      try {
        await foldersApi.refresh();
        driveFileId = (await foldersApi.listFiles(book.folder)).find((file) => file.name === book.filename)?.driveFileId;
      } catch { driveFileId = undefined; }
    }
    if (!driveFileId) { setTagNotice({ message: ui("문서 정보를 열기 위한 파일 ID를 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요."), severity: 'error' }); return; }
    setMetadataTarget({ driveFileId, filename: book.filename });
  };

  // ─── 초기 로드 ────────────────────────────────────────────
  const loadBooks = useCallback(async (background = false) => {
    if (!tagName && !untagged) return;
    if (!background) setLoading(true);
    setError(null);
    try {
      const [data, summaries] = await Promise.all([untagged ? tagsApi.listUntaggedBooks() : tagsApi.listBooks(tagName), tagsApi.listSummary()]);
      setTagColor(summaries.find((item) => item.name === tagName)?.color ?? '#22c55e');
      setTagColors(Object.fromEntries(summaries.map((item) => [item.name, item.color])));
      setBooks(data);
      setBookTags(Object.fromEntries(data.map((book) => [
        bookIdentity(book), book.tags,
      ])));
    } catch (e) {
      setError(e instanceof Error ? e.message : ui("로드 실패"));
    } finally {
      setLoading(false);
    }
  }, [tagName, untagged]);

  useEffect(() => { void loadBooks(); }, [loadBooks]);

  useEffect(() => { setSelectedBooks(new Set()); }, [tagName, untagged]);

  useEffect(() => {
    setSelectedBooks((current) => {
      const visibleKeys = new Set(books.map(selectionKey));
      const retained = new Set([...current].filter((key) => visibleKeys.has(key)));
      return retained.size === current.size ? current : retained;
    });
  }, [books]);

  useEffect(() => {
    const refreshColor = () => void tagsApi.listSummary().then((items) => {
      setTagColors(Object.fromEntries(items.map((item) => [item.name, item.color])));
      const color = items.find((item) => item.name === tagName)?.color;
      if (color) setTagColor(color);
    });
    window.addEventListener('tags-changed', refreshColor);
    return () => window.removeEventListener('tags-changed', refreshColor);
  }, [tagName]);

  // ─── 삭제 ─────────────────────────────────────────────────
  const handleDelete = useCallback((folder: string, filename: string, driveFileId?: string) => {
    setConfirmDelete({ folder, filename, driveFileId });
  }, []);

  const confirmDeleteBook = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    setDeletingSelection(true);
    try {
      const failed: SelectedDocument[] = [];
      for (const document of target.files ?? [target]) {
        try {
          await foldersApi.deleteFile(document.folder, document.filename, document.driveFileId);
          const targetIdentity = bookIdentity(document);
          setBooks((prev) => prev.filter((book) => bookIdentity(book) !== targetIdentity));
          folderLibraryModel.get(document.folder).removeFile(document.filename, document.driveFileId);
        } catch { failed.push(document); }
      }
      window.dispatchEvent(new Event('folders-changed'));
      if (failed.length) throw new Error(t('deleteSelectedPartial', { failed: failed.length }));
    } catch (e) {
      setError(e instanceof Error ? e.message : ui("삭제 실패"));
    } finally { setDeletingSelection(false); }
  };

  // ─── 이동 ─────────────────────────────────────────────────
  const openMoveDialog = useCallback(async (folder: string, filename: string, driveFileId?: string) => {
    const folders = await foldersApi.list();
    setAllFolders(folders.filter((f) => f.name !== folder));
    setMoveTarget('');
    setMoveDialog({ folder, file: filename, driveFileId });
  }, []);

  const handleMove = async () => {
    if (!moveDialog || !moveTarget) return;
    setMoving(true);
    try {
      await foldersApi.moveFile(moveDialog.folder, moveTarget, moveDialog.file, moveDialog.driveFileId);
      // 폴더가 바뀌어도 태그가 유지되므로 목록에서 폴더명만 갱신
      setBooks((prev) => prev.map((b) =>
        bookIdentity(b) === (moveDialog.driveFileId ?? `${moveDialog.folder}/${moveDialog.file}`)
          ? { ...b, folder: moveTarget }
          : b,
      ));
      const oldKey = moveDialog.driveFileId ?? `${moveDialog.folder}/${moveDialog.file}`;
      const newKey = moveDialog.driveFileId ?? `${moveTarget}/${moveDialog.file}`;
      setBookTags((prev) => {
        const { [oldKey]: tags, ...rest } = prev;
        return { ...rest, [newKey]: tags ?? [] };
      });
      folderLibraryModel.get(moveDialog.folder).removeFile(moveDialog.file, moveDialog.driveFileId);
      folderLibraryModel.invalidateFiles([moveTarget]);
      window.dispatchEvent(new Event('folders-changed'));
      setMoveDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : ui("이동 실패"));
    } finally {
      setMoving(false);
    }
  };

  // ─── 태그 다이얼로그 ──────────────────────────────────────
  const openTagDialog = useCallback(async (folder: string, filename: string, driveFileId?: string) => {
    const key = driveFileId ?? `${folder}/${filename}`;
    setTagDialog({ folder, file: filename, driveFileId, currentTags: bookTags[key] ?? [] });
    setTagLoading(true);
    setTagInput('');
    try {
      const [currentTags, globalTags, summaries] = await Promise.all([
        tagsApi.listForBook(folder, filename, driveFileId),
        tagsApi.list(),
        tagsApi.listSummary(),
      ]);
      setTagDialog({ folder, file: filename, driveFileId, currentTags });
      setAllTags(globalTags);
      setTagColors(Object.fromEntries(summaries.map((item) => [item.name, item.color])));
      setBookTags((prev) => ({ ...prev, [key]: currentTags }));
    } catch {
      setError(ui("태그 로드 실패"));
    } finally {
      setTagLoading(false);
    }
  }, [bookTags]);

  const handleAddTag = async (tag: string) => {
    if (!tagDialog || !tag.trim() || tagMutation) return false;
    const trimmed = tag.trim();
    const isNewTag = !allTags.includes(trimmed);
    if (tagDialog.currentTags.includes(trimmed)) {
      setTagInput('');
      setTagNotice({ message: ui("\"{p0}\"은(는) 이미 추가된 태그입니다.", { p0: trimmed }), severity: 'info' });
      return true;
    }
    const { folder, file, driveFileId } = tagDialog;
    const key = driveFileId ?? `${folder}/${file}`;
    setTagMutation(trimmed);
    setTagNotice({ message: ui("\"{p0}\" 태그를 추가하는 중입니다…", { p0: trimmed }), severity: 'info' });
    try {
      await tagsApi.addTag(folder, file, trimmed, driveFileId);
      if (isNewTag) {
        try {
          await tagsApi.updateColor(trimmed, tagInputColor);
          setTagColors((current) => ({ ...current, [trimmed]: tagInputColor }));
        } catch {
          setTagNotice({ message: ui("태그는 추가했지만 색상을 저장하지 못했습니다."), severity: 'error' });
          window.dispatchEvent(new Event('tags-changed'));
          return true;
        }
      }
    setTagDialog((prev) => prev ? { ...prev, currentTags: [...prev.currentTags, trimmed] } : prev);
    setBookTags((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), trimmed] }));
    setAllTags((prev) => prev.includes(trimmed) ? prev : [...prev, trimmed].sort());
    publishTagSummaryOptimistic(trimmed, 1);
    setTagInput('');
    folderLibraryModel.get(folder).addTag(file, trimmed, driveFileId);
    // 미분류 목록에서는 태그가 붙은 순간 더 이상 미분류가 아니므로 목록에서 뺀다.
    if (untagged) setBooks((prev) => prev.filter((book) => bookIdentity(book) !== key));
        window.dispatchEvent(new Event('tags-changed'));
      setTagNotice({ message: ui("\"{p0}\" 태그가 추가되었습니다.", { p0: trimmed }), severity: 'success' });
      return true;
    } catch (e) {
      await tagsApi.restoreCachedRelation(folder, file, trimmed, false, driveFileId);
      setTagDialog((prev) => prev ? { ...prev, currentTags: prev.currentTags.filter((item) => item !== trimmed) } : prev);
      setBookTags((prev) => ({ ...prev, [key]: (prev[key] ?? []).filter((item) => item !== trimmed) }));
      folderLibraryModel.get(folder).removeTag(file, trimmed, driveFileId);
      const message = e instanceof Error ? e.message : ui("태그 추가 실패");
      setTagNotice({ message: ui("태그를 추가하지 못했습니다. {p0}", { p0: message }), severity: 'error' });
      return false;
    } finally {
      setTagMutation(null);
    }
  };

  const handleCloseTagDialog = async () => {
    if (tagMutation) return;
    if (tagInput.trim() && !tagDialog?.currentTags.includes(tagInput.trim())) {
      void handleAddTag(tagInput);
    }
    setTagDialog(null);
    setTagInput('');
  };

  const handleRemoveTag = async (tag: string) => {
    if (!tagDialog || tagMutation) return;
    const { folder, file, driveFileId } = tagDialog;
    const key = driveFileId ?? `${folder}/${file}`;
    const removedBook = books.find((book) => bookIdentity(book) === key);
    setTagMutation(tag);
    setTagNotice({ message: ui("\"{p0}\" 태그를 삭제하는 중입니다…", { p0: tag }), severity: 'info' });
    setTagDialog((prev) => prev ? { ...prev, currentTags: prev.currentTags.filter((item) => item !== tag) } : prev);
    setBookTags((prev) => ({ ...prev, [key]: (prev[key] ?? []).filter((item) => item !== tag) }));
    publishTagSummaryOptimistic(tag, -1);
    if (tag === tagName) setBooks((prev) => prev.filter((book) => bookIdentity(book) !== key));
    folderLibraryModel.get(folder).removeTag(file, tag, driveFileId);
    try {
      await tagsApi.removeTag(folder, file, tag, driveFileId);
      await onAiTagRemoved?.({ folder, filename: file, driveFileId, tag });
      window.dispatchEvent(new Event('tags-changed'));
      setTagNotice({ message: ui("\"{p0}\" 태그가 삭제되었습니다.", { p0: tag }), severity: 'success' });
    } catch (e) {
      await tagsApi.restoreCachedRelation(folder, file, tag, true, driveFileId);
      setTagDialog((prev) => prev && !prev.currentTags.includes(tag) ? { ...prev, currentTags: [...prev.currentTags, tag] } : prev);
      setBookTags((prev) => ({ ...prev, [key]: (prev[key] ?? []).includes(tag) ? (prev[key] ?? []) : [...(prev[key] ?? []), tag] }));
      publishTagSummaryOptimistic(tag, 1);
      if (tag === tagName && removedBook) setBooks((prev) => prev.some((book) => bookIdentity(book) === key) ? prev : [...prev, removedBook]);
      folderLibraryModel.get(folder).addTag(file, tag, driveFileId);
      const message = e instanceof Error ? e.message : ui("태그 삭제 실패");
      setTagNotice({ message: ui("태그를 삭제하지 못했습니다. {p0}", { p0: message }), severity: 'error' });
    } finally {
      setTagMutation(null);
    }
  };

  const handleInlineRemoveTag = useCallback(async (folder: string, filename: string, tag: string, driveFileId?: string) => {
    if (tagMutation) return;
    const key = driveFileId ?? `${folder}/${filename}`;
    const removedBook = books.find((book) => bookIdentity(book) === key);
    setTagMutation(tag);
    setTagNotice({ message: ui("\"{p0}\" 태그를 삭제하는 중입니다…", { p0: tag }), severity: 'info' });
    setBookTags((prev) => ({ ...prev, [key]: (prev[key] ?? []).filter((item) => item !== tag) }));
    if (tag === tagName) setBooks((prev) => prev.filter((book) => bookIdentity(book) !== key));
    folderLibraryModel.get(folder).removeTag(filename, tag, driveFileId);
    try {
      await tagsApi.removeTag(folder, filename, tag, driveFileId);
      await onAiTagRemoved?.({ folder, filename, driveFileId, tag });
      window.dispatchEvent(new Event('tags-changed'));
      setTagNotice({ message: ui("\"{p0}\" 태그가 삭제되었습니다.", { p0: tag }), severity: 'success' });
    } catch (e) {
      await tagsApi.restoreCachedRelation(folder, filename, tag, true, driveFileId);
      setBookTags((prev) => ({ ...prev, [key]: (prev[key] ?? []).includes(tag) ? (prev[key] ?? []) : [...(prev[key] ?? []), tag] }));
      if (tag === tagName && removedBook) setBooks((prev) => prev.some((book) => bookIdentity(book) === key) ? prev : [...prev, removedBook]);
      folderLibraryModel.get(folder).addTag(filename, tag, driveFileId);
      const message = e instanceof Error ? e.message : ui("태그 삭제 실패");
      setTagNotice({ message: ui("태그를 삭제하지 못했습니다. {p0}", { p0: message }), severity: 'error' });
    } finally {
      setTagMutation(null);
    }
  }, [books, tagMutation, tagName]);

  const handleCoverAutoTag = async (book: BookRef) => {
    if (!canUseAiAutoTag || tagMutation !== null) return;
    setTagMutation(`ai:${bookIdentity(book)}`);
    try {
      await tagsApi.autoTag(book.folder, book.filename, book.driveFileId);
      await loadBooks(true);
      window.dispatchEvent(new Event('tags-changed'));
    } catch (error) { setError(error instanceof Error ? error.message : t('aiTaggingFailed')); }
    finally { setTagMutation(null); }
  };

  const openFolder = useCallback((folder: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    navigate(`/folder/${encodeURIComponent(folder)}`);
  }, [navigate]);

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      {/* 헤더 */}
      <Box sx={{ px: 1, py: 0, mb: 0.5 }}>
        <Box data-testid="tag-title-row" sx={{ display: 'flex', alignItems: 'center', gap: 1, '& > .MuiIconButton-root': { p: 0 } }}>
          {untagged
            ? <LabelOffOutlinedIcon aria-hidden data-testid="untagged-title-icon" sx={{ fontSize: 28, color: 'text.secondary' }} />
            : <TagColorPicker icon={<Typography component="span" sx={{ fontSize: 28, fontWeight: 700, color: tagColor }}>#</Typography>} color={tagColor} size="medium" onChange={(color) => void tagsApi.updateColor(tagName, color).then(() => { setTagColor(color); window.dispatchEvent(new Event('tags-changed')); })} />}
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="h5" fontWeight={700} data-testid={untagged ? 'untagged-title' : undefined}>{untagged ? t('untagged') : <DisplayText value={tagName} />}</Typography>
            <Chip data-testid="tag-document-count" label={t('pdfCount', { count: books.length })} size="small" color="primary" variant="outlined" sx={{ borderRadius: '4px', fontWeight: 600 }} />
          </Box>
          <Button data-testid="tag-refresh" size="small" variant="outlined" startIcon={<RefreshIcon />} disabled={refreshing} onClick={async () => { setRefreshing(true); try { await loadBooks(true); } finally { setRefreshing(false); } }} sx={{ ml: 'auto' }}>{t('refresh')}</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {/* PDF 목록 */}
      <Box>
        {books.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <PictureAsPdfIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
            <Typography color="text.secondary">{untagged ? t('noUntaggedPdfs') : t('noTaggedPdfs')}</Typography>
          </Box>
        ) : (
          <>
          <LibraryFixedControls>
          <Box data-testid="tag-list-toolbar" role="toolbar" aria-label={t('bookList')} sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, px: 1, py: .5, borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider' }}>
            <ToggleButtonGroup exclusive size="small" value={libraryView} onChange={(_, value: 'list' | 'covers' | null) => { if (value) { setLibraryView(value); localStorage.setItem('pdfit.library.view', value); } }} sx={{ ml: 'auto' }}>
              <ToggleButton value="list" aria-label={t('listView')}><ViewListIcon fontSize="small" /></ToggleButton>
              <ToggleButton value="covers" aria-label={t('coverView')}><GridViewIcon fontSize="small" /></ToggleButton>
            </ToggleButtonGroup>
          </Box>
          {libraryView === 'list' && <PdfListHeader compactTagActions={!canUseAiAutoTag} />}
          </LibraryFixedControls>
          {libraryView === 'list' ? <List disablePadding>
            {books.map((book) => {
              const key = selectionKey(book);
              const identity = bookIdentity(book);
              return (
                <PdfListItem compactTagActions={!canUseAiAutoTag}
                  key={key}
                  filename={book.filename}
                  href={`/viewer/${encodeURIComponent(book.folder)}/${encodeURIComponent(book.filename)}${book.driveFileId ? `?driveFileId=${encodeURIComponent(book.driveFileId)}` : ''}`}
                  folder={book.folder}
                  driveFileId={book.driveFileId}
                  size={book.size}
                  tags={bookTags[identity] ?? []}
                  tagColors={tagColors}
                  onTagDelete={(folder, filename, tag) => handleInlineRemoveTag(folder, filename, tag, book.driveFileId)}
                  onManageTags={(folder, filename) => openTagDialog(folder, filename, book.driveFileId)}
                  onEditMetadata={bookMetadataEnabled && !isPendingUploadDriveFileId(book.driveFileId) ? () => void openDocumentMetadata(book) : undefined}
                  manageTagsLabel={t('manageTags')}
                  moveLabel={t('moveToFolder')}
                  deleteLabel={t('delete')}
                />
              );
            })}
          </List> : <Box data-testid="pdf-cover-grid" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 2, px: 1, py: 1.5 }}>
            {books.map(book => <PdfCoverItem key={bookIdentity(book)} filename={book.filename} folder={book.folder} driveFileId={book.driveFileId} size={book.size} url={foldersApi.fileUrl(book.folder, book.filename, book.driveFileId)} serverCover={serverThumbnails} thumbnailUrl={!serverThumbnails ? foldersApi.thumbnailUrl(book.driveFileId) : book.driveFileId ? foldersApi.thumbnailUrl(book.driveFileId, book.modified_at, book.size) : foldersApi.localThumbnailUrl(book.folder, book.filename, book.modified_at, book.size)} tags={bookTags[bookIdentity(book)] ?? []} tagColors={tagColors} selected={false} hideSelection onSelectionChange={() => {}} onMove={(folder, filename) => void openMoveDialog(folder, filename, book.driveFileId)} onDelete={(folder, filename) => setConfirmDelete({ folder, filename, driveFileId: book.driveFileId })} onAutoTag={canUseAiAutoTag ? () => void handleCoverAutoTag(book) : undefined} autoTagging={tagMutation === `ai:${bookIdentity(book)}`} autoTagDisabled={tagMutation !== null} onTagDelete={(folder, filename, tag) => handleInlineRemoveTag(folder, filename, tag, book.driveFileId)} onManageTags={(folder, filename) => openTagDialog(folder, filename, book.driveFileId)} onEditMetadata={bookMetadataEnabled ? () => void openDocumentMetadata(book) : undefined} />)}
          </Box>}
          </>
        )}
      </Box>

      <BookMetadataDialog
        target={metadataTarget}
        onClose={() => setMetadataTarget(null)}
        onCoverChanged={() => window.dispatchEvent(new Event('folders-changed'))}
        canUseAiResearch={bookResearchAccess?.() ?? false}
        onUpgrade={() => { setMetadataTarget(null); navigate('/pricing'); }}
      />

      {/* 이동 다이얼로그 */}
      <Dialog open={!!moveDialog} onClose={() => setMoveDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('moveToFolder')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('chooseMoveFolder')}
            <Box component="span" data-testid="move-document-filename" sx={{ display: 'block', mt: .75, overflowWrap: 'anywhere' }}>{ui("파일명")} : <Box component="span" translate="no">{moveDialog?.file}</Box></Box>
          </Typography>
          <FolderDestinationPicker folders={allFolders} value={moveTarget} onChange={setMoveTarget} disabled={moving} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoveDialog(null)} disabled={moving}>{t('cancel')}</Button>
          <Button variant="contained" onClick={handleMove} disabled={!moveTarget || moving}>
            {moving ? t('moving') : t('move')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('deleteConfirmation')}</DialogTitle>
        <DialogContent><Typography translate="no">{confirmDelete?.files ? t('deleteSelectedPdfsQuestion', { count: confirmDelete.files.length }) : t('deletePdfQuestion', { name: confirmDelete?.filename ?? '' })}</Typography></DialogContent>
        <DialogActions>
          <Button color="error" onClick={() => setConfirmDelete(null)}>{t('cancel')}</Button>
          <Button color="error" variant="contained" sx={{ bgcolor: "error.dark", "&:hover": { bgcolor: "error.main" } }} onClick={() => void confirmDeleteBook()}>{t('delete')}</Button>
        </DialogActions>
      </Dialog>

      {/* 태그 관리 다이얼로그 */}
      <Dialog
        open={!!tagDialog}
        disableAutoFocus
        onClose={() => void handleCloseTagDialog()}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <HashTagIcon color="primary" fontSize="small" />
            {t('manageTags')}
          </Box>
        </DialogTitle>
        <DialogContent>
          {tagLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <>
              <Typography variant="caption" color="text.secondary" translate="no" sx={{ display: 'block', mb: 1 }}>
                {ui("파일명 :")}{' '}{tagDialog?.file}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2, minHeight: 32 }}>
                {tagDialog?.currentTags.length === 0 ? (
                  <Typography variant="caption" color="text.disabled">{t('noTags')}</Typography>
                ) : (
                  tagDialog?.currentTags.map((tag) => (
                    <TagChip hashLabel key={tag} tag={tag} color={tagColors[tag]} disabled={tagMutation !== null} onDelete={() => void handleRemoveTag(tag)} />
                  ))
                )}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Autocomplete
                  freeSolo
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                    event.preventDefault();
                    (event as typeof event & { defaultMuiPrevented?: boolean }).defaultMuiPrevented = true;
                    const input = (event.target as HTMLInputElement).value ?? tagInput;
                    if (input.trim()) void handleAddTag(input);
                  }}
                  fullWidth
                  value={null}
                  disabled={tagMutation !== null}
                  options={allTags.filter((t) => !tagDialog?.currentTags.includes(t))}
                  inputValue={tagInput}
                  onInputChange={(_e, val, reason) => {
                    if (reason === 'input' || reason === 'clear') setTagInput(val);
                  }}
                  onChange={(_e, val) => { if (val) void handleAddTag(val); }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label={t('addTag')}
                      InputLabelProps={{ shrink: true }}
                      inputProps={{ ...params.inputProps, 'aria-label': t('addTag') }}
                      size="small"
                      placeholder={t('addTagPlaceholder')}
                      sx={{ '& .MuiOutlinedInput-root fieldset': { borderColor: 'text.secondary' }, '& .MuiInputLabel-root': { color: 'text.secondary' }, '& input::placeholder': { color: 'text.secondary', opacity: 1 }, '&:hover .MuiOutlinedInput-root:not(.Mui-disabled) fieldset, & .MuiOutlinedInput-root.Mui-focused fieldset': { borderColor: '#3b82f6' }, '&:hover .MuiInputLabel-root:not(.Mui-disabled), & .MuiInputLabel-root.Mui-focused': { color: '#3b82f6' } }}
                    />
                  )}
                />
                <TagColorPicker color={tagInputColor} onChange={(color) => { setTagInputColor(color); rememberTagInputColor(color); }} label={ui("새 태그 색상")} variant="swatch" />
                <Button data-testid="add-tag-button" variant="contained" size="small" disabled={tagMutation !== null} onClick={(event) => { if (tagInput.trim()) void handleAddTag(tagInput); else event.currentTarget.parentElement?.querySelector('input')?.focus(); }} sx={{ flexShrink: 0, bgcolor: '#3b82f6', color: '#ffffff', '&:hover': { bgcolor: '#2563eb' } }}>{ui("추가")}</Button>
              </Box>
              {!canUseAiAutoTag && <Typography data-testid="pdf-auto-classify-access-guide" variant="body2" color="text.secondary" sx={{ mt: 2, fontSize: 14, lineHeight: 1.6 }}>{ui('유료 이용권 결제 시 AI 자동태그를 사용할 수 있습니다.')}</Typography>}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={tagMutation !== null} onClick={() => void handleCloseTagDialog()}>{t('close')}</Button>
        </DialogActions>
      </Dialog>
      <TagNoticeSnackbar notice={tagNotice} onClose={() => setTagNotice(null)} />
    </Box>
  );
}

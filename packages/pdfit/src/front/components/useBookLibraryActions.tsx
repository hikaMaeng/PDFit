import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Autocomplete, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography,
} from '@mui/material';
import FolderDestinationPicker from './FolderDestinationPicker.js';
import HashTagIcon from './HashTagIcon.js';
import TagChip from './TagChip.js';
import TagColorPicker, { lastTagInputColor, rememberTagInputColor } from './TagColorPicker.js';
import TagNoticeSnackbar, { type TagNotice } from './TagNoticeSnackbar.js';
import BookMetadataDialog, { type BookMetadataTarget } from './BookMetadataDialog.js';
import { foldersApi, type FolderInfo } from '../api/folders.js';
import { tagsApi, type BookRef } from '../api/tags.js';
import { folderLibraryModel } from '../model/folderLibraryModel.js';
import { publishTagSummaryOptimistic } from '../model/tagSummaryEvents.js';
import { usePdfitFrontConfig } from '../context.js';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';
import { isPendingUploadDriveFileId } from '../viewer/openViewer.js';

export const bookActionIdentity = (book: Pick<BookRef, 'folder' | 'filename' | 'driveFileId'>) =>
  book.driveFileId ?? `${book.folder}/${book.filename}`;

interface TagDialogState {
  folder: string;
  file: string;
  driveFileId?: string;
  currentTags: string[];
}

export interface BookLibraryActions {
  /** 카드·행에 넘길 태그 목록(낙관적 갱신 반영). */
  tagsOf: (book: BookRef) => string[];
  tagColors: Record<string, string>;
  setTagColors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  canUseAiAutoTag: boolean;
  bookMetadataEnabled: boolean;
  /** `ai:<identity>`면 그 책의 자동 태그가 진행 중이다. */
  tagMutation: string | null;
  openMoveDialog: (folder: string, filename: string, driveFileId?: string) => Promise<void>;
  requestDelete: (folder: string, filename: string, driveFileId?: string) => void;
  openTagDialog: (folder: string, filename: string, driveFileId?: string) => Promise<void>;
  removeTagInline: (folder: string, filename: string, tag: string, driveFileId?: string) => Promise<void>;
  autoTag: (book: BookRef) => Promise<void>;
  openDocumentMetadata: (book: BookRef) => Promise<void>;
  /** 페이지 어딘가에 한 번 렌더해야 하는 다이얼로그·알림 묶음. */
  dialogs: React.ReactNode;
}

/**
 * 폴더·태그·검색 등 "책 목록" 화면이 공통으로 쓰는 문서 조작(이동·삭제·태그 관리·AI 자동태그·문서 정보)을
 * 한곳에 모은 훅. 목록 상태(`books`)는 호출한 쪽이 소유하고, 이 훅은 그 목록을 낙관적으로 갱신한다.
 */
export function useBookLibraryActions(options: {
  books: BookRef[];
  setBooks: React.Dispatch<React.SetStateAction<BookRef[]>>;
  tagColors: Record<string, string>;
  setTagColors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  reload: (background: boolean) => Promise<void>;
  onError: (message: string) => void;
}): BookLibraryActions {
  const { books, setBooks, tagColors, setTagColors, reload, onError } = options;
  const { t, ui } = usePdfitI18n();
  const navigate = useNavigate();
  const { aiAutoTagAccess, bookMetadataEnabled, bookResearchAccess, onAiTagRemoved } = usePdfitFrontConfig();
  const canUseAiAutoTag = aiAutoTagAccess?.() ?? true;

  /** identity → 태그 목록. 서버 응답(book.tags)을 덮어쓰는 낙관적 값만 담는다. */
  const [tagOverrides, setTagOverrides] = useState<Record<string, string[]>>({});
  const [moveDialog, setMoveDialog] = useState<{ folder: string; file: string; driveFileId?: string } | null>(null);
  const [allFolders, setAllFolders] = useState<FolderInfo[]>([]);
  const [moveTarget, setMoveTarget] = useState('');
  const [moving, setMoving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ folder: string; filename: string; driveFileId?: string } | null>(null);
  const [tagDialog, setTagDialog] = useState<TagDialogState | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [tagInputColor, setTagInputColor] = useState(lastTagInputColor);
  const [tagLoading, setTagLoading] = useState(false);
  const [tagMutation, setTagMutation] = useState<string | null>(null);
  const [tagNotice, setTagNotice] = useState<TagNotice | null>(null);
  const [metadataTarget, setMetadataTarget] = useState<BookMetadataTarget | null>(null);

  const tagsOf = useCallback((book: BookRef) => tagOverrides[bookActionIdentity(book)] ?? book.tags, [tagOverrides]);
  const currentTagsOf = useCallback((key: string) => tagOverrides[key] ?? books.find((book) => bookActionIdentity(book) === key)?.tags ?? [], [books, tagOverrides]);

  // ─── 삭제 ─────────────────────────────────────────────────
  const requestDelete = useCallback((folder: string, filename: string, driveFileId?: string) => {
    setConfirmDelete({ folder, filename, driveFileId });
  }, []);

  const confirmDeleteBook = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await foldersApi.deleteFile(target.folder, target.filename, target.driveFileId);
      const identity = bookActionIdentity(target);
      setBooks((prev) => prev.filter((book) => bookActionIdentity(book) !== identity));
      folderLibraryModel.get(target.folder).removeFile(target.filename, target.driveFileId);
      window.dispatchEvent(new Event('folders-changed'));
    } catch (e) {
      onError(e instanceof Error ? e.message : ui("삭제 실패"));
    }
  };

  // ─── 이동 ─────────────────────────────────────────────────
  const openMoveDialog = useCallback(async (folder: string, filename: string, driveFileId?: string) => {
    const folders = await foldersApi.list();
    setAllFolders(folders.filter((item) => item.name !== folder));
    setMoveTarget('');
    setMoveDialog({ folder, file: filename, driveFileId });
  }, []);

  const handleMove = async () => {
    if (!moveDialog || !moveTarget) return;
    setMoving(true);
    try {
      await foldersApi.moveFile(moveDialog.folder, moveTarget, moveDialog.file, moveDialog.driveFileId);
      const oldKey = bookActionIdentity({ folder: moveDialog.folder, filename: moveDialog.file, driveFileId: moveDialog.driveFileId });
      const newKey = bookActionIdentity({ folder: moveTarget, filename: moveDialog.file, driveFileId: moveDialog.driveFileId });
      setBooks((prev) => prev.map((book) => bookActionIdentity(book) === oldKey ? { ...book, folder: moveTarget } : book));
      setTagOverrides((prev) => {
        if (oldKey === newKey || !(oldKey in prev)) return prev;
        const { [oldKey]: tags, ...rest } = prev;
        return { ...rest, [newKey]: tags ?? [] };
      });
      folderLibraryModel.get(moveDialog.folder).removeFile(moveDialog.file, moveDialog.driveFileId);
      folderLibraryModel.invalidateFiles([moveTarget]);
      window.dispatchEvent(new Event('folders-changed'));
      setMoveDialog(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : ui("이동 실패"));
    } finally {
      setMoving(false);
    }
  };

  // ─── 태그 다이얼로그 ──────────────────────────────────────
  const openTagDialog = useCallback(async (folder: string, filename: string, driveFileId?: string) => {
    const key = bookActionIdentity({ folder, filename, driveFileId });
    setTagDialog({ folder, file: filename, driveFileId, currentTags: currentTagsOf(key) });
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
      setTagOverrides((prev) => ({ ...prev, [key]: currentTags }));
    } catch {
      onError(ui("태그 로드 실패"));
    } finally {
      setTagLoading(false);
    }
  }, [currentTagsOf, setTagColors]);

  const handleAddTag = async (tag: string) => {
    if (!tagDialog || !tag.trim() || tagMutation) return;
    const trimmed = tag.trim();
    const isNewTag = !allTags.includes(trimmed);
    if (tagDialog.currentTags.includes(trimmed)) {
      setTagInput('');
      setTagNotice({ message: ui("\"{p0}\"은(는) 이미 추가된 태그입니다.", { p0: trimmed }), severity: 'info' });
      return;
    }
    const { folder, file, driveFileId } = tagDialog;
    const key = bookActionIdentity({ folder, filename: file, driveFileId });
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
          return;
        }
      }
      setTagDialog((prev) => prev ? { ...prev, currentTags: [...prev.currentTags, trimmed] } : prev);
      setTagOverrides((prev) => ({ ...prev, [key]: [...currentTagsOf(key), trimmed] }));
      setAllTags((prev) => prev.includes(trimmed) ? prev : [...prev, trimmed].sort());
      publishTagSummaryOptimistic(trimmed, 1);
      setTagInput('');
      folderLibraryModel.get(folder).addTag(file, trimmed, driveFileId);
      window.dispatchEvent(new Event('tags-changed'));
      setTagNotice({ message: ui("\"{p0}\" 태그가 추가되었습니다.", { p0: trimmed }), severity: 'success' });
    } catch (e) {
      await tagsApi.restoreCachedRelation(folder, file, trimmed, false, driveFileId);
      setTagDialog((prev) => prev ? { ...prev, currentTags: prev.currentTags.filter((item) => item !== trimmed) } : prev);
      setTagOverrides((prev) => ({ ...prev, [key]: currentTagsOf(key).filter((item) => item !== trimmed) }));
      folderLibraryModel.get(folder).removeTag(file, trimmed, driveFileId);
      const message = e instanceof Error ? e.message : ui("태그 추가 실패");
      setTagNotice({ message: ui("태그를 추가하지 못했습니다. {p0}", { p0: message }), severity: 'error' });
    } finally {
      setTagMutation(null);
    }
  };

  const handleCloseTagDialog = () => {
    if (tagMutation) return;
    if (tagInput.trim() && !tagDialog?.currentTags.includes(tagInput.trim())) void handleAddTag(tagInput);
    setTagDialog(null);
    setTagInput('');
  };

  const removeTagInline = useCallback(async (folder: string, filename: string, tag: string, driveFileId?: string) => {
    if (tagMutation) return;
    const key = bookActionIdentity({ folder, filename, driveFileId });
    setTagMutation(tag);
    setTagNotice({ message: ui("\"{p0}\" 태그를 삭제하는 중입니다…", { p0: tag }), severity: 'info' });
    setTagOverrides((prev) => ({ ...prev, [key]: currentTagsOf(key).filter((item) => item !== tag) }));
    setTagDialog((prev) => prev && bookActionIdentity({ folder: prev.folder, filename: prev.file, driveFileId: prev.driveFileId }) === key
      ? { ...prev, currentTags: prev.currentTags.filter((item) => item !== tag) } : prev);
    publishTagSummaryOptimistic(tag, -1);
    folderLibraryModel.get(folder).removeTag(filename, tag, driveFileId);
    try {
      await tagsApi.removeTag(folder, filename, tag, driveFileId);
      await onAiTagRemoved?.({ folder, filename, driveFileId, tag });
      window.dispatchEvent(new Event('tags-changed'));
      setTagNotice({ message: ui("\"{p0}\" 태그가 삭제되었습니다.", { p0: tag }), severity: 'success' });
    } catch (e) {
      await tagsApi.restoreCachedRelation(folder, filename, tag, true, driveFileId);
      setTagOverrides((prev) => {
        const tags = currentTagsOf(key);
        return { ...prev, [key]: tags.includes(tag) ? tags : [...tags, tag] };
      });
      publishTagSummaryOptimistic(tag, 1);
      folderLibraryModel.get(folder).addTag(filename, tag, driveFileId);
      const message = e instanceof Error ? e.message : ui("태그 삭제 실패");
      setTagNotice({ message: ui("태그를 삭제하지 못했습니다. {p0}", { p0: message }), severity: 'error' });
    } finally {
      setTagMutation(null);
    }
  }, [currentTagsOf, onAiTagRemoved, tagMutation]);

  const handleRemoveDialogTag = async (tag: string) => {
    if (!tagDialog) return;
    await removeTagInline(tagDialog.folder, tagDialog.file, tag, tagDialog.driveFileId);
  };

  const autoTag = useCallback(async (book: BookRef) => {
    if (!canUseAiAutoTag || tagMutation !== null) return;
    const key = bookActionIdentity(book);
    setTagMutation(`ai:${key}`);
    try {
      await tagsApi.autoTag(book.folder, book.filename, book.driveFileId);
      setTagOverrides((prev) => {
        const { [key]: _removed, ...rest } = prev;
        return rest;
      });
      await reload(true);
      window.dispatchEvent(new Event('tags-changed'));
    } catch (e) {
      onError(e instanceof Error ? e.message : t('aiTaggingFailed'));
    } finally {
      setTagMutation(null);
    }
  }, [canUseAiAutoTag, reload, tagMutation]);

  const openDocumentMetadata = useCallback(async (book: BookRef) => {
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
  }, []);

  const dialogs = (
    <>
      <BookMetadataDialog
        target={metadataTarget}
        onClose={() => setMetadataTarget(null)}
        onCoverChanged={() => window.dispatchEvent(new Event('folders-changed'))}
        canUseAiResearch={bookResearchAccess?.() ?? false}
        onUpgrade={() => { setMetadataTarget(null); navigate('/pricing'); }}
      />

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
          <Button variant="contained" onClick={() => void handleMove()} disabled={!moveTarget || moving}>{moving ? t('moving') : t('move')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('deleteConfirmation')}</DialogTitle>
        <DialogContent><Typography translate="no">{t('deletePdfQuestion', { name: confirmDelete?.filename ?? '' })}</Typography></DialogContent>
        <DialogActions>
          <Button color="error" onClick={() => setConfirmDelete(null)}>{t('cancel')}</Button>
          <Button color="error" variant="contained" sx={{ bgcolor: 'error.dark', '&:hover': { bgcolor: 'error.main' } }} onClick={() => void confirmDeleteBook()}>{t('delete')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!tagDialog} disableAutoFocus onClose={handleCloseTagDialog} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <HashTagIcon color="primary" fontSize="small" />
            {t('manageTags')}
          </Box>
        </DialogTitle>
        <DialogContent>
          {tagLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={24} /></Box>
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
                    <TagChip hashLabel key={tag} tag={tag} color={tagColors[tag]} disabled={tagMutation !== null} onDelete={() => void handleRemoveDialogTag(tag)} />
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
                  options={allTags.filter((item) => !tagDialog?.currentTags.includes(item))}
                  inputValue={tagInput}
                  onInputChange={(_event, value, reason) => { if (reason === 'input' || reason === 'clear') setTagInput(value); }}
                  onChange={(_event, value) => { if (value) void handleAddTag(value); }}
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
          <Button disabled={tagMutation !== null} onClick={handleCloseTagDialog}>{t('close')}</Button>
        </DialogActions>
      </Dialog>

      <TagNoticeSnackbar notice={tagNotice} onClose={() => setTagNotice(null)} />
    </>
  );

  return {
    tagsOf,
    tagColors,
    setTagColors,
    canUseAiAutoTag,
    bookMetadataEnabled: bookMetadataEnabled ?? false,
    tagMutation,
    openMoveDialog,
    requestDelete,
    openTagDialog,
    removeTagInline,
    autoTag,
    openDocumentMetadata,
    dialogs,
  };
}

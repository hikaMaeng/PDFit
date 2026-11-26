import RefreshIcon from '@mui/icons-material/Refresh';
import ViewListIcon from '@mui/icons-material/ViewList';
import GridViewIcon from '@mui/icons-material/GridView';
import ListMountProgress from '../components/ListMountProgress';
import { useProgressiveItems } from '../components/useProgressiveItems';
import FolderDestinationPicker from '../components/FolderDestinationPicker';
import React, { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { UNTAGGED_CHANGED_EVENT } from '../model/untagged.js';
import { RECENT_BOOKS_CHANGED_EVENT } from '../model/recentBooks.js';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Checkbox, ToggleButton, ToggleButtonGroup,
  CircularProgress, Alert, Chip, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  MenuItem, Select, FormControl, InputLabel, Autocomplete,
} from '@mui/material';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import LabelOffOutlinedIcon from '@mui/icons-material/LabelOffOutlined';
import StarIcon from '@mui/icons-material/Star';
import ScheduleIcon from '@mui/icons-material/Schedule';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import DeleteIcon from '@mui/icons-material/Delete';
import { tagsApi, BookRef } from '../api/tags';
import { foldersApi, FolderInfo } from '../api/folders';
import { favoritesApi } from '../api/favorites';
import { favoritesModel } from '../model/favoritesModel';
import { FAVORITE_COLOR } from '../components/FavoriteToggle';
import LibraryBookItem, { LibraryBookCollection } from '../components/LibraryBookItem.js';
import PdfListHeader from '../components/PdfListHeader';
import LibraryFixedControls from '../components/LibraryFixedControls';
import ManualTagInput from '../components/ManualTagInput.js';
import TagColorPicker, { lastTagInputColor, rememberTagInputColor } from '../components/TagColorPicker';
import TagManagementDialog from '../components/TagManagementDialog.js';
import TagChip from '../components/TagChip';
import TagGlyph from '../components/TagGlyph.js';
import { DEFAULT_TAG_ICON, type TagIconName } from '../../shared/tagDetails.js';
import HashTagIcon from '../components/HashTagIcon';
import { useTagMutationLocks } from '../components/useTagMutationLocks';
import { folderLibraryModel } from '../model/folderLibraryModel';
import { usePdfitI18n } from '../i18n/usePdfitI18n';
import { publishTagSummaryOptimistic } from '../model/tagSummaryEvents';
import { subscribeTagDetailsChanges, tagNameFromPath } from '../model/tagDetailsEvents.js';
import TagNoticeSnackbar, { type TagNotice } from '../components/TagNoticeSnackbar';
import SelectedDocumentActions, { type SelectedDocument } from '../components/SelectedDocumentActions';
import BookMetadataDialog, { type BookMetadataTarget } from '../components/BookMetadataDialog';
import { usePdfitFrontConfig } from '../context';
import { isPendingUploadDriveFileId } from '../viewer/openViewer';
import { RSC } from './resource.js';

interface TagDialogState {
  folder: string;
  file: string;
  driveFileId?: string;
  currentTags: string[];
}

const bookIdentity = (book: Pick<BookRef, 'folder' | 'filename' | 'driveFileId'>) =>
  book.driveFileId ?? `${book.folder}/${book.filename}`;

/**
 * `untagged`이면 `/tag/:name` 대신 태그가 하나도 없는 문서를 보여 주는 "미분류" 보기이고,
 * `favorites`와 `recent`는 각각 즐겨찾기와 신규등록 문서를 모아 보여 준다.
 */
export default function TagPage({ untagged = false, favorites = false, recent = false }: { untagged?: boolean; favorites?: boolean; recent?: boolean } = {}) {
  const { t, ui } = usePdfitI18n();
  const { bookMetadataEnabled, bookResearchAccess, aiAutoTagAccess, onAiTagRemoved, serverThumbnails } = usePdfitFrontConfig();
  const canUseAiAutoTag = aiAutoTagAccess?.() ?? true;
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const tagName = tagNameFromPath(pathname) ?? '';

  const [libraryView, setLibraryView] = useState<'list' | 'covers'>(() => localStorage.getItem('pdfit.library.view') === 'covers' ? 'covers' : 'list');
  const [refreshing, setRefreshing] = useState(false);
  const [books, setBooks] = useState<BookRef[]>([]);
  const [selectedBooks, setSelectedBooks] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tagColor, setTagColor] = useState('#22c55e');
  const [tagIcon, setTagIcon] = useState<TagIconName>();
  const [tagColors, setTagColors] = useState<Record<string, string>>({});
  const [tagIcons, setTagIcons] = useState<Record<string, TagIconName | undefined>>({});
  const booksRequest = useRef(0);
  // 태그에 문서가 아무리 많아도 위에서부터 조금씩 붙여 첫 화면이 멈추지 않게 한다.
  const { rendered: renderedBooks, done: listFullyMounted, sentinelRef: listSentinelRef } = useProgressiveItems(books, `${pathname}\u0000${libraryView}`);

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
  const locks = useTagMutationLocks();
  /** 태그 다이얼로그가 연 책. 다이얼로그 안의 잠금은 그 책 하나만 따른다. */
  const dialogBookKey = tagDialog ? (tagDialog.driveFileId ?? `${tagDialog.folder}/${tagDialog.file}`) : null;
  const dialogBusy = dialogBookKey !== null && locks.isBookBusy(dialogBookKey);
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
    if (!tagName && !untagged && !favorites && !recent) return;
    const request = ++booksRequest.current;
    if (!background) setLoading(true);
    setError(null);
    try {
      const loadTaggedBooks = recent ? foldersApi.listRecentBooks : favorites ? favoritesApi.listBooks : () => tagsApi.listBooks(tagName);
      const [data, summaries] = untagged
        ? [await tagsApi.listUntaggedBooks(), []] as const
        : await Promise.all([loadTaggedBooks(), tagsApi.listSummary()]);
      if (request !== booksRequest.current) return;
      if (!untagged) {
        const summary = summaries.find((item) => item.name === tagName);
        setTagColor(summary?.color ?? '#22c55e');
        setTagIcon(summary?.icon);
        setTagColors(Object.fromEntries(summaries.map((item) => [item.name, item.color])));
        setTagIcons(Object.fromEntries(summaries.map((item) => [item.name, item.icon])));
      }
      setBooks(data);
      setBookTags(Object.fromEntries(data.map((book) => [
        bookIdentity(book), book.tags,
      ])));
    } catch (e) {
      if (request === booksRequest.current) setError(e instanceof Error ? e.message : ui("로드 실패"));
    } finally {
      if (request === booksRequest.current) setLoading(false);
    }
  }, [tagName, untagged, favorites, recent]);

  const refreshBooks = async () => {
    setRefreshing(true);
    try {
      if (recent) await foldersApi.refresh();
      await loadBooks(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : ui("새로고침에 실패했습니다."));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadBooks();
    return () => { booksRequest.current += 1; };
  }, [loadBooks]);

  useEffect(() => {
    const reload = () => void loadBooks(true);
    window.addEventListener('book-renamed', reload);
    return () => window.removeEventListener('book-renamed', reload);
  }, [loadBooks]);

  useEffect(() => subscribeTagDetailsChanges(({ previousName, name }) => {
    if (previousName === name || previousName === tagName) return;
    void loadBooks(true);
    setTagDialog((current) => current && { ...current, currentTags: current.currentTags.map((tag) => tag === previousName ? name : tag) });
    setAllTags((current) => current.map((tag) => tag === previousName ? name : tag));
  }), [loadBooks, tagName]);

  useEffect(() => { setSelectedBooks(new Set()); }, [tagName, untagged, favorites]);

  // 즐겨찾기 보기: 별을 꺼서 즐겨찾기가 아니게 된 책은 바로 목록에서 뺀다. 모델이 서버에서 한 번 받아오기 전에는
  // 모든 책이 '꺼짐'으로 보이므로 그때는 건드리지 않는다.
  const favoritesVersion = useSyncExternalStore(favoritesModel.subscribe, favoritesModel.getVersion, favoritesModel.getVersion);
  useEffect(() => {
    if (!favorites || !favoritesModel.isLoaded()) return;
    setBooks((prev) => {
      const kept = prev.filter((book) => favoritesModel.stateOf(book.folder, book.filename) === 'on');
      return kept.length === prev.length ? prev : kept;
    });
  }, [favorites, favoritesVersion]);

  // 다른 창에서 즐겨찾기가 바뀌었거나 파일 점검이 행을 지웠을 때 목록을 다시 읽는다.
  useEffect(() => {
    if (!favorites) return;
    const reload = () => void loadBooks(true);
    window.addEventListener('favorites-changed', reload);
    return () => window.removeEventListener('favorites-changed', reload);
  }, [favorites, loadBooks]);

  useEffect(() => {
    if (!recent) return;
    const reload = () => void loadBooks(true);
    window.addEventListener('folders-changed', reload);
    window.addEventListener(RECENT_BOOKS_CHANGED_EVENT, reload);
    return () => {
      window.removeEventListener('folders-changed', reload);
      window.removeEventListener(RECENT_BOOKS_CHANGED_EVENT, reload);
    };
  }, [recent, loadBooks]);

  useEffect(() => {
    setSelectedBooks((current) => {
      const visibleKeys = new Set(books.map(selectionKey));
      const retained = new Set([...current].filter((key) => visibleKeys.has(key)));
      return retained.size === current.size ? current : retained;
    });
  }, [books]);

  useEffect(() => {
    const reload = () => void loadBooks(true);
    window.addEventListener('tag-added', reload);
    if (untagged) {
      window.addEventListener(UNTAGGED_CHANGED_EVENT, reload);
      window.addEventListener('tags-changed', reload);
    }
    return () => {
      window.removeEventListener('tag-added', reload);
      if (untagged) {
        window.removeEventListener(UNTAGGED_CHANGED_EVENT, reload);
        window.removeEventListener('tags-changed', reload);
      }
    };
  }, [untagged, loadBooks]);

  useEffect(() => {
    if (untagged) return;
    let active = true;
    let request = 0;
    const refreshColor = () => {
      const current = ++request;
      void tagsApi.listSummary().then((items) => {
        if (!active || current !== request) return;
        setTagColors(Object.fromEntries(items.map((item) => [item.name, item.color])));
        setTagIcons(Object.fromEntries(items.map((item) => [item.name, item.icon])));
        const summary = items.find((item) => item.name === tagName);
        if (summary) { setTagColor(summary.color); setTagIcon(summary.icon); }
      }).catch(() => undefined);
    };
    window.addEventListener('tags-changed', refreshColor);
    return () => { active = false; window.removeEventListener('tags-changed', refreshColor); };
  }, [tagName, untagged]);

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
      setTagIcons(Object.fromEntries(summaries.map((item) => [item.name, item.icon])));
      setBookTags((prev) => ({ ...prev, [key]: currentTags }));
    } catch {
      setError(ui("태그 로드 실패"));
    } finally {
      setTagLoading(false);
    }
  }, [bookTags]);

  const handleAddTag = async (tag: string) => {
    if (!tagDialog || !tag.trim()) return false;
    const trimmed = tag.trim();
    const isNewTag = !allTags.includes(trimmed);
    if (tagDialog.currentTags.includes(trimmed)) {
      setTagInput('');
      setTagNotice({ message: ui("\"{p0}\"은(는) 이미 추가된 태그입니다.", { p0: trimmed }), severity: 'info' });
      return true;
    }
    const { folder, file, driveFileId } = tagDialog;
    const key = driveFileId ?? `${folder}/${file}`;
    if (!locks.begin('tag', key)) return false;
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
      locks.end('tag', key);
    }
  };

  const handleCloseTagDialog = async () => {
    if (dialogBusy) return;
    if (tagInput.trim() && !tagDialog?.currentTags.includes(tagInput.trim())) {
      void handleAddTag(tagInput);
    }
    setTagDialog(null);
    setTagInput('');
  };

  const handleRemoveTag = async (tag: string) => {
    if (!tagDialog) return;
    const { folder, file, driveFileId } = tagDialog;
    const key = driveFileId ?? `${folder}/${file}`;
    const removedBook = books.find((book) => bookIdentity(book) === key);
    if (!locks.begin('tag', key)) return;
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
      locks.end('tag', key);
    }
  };

  const handleInlineRemoveTag = useCallback(async (folder: string, filename: string, tag: string, driveFileId?: string) => {
    const key = driveFileId ?? `${folder}/${filename}`;
    const removedBook = books.find((book) => bookIdentity(book) === key);
    if (!locks.begin('tag', key)) return;
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
      locks.end('tag', key);
    }
  }, [books, locks, tagName]);

  const handleBookAutoTag = async (book: BookRef) => {
    if (!canUseAiAutoTag) return;
    const key = bookIdentity(book);
    if (!locks.begin('ai', key)) return;
    try {
      const result = await tagsApi.autoTag(book.folder, book.filename, book.driveFileId);
      // 서버가 적용한 태그만 반영한다. 목록을 통째로 다시 불러오면 같은 화면에서
      // 동시에 돌고 있는 다른 책의 낙관적 갱신까지 덮어쓴다.
      setBookTags((prev) => {
        const current = prev[key] ?? [];
        const kept = current.filter((tag) => !result.removedTags.includes(tag));
        return { ...prev, [key]: [...kept, ...result.addedTags.filter((tag) => !kept.includes(tag))] };
      });
      const library = folderLibraryModel.get(book.folder);
      for (const tag of result.addedTags) { library.addTag(book.filename, tag, book.driveFileId); publishTagSummaryOptimistic(tag, 1); }
      for (const tag of result.removedTags) { library.removeTag(book.filename, tag, book.driveFileId); publishTagSummaryOptimistic(tag, -1); }
      // 보고 있는 태그가 떨어져 나갔다면 이 목록에 더는 속하지 않는다.
      if (tagName && result.removedTags.includes(tagName)) setBooks((prev) => prev.filter((item) => bookIdentity(item) !== key));
      window.dispatchEvent(new Event('tags-changed'));
    } catch (error) { setError(error instanceof Error ? error.message : t('aiTaggingFailed')); }
    finally { locks.end('ai', key); }
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
          {recent
            ? <ScheduleIcon aria-hidden sx={{ fontSize: 28, color: 'text.secondary' }} />
            : favorites
            ? <StarIcon aria-hidden data-testid="favorites-title-icon" sx={{ fontSize: 28, color: FAVORITE_COLOR }} />
            : untagged
            ? <LabelOffOutlinedIcon aria-hidden data-testid="untagged-title-icon" sx={{ fontSize: 28, color: 'text.secondary' }} />
            : <TagColorPicker icon={tagIcon && tagIcon !== DEFAULT_TAG_ICON
              ? <TagGlyph icon={tagIcon} sx={{ fontSize: 25, color: tagColor }} />
              : <Typography component="span" sx={{ fontSize: 28, fontWeight: 700, color: tagColor }}>#</Typography>}
              color={tagColor} size="medium" onChange={(color) => void tagsApi.updateColor(tagName, color).then(() => { setTagColor(color); window.dispatchEvent(new Event('tags-changed')); })} />}
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, minWidth: 0 }}>
            <Typography variant="h5" component={recent ? 'h1' : 'h5'} fontWeight={700} translate={favorites || untagged || recent ? undefined : 'no'} sx={{ minWidth: 0, overflowWrap: 'anywhere' }} data-testid={favorites ? 'favorites-title' : untagged ? 'untagged-title' : undefined}>{recent ? t(RSC.LIBRARY_RECENT_TITLE_TEXT) : favorites ? t('favorites') : untagged ? t('untagged') : tagName}</Typography>
            <Chip data-testid="tag-document-count" label={t('pdfCount', { count: books.length })} size="small" color="primary" variant="outlined" sx={{ borderRadius: '4px', fontWeight: 600 }} />
          </Box>
          <Button data-testid="tag-refresh" size="small" variant="outlined" startIcon={<RefreshIcon />} disabled={refreshing} onClick={() => void refreshBooks()} sx={{ ml: 'auto', flexShrink: 0, whiteSpace: 'nowrap' }}>{t('refresh')}</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {/* PDF 목록 */}
      <Box>
        {books.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <PictureAsPdfIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
            <Typography color="text.secondary">{recent ? t(RSC.LIBRARY_RECENT_EMPTY_MESSAGE) : favorites ? t('noFavoritePdfs') : untagged ? t('noUntaggedPdfs') : t('noTaggedPdfs')}</Typography>
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
          {libraryView === 'list' && <PdfListHeader />}
          </LibraryFixedControls>
          <LibraryBookCollection view={libraryView} listTestId={recent ? 'recent-book-list' : undefined}>
            {renderedBooks.map((book) => {
              const identity = bookIdentity(book);
              const autoTagging = locks.isAutoTagging(identity);
              return <LibraryBookItem key={selectionKey(book)} view={libraryView}
                folder={book.folder} filename={book.filename} driveFileId={book.driveFileId}
                size={book.size} modifiedAt={book.modified_at} clipCount={book.clipCount} clipCountRevision={book.clipCountRevision}
                serverCover={serverThumbnails} tags={bookTags[identity] ?? []} tagColors={tagColors} tagIcons={tagIcons}
                onMove={(folder, filename) => void openMoveDialog(folder, filename, book.driveFileId)}
                onDelete={(folder, filename) => setConfirmDelete({ folder, filename, driveFileId: book.driveFileId })}
                onAutoTag={canUseAiAutoTag ? () => void handleBookAutoTag(book) : undefined}
                autoTagging={autoTagging}
                autoTagDisabled={locks.isBookBusy(identity) || (locks.autoTagSlotsFull && !autoTagging)}
                onTagDelete={(folder, filename, tag) => handleInlineRemoveTag(folder, filename, tag, book.driveFileId)}
                onManageTags={(folder, filename) => openTagDialog(folder, filename, book.driveFileId)}
                onEditMetadata={bookMetadataEnabled ? () => void openDocumentMetadata(book) : undefined}
              />;
            })}
          </LibraryBookCollection>
          <ListMountProgress done={listFullyMounted} sentinelRef={listSentinelRef} rendered={renderedBooks.length} total={books.length} />
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
      <TagManagementDialog open={!!tagDialog} onClose={() => void handleCloseTagDialog()}>
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
                    <TagChip hashLabel key={tag} tag={tag} color={tagColors[tag]} disabled={dialogBusy} onDelete={() => void handleRemoveTag(tag)} />
                  ))
                )}
              </Box>
              <ManualTagInput tags={allTags} assignedTags={tagDialog?.currentTags} value={tagInput}
                disabled={dialogBusy} onInputChange={setTagInput} onAdd={(tag) => void handleAddTag(tag)}>
                <TagColorPicker color={tagInputColor} onChange={(color) => { setTagInputColor(color); rememberTagInputColor(color); }} label={ui("새 태그 색상")} variant="swatch" />
                <Button data-testid="add-tag-button" variant="contained" size="small" disabled={dialogBusy} onClick={(event) => { if (tagInput.trim()) void handleAddTag(tagInput); else event.currentTarget.parentElement?.querySelector('input')?.focus(); }} sx={{ flexShrink: 0, bgcolor: '#3b82f6', color: '#ffffff', '&:hover': { bgcolor: '#2563eb' } }}>{ui("추가")}</Button>
              </ManualTagInput>
              {!canUseAiAutoTag && <Typography data-testid="pdf-auto-classify-access-guide" variant="body2" color="text.secondary" sx={{ mt: 2, fontSize: 14, lineHeight: 1.6 }}>{ui('유료 이용권 결제 시 AI 자동태그를 사용할 수 있습니다.')}</Typography>}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={dialogBusy} onClick={() => void handleCloseTagDialog()}>{t('close')}</Button>
        </DialogActions>
      </TagManagementDialog>
      <TagNoticeSnackbar notice={tagNotice} onClose={() => setTagNotice(null)} />
    </Box>
  );
}

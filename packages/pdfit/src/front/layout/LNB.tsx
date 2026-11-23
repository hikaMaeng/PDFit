import React, { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  ToggleButton,
  ToggleButtonGroup,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import DeleteIcon from '@mui/icons-material/Delete';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import LabelOffOutlinedIcon from '@mui/icons-material/LabelOffOutlined';
import ViewQuiltOutlinedIcon from '@mui/icons-material/ViewQuiltOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import FolderOffOutlinedIcon from '@mui/icons-material/FolderOffOutlined';
import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import TagIcon from '../components/HashTagIcon.js';
import TagEditDialog from '../components/TagEditDialog.js';
import TagGlyph from '../components/TagGlyph.js';
import TagNoticeSnackbar from '../components/TagNoticeSnackbar.js';
import LanguageIcon from '@mui/icons-material/Language';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { usePdfitFrontConfig } from '../context';
import { foldersApi, type FolderInfo } from '../api/folders';
import { tagsApi, type TagSummary } from '../api/tags';
import type { TagFolder } from '../api/tagFolders.js';
import { tagFoldersModel, type TagDragPayload } from '../model/tagFoldersModel.js';
import { folderLibraryModel } from '../model/folderLibraryModel';
import { listAllBookmarks } from '../api/bookmarks';
import { loadCoverOverrides } from '../api/covers';
import { subscribeBookmarkChanges } from '../model/bookmarkEvents.js';
import { bookClipCountModel } from '../model/bookClipCountModel.js';
import type { PdfitLanguage } from '../model/languagePreference.js';
import { distinctTagColor } from '../../shared/tagColor.js';
import { UNTAGGED_PATH } from '../model/untagged.js';
import { FAVORITES_PATH } from '../model/favorites.js';
import { favoritesModel } from '../model/favoritesModel.js';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import { TAG_INDEX_PATH } from '../model/tagIndex.js';
import { TAG_SUMMARY_OPTIMISTIC_EVENT, type TagSummaryOptimisticDetail } from '../model/tagSummaryEvents.js';
import { subscribeTagDetailsChanges, tagNameFromPath, tagPath } from '../model/tagDetailsEvents.js';
import { usePdfitI18n, useTranslatedDisplayText } from '../i18n/usePdfitI18n.js';
import { RSC } from './resource.js';
import { pdfitAppearancePreferenceModel } from '../model/appearancePreference.js';
import { synchronizeLibraryMetadata } from '../model/libraryMetadataSync.js';

export const LNB_WIDTH = 288;

export interface DragPayload {
  folder: string;
  filename: string;
  driveFileId?: string;
}

export const DRAG_TYPE = 'application/pdf-item';

/** 접어 둔 태그 폴더 이름. 키: 폴더 이름 / 범위: 이 브라우저 / 정리: 폴더 목록을 받을 때 없는 이름을 지운다. */
const COLLAPSED_TAG_FOLDERS_KEY = 'pdfit.lnb.collapsedTagFolders';
function readCollapsedTagFolders(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLLAPSED_TAG_FOLDERS_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === 'string') : []);
  } catch {
    return new Set();
  }
}
function writeCollapsedTagFolders(names: Set<string>): void {
  try { localStorage.setItem(COLLAPSED_TAG_FOLDERS_KEY, JSON.stringify([...names])); } catch { /* 저장소를 못 써도 이번 화면에서는 동작한다 */ }
}

const noopSubscribe = (_listener: () => void) => () => undefined;
const zeroVersion = () => 0;

function DisplayName({ value }: { value: string }) {
  return <>{useTranslatedDisplayText(value)}</>;
}

interface LNBProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export default function LNB({ mobileOpen, onMobileClose }: LNBProps) {
  const { language, t, ui } = usePdfitI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const activeTag = tagNameFromPath(location.pathname);
  const { appName, appVersion, extraSidebarItems, extraSidebarFooter, navigationGuard, onAiTagRemoved } = usePdfitFrontConfig();
  const go = (path: string) => navigate(navigationGuard?.(path) ?? path);
  const { languagePreference } = usePdfitFrontConfig();
  const sidebarLabel = (item: { path: string; label: string; localizedLabels?: Partial<Record<PdfitLanguage, string>> }) => item.path === '/settings'
    ? t('settings')
    : item.localizedLabels?.[language] ?? item.label;
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  useSyncExternalStore(
    languagePreference?.model.subscribe ?? noopSubscribe,
    languagePreference?.model.getVersion ?? zeroVersion,
    languagePreference?.model.getVersion ?? zeroVersion,
  );
  const selectedLanguage = languagePreference?.model.language;
  useSyncExternalStore(pdfitAppearancePreferenceModel.subscribe, pdfitAppearancePreferenceModel.getVersion, pdfitAppearancePreferenceModel.getVersion);
  const colorMode = pdfitAppearancePreferenceModel.mode;
  const theme = useTheme();
  const sidebarBackground = colorMode === 'light' ? '#ffffff' : '#1b1b1d';
  const selectedNavigationBackground = colorMode === 'light' ? '#edf4ff' : '#2a2f36';
  const sidebarTextPrimary = colorMode === 'light' ? '#30343b' : theme.palette.text.primary;
  const sidebarTextSecondary = colorMode === 'light' ? '#626975' : theme.palette.text.secondary;
  const sidebarTextDisabled = colorMode === 'light' ? '#9298a2' : theme.palette.text.disabled;
  const sidebarDivider = colorMode === 'light' ? '#d2d2d2' : theme.palette.divider;
  const sidebarHover = colorMode === 'light' ? '#f7faff' : 'action.hover';
  const sidebarAccent = colorMode === 'light' ? '#626975' : theme.palette.primary.main;
  const selectedAccent = theme.palette.primary.main;
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [tags, setTags] = useState<TagSummary[]>([]);
  const tagsRequest = useRef(0);
  const [editTag, setEditTag] = useState<(TagSummary & { id: string }) | null>(null);
  const [untaggedCount, setUntaggedCount] = useState(0);
  const [bookmarkCount, setBookmarkCount] = useState(0);
  // 즐겨찾기 개수와 사용 가능 여부는 모델이 들고 있다. 한 번만 읽고 나서는 모델 변경(토글·서버 이벤트)을 구독한다.
  useSyncExternalStore(favoritesModel.subscribe, favoritesModel.getVersion, favoritesModel.getVersion);
  const favoritesAvailable = favoritesModel.isAvailable();
  const favoriteCount = favoritesModel.count();
  // 태그 폴더는 모델이 들고 있다. 한 번 읽고 나서는 모델 변경(생성·삭제·이동·서버 이벤트)을 구독한다.
  useSyncExternalStore(tagFoldersModel.subscribe, tagFoldersModel.getVersion, tagFoldersModel.getVersion);
  const tagFolders = tagFoldersModel.list();
  const tagFoldersAvailable = tagFoldersModel.isAvailable();
  const [collapsedTagFolders, setCollapsedTagFolders] = useState<Set<string>>(readCollapsedTagFolders);
  const [dragOverTagFolder, setDragOverTagFolder] = useState<string | null>(null);
  const tagFolderMenuId = useId();
  const [tagFolderMenu, setTagFolderMenu] = useState<{ anchor: HTMLElement; tag: string } | null>(null);
  const [tagFolderAssignmentFailed, setTagFolderAssignmentFailed] = useState(false);
  const [tagFolderDialogOpen, setTagFolderDialogOpen] = useState(false);
  const [newTagFolderName, setNewTagFolderName] = useState('');
  const [creatingTagFolder, setCreatingTagFolder] = useState(false);
  const [tagFolderError, setTagFolderError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [foldersOpen, setFoldersOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(true);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [dragOverTag, setDragOverTag] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FolderInfo | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'folder' | 'tag' | 'all_tags' | 'tag_folder'; name: string; count?: number } | null>(null);

  // 태그는 이름의 유니코드(UTF-16 코드 유닛) 순으로 정렬한다. 로케일 비교나 분류 그룹 순서는 쓰지 않는다.
  const orderedTags = useMemo(
    () => [...tags].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)),
    [tags],
  );
  const tagsByName = useMemo(() => new Map(tags.map((tag) => [tag.name, tag])), [tags]);
  // 폴더에 들어간 태그는 폴더 안에서만 보이고 아래 일반 목록에서는 가린다.
  const groupedTagNames = tagFoldersModel.groupedTagNames();
  const rootTags = useMemo(
    () => orderedTags.filter((tag) => !groupedTagNames.has(tag.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderedTags, tagFoldersModel.getVersion()],
  );
  const totalTagAssignments = useMemo(
    () => tags.reduce((total, tag) => total + tag.bookCount, 0),
    [tags],
  );

  const loadFolders = useCallback(async () => {
    try {
      const data = await foldersApi.list();
      setFolders(data);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTags = useCallback(async () => {
    const request = ++tagsRequest.current;
    try {
      const data = await tagsApi.listSummary();
      if (request === tagsRequest.current) setTags(data);
    } catch {
      // keep current tag list on error
    }
    try {
      const count = await tagsApi.countUntaggedBooks();
      if (request === tagsRequest.current) setUntaggedCount(count);
    } catch {
      // 미분류 개수를 못 구해도 마지막 값을 유지한다
    }
  }, []);

  useEffect(() => subscribeTagDetailsChanges(({ previousName, name }) => {
    if (previousName !== name) {
      void tagFoldersModel.load();
      if (activeTag === previousName) {
        const path = tagPath(name);
        navigate(navigationGuard?.(path) ?? path, { replace: true });
      }
    }
    window.dispatchEvent(new Event('tags-changed'));
  }), [activeTag, navigate, navigationGuard]);

  const loadBookmarkCount = useCallback(async () => {
    try {
      setBookmarkCount((await listAllBookmarks()).length);
    } catch {
      // retain the last known count if bookmark loading fails
    }
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await foldersApi.refresh();
      await synchronizeLibraryMetadata();
      folderLibraryModel.invalidateFiles();
      folderLibraryModel.invalidateTags();
      await Promise.all([loadFolders(), loadTags(), loadBookmarkCount(), favoritesModel.load(), tagFoldersModel.load()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : ui("새로고침에 실패했습니다."));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;
    void favoritesModel.load();
    void tagFoldersModel.load();
    void Promise.all([loadFolders(), loadTags(), loadBookmarkCount()]).finally(() => {
      if (active) {
        window.dispatchEvent(new Event('pdfit-initial-rendered'));
      }
    });
    return () => {
      active = false;
    };
  }, [loadBookmarkCount, loadFolders, loadTags]);

  useEffect(() => {
    let active = true;
    let syncing = false;
    const reconcile = async () => {
      if (!active || syncing || document.hidden) return;
      syncing = true;
      try {
        const updated = await synchronizeLibraryMetadata();
        if (!active || !updated) return;
        folderLibraryModel.invalidateFiles();
        await Promise.all([loadFolders(), loadTags(), loadBookmarkCount(), favoritesModel.load(), tagFoldersModel.load()]);
      } catch (error) {
        console.warn('[library-sync] Remote metadata refresh failed; keeping the local snapshot.', error);
      } finally {
        syncing = false;
      }
    };
    const onFocus = () => { void reconcile(); };
    void reconcile();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    const timer = window.setInterval(onFocus, 60_000);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      window.clearInterval(timer);
    };
  }, [loadBookmarkCount, loadFolders, loadTags]);

  useEffect(() => {
    const onFolderChange = () => void loadFolders();
    const onTagChange = () => void loadTags();
    const onOptimisticTagChange = (event: Event) => {
      const { name, delta } = (event as CustomEvent<TagSummaryOptimisticDetail>).detail;
      setTags((current) => {
        const existing = current.find((tag) => tag.name === name);
        if (!existing && delta > 0) {
          return [...current, {
            name,
            bookCount: 1,
            color: distinctTagColor(name, current.map((tag) => tag.color)),
          }].sort((left, right) => left.name.localeCompare(right.name, 'ko'));
        }
        if (!existing) return current;
        const bookCount = existing.bookCount + delta;
        if (bookCount <= 0) return current.filter((tag) => tag.name !== name);
        return current.map((tag) => tag.name === name ? { ...tag, bookCount } : tag);
      });
    };
    const onBookmarkChange = () => void loadBookmarkCount();

    window.addEventListener('folders-changed', onFolderChange);
    window.addEventListener('tags-changed', onTagChange);
    window.addEventListener(TAG_SUMMARY_OPTIMISTIC_EVENT, onOptimisticTagChange);
    const unsubscribeBookmarks = subscribeBookmarkChanges(onBookmarkChange);
    const disconnectBookClipCounts = bookClipCountModel.connect();

    return () => {
      window.removeEventListener('folders-changed', onFolderChange);
      window.removeEventListener('tags-changed', onTagChange);
      window.removeEventListener(TAG_SUMMARY_OPTIMISTIC_EVENT, onOptimisticTagChange);
      unsubscribeBookmarks();
      disconnectBookClipCounts();
    };
  }, [loadBookmarkCount, loadFolders, loadTags]);

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      source = new EventSource('/api/events');
      source.onmessage = (event) => {
        if (event.data === 'folders-changed') {
          void loadFolders();
        }
        if (event.data === 'tags-changed') {
          void loadTags();
          // 태그가 지워지면 폴더 소속도 서버에서 함께 지워진다.
          void tagFoldersModel.load();
        }
        if (event.data === 'tag-folders-changed') {
          void tagFoldersModel.load();
        }
        // 즐겨찾기를 켜고 끈 경우, 또는 파일 점검이 사라진 파일의 즐겨찾기를 지운 경우.
        if (event.data === 'favorites-changed') {
          void favoritesModel.load();
          window.dispatchEvent(new Event('favorites-changed'));
        }
        // A cover replaced elsewhere: reload the small version list only, not the folders.
        if (event.data === 'covers-changed') {
          void loadCoverOverrides();
        }
      };
      source.onerror = () => {
        source?.close();
        retryTimer = setTimeout(connect, 5_000);
      };
    };

    connect();
    return () => {
      source?.close();
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [loadFolders, loadTags]);

  // 사라진 폴더의 접힘 기록을 지운다(폴더 목록을 한 번이라도 받은 뒤에만).
  useEffect(() => {
    if (!tagFoldersModel.isLoaded()) return;
    setCollapsedTagFolders((current) => {
      const names = new Set(tagFolders.map((folder) => folder.name));
      const next = new Set([...current].filter((name) => names.has(name)));
      if (next.size === current.size) return current;
      writeCollapsedTagFolders(next);
      return next;
    });
  }, [tagFolders]);

  const isActive = (path: string) => location.pathname === path;

  // 검색어는 결과 페이지(/search?q=)의 주소와 동기화한다. 다른 페이지에서는 입력하던 값을 그대로 둔다.
  const urlSearchQuery = location.pathname === '/search' ? new URLSearchParams(location.search).get('q') ?? '' : null;
  const [searchText, setSearchText] = useState(urlSearchQuery ?? '');
  useEffect(() => { if (urlSearchQuery !== null) setSearchText(urlSearchQuery); }, [urlSearchQuery]);
  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const query = searchText.trim();
    if (!query) return;
    go(`/search?q=${encodeURIComponent(query)}`);
    onMobileClose();
  };

  const handleCreate = async () => {
    if (!newFolderName.trim()) {
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const name = newFolderName.trim();
      await foldersApi.create(name);
      await loadFolders();
      setDialogOpen(false);
      setNewFolderName('');
      go(`/folder/${encodeURIComponent(name)}`);
      onMobileClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to create folder.');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteFolder = async (folderName: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setConfirmDelete({ kind: 'folder', name: folderName });
  };

  const openRenameFolder = (folder: FolderInfo, event: React.MouseEvent) => {
    event.stopPropagation();
    setRenameTarget(folder);
    setRenameName(folder.name);
    setRenameError(null);
  };

  const handleRenameFolder = async () => {
    if (!renameTarget || renaming) return;
    const newName = renameName.trim();
    if (!newName || newName === renameTarget.name) return;
    if (folders.some((folder) => folder.name === newName && folder.name !== renameTarget.name)) {
      setRenameError(ui('이미 사용 중인 폴더 이름입니다.'));
      return;
    }
    setRenaming(true);
    setRenameError(null);
    try {
      await foldersApi.renameConfirmed(renameTarget.name, newName);
      folderLibraryModel.drop(renameTarget.name);
      await loadFolders();
      if (location.pathname === `/folder/${encodeURIComponent(renameTarget.name)}`) go(`/folder/${encodeURIComponent(newName)}`);
      setRenameTarget(null);
    } catch (caught) {
      setRenameError(caught instanceof Error ? caught.message : ui('폴더 이름을 변경하지 못했습니다.'));
    } finally {
      setRenaming(false);
    }
  };

  const confirmDeleteItem = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);

    try {
      if (target.kind === 'folder') {
        await foldersApi.deleteConfirmed(target.name);
        folderLibraryModel.drop(target.name);
        await loadFolders();
      } else if (target.kind === 'tag') {
        setTags((current) => current.filter((item) => item.name !== target.name));
        folderLibraryModel.invalidateTags();
        await tagsApi.delete(target.name);
        void tagFoldersModel.load();
        await onAiTagRemoved?.({ tag: target.name });
      } else if (target.kind === 'tag_folder') {
        await tagFoldersModel.remove(target.name);
      } else {
        await tagsApi.deleteAll();
        await onAiTagRemoved?.({});
        setTags([]);
        folderLibraryModel.invalidateTags();
        void tagFoldersModel.load();
        window.dispatchEvent(new Event('tags-changed'));
      }
      if (target.kind === 'folder' && location.pathname === `/folder/${encodeURIComponent(target.name)}`) {
        go('/');
        onMobileClose();
      }
      if ((target.kind === 'all_tags' && location.pathname.startsWith('/tag/'))
        || (target.kind === 'tag' && location.pathname === `/tag/${encodeURIComponent(target.name)}`)) {
        navigate(navigationGuard?.('/') ?? '/', { replace: true });
        onMobileClose();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : ui("요청에 실패했습니다."));
      await Promise.all([loadFolders(), loadTags(), tagFoldersModel.load()]);
    }
  };

  const parsePayload = (event: React.DragEvent): DragPayload | null => {
    try {
      return JSON.parse(event.dataTransfer.getData(DRAG_TYPE)) as DragPayload;
    } catch {
      return null;
    }
  };

  const handleDropOnFolder = async (targetFolder: string, event: React.DragEvent) => {
    event.preventDefault();
    setDragOverFolder(null);
    const payload = parsePayload(event);
    if (!payload || payload.folder === targetFolder) {
      return;
    }

    try {
      await foldersApi.moveFile(payload.folder, targetFolder, payload.filename, payload.driveFileId);
      folderLibraryModel.get(payload.folder).removeFile(payload.filename, payload.driveFileId);
      folderLibraryModel.invalidateFiles([targetFolder]);
      await loadFolders();
    } catch {
      // keep current UI state on error
    }
  };

  const handleDropOnTag = async (tag: string, event: React.DragEvent) => {
    event.preventDefault();
    setDragOverTag(null);
    const payload = parsePayload(event);
    if (!payload) {
      return;
    }

    try {
      const currentTags = await tagsApi.listForBook(payload.folder, payload.filename, payload.driveFileId);
      if (currentTags.includes(tag)) {
        return;
      }

      await tagsApi.addTag(payload.folder, payload.filename, tag, payload.driveFileId);
      folderLibraryModel.get(payload.folder).addTag(payload.filename, tag, payload.driveFileId);
      await loadTags();
      window.dispatchEvent(
        new CustomEvent('tag-added', {
          detail: { folder: payload.folder, filename: payload.filename, driveFileId: payload.driveFileId, tag },
        }),
      );
    } catch {
      // keep current UI state on error
    }
  };

  const handleDeleteTag = async (tag: TagSummary, event: React.MouseEvent) => {
    event.stopPropagation();
    setConfirmDelete({ kind: 'tag', name: tag.name, count: tag.bookCount });
  };

  const isBookDrag = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes(DRAG_TYPE);
  const isTagDrag = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes(tagFoldersModel.dragType);

  const toggleTagFolder = (name: string) => {
    setCollapsedTagFolders((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name); else next.add(name);
      writeCollapsedTagFolders(next);
      return next;
    });
  };

  const handleCreateTagFolder = async () => {
    const name = newTagFolderName.trim();
    if (!name || creatingTagFolder) return;
    if (tagFolders.some((folder) => folder.name === name)) { setTagFolderError(t('tagFolderDuplicate')); return; }
    setCreatingTagFolder(true);
    setTagFolderError(null);
    try {
      await tagFoldersModel.create(name);
      setTagFolderDialogOpen(false);
      setNewTagFolderName('');
    } catch (caught) {
      setTagFolderError((caught as { status?: number }).status === 409
        ? t('tagFolderDuplicate')
        : caught instanceof Error ? caught.message : ui('요청에 실패했습니다.'));
    } finally {
      setCreatingTagFolder(false);
    }
  };

  const addTagToFolder = (folderName: string, tag: string) => {
    setTagFolderAssignmentFailed(false);
    void tagFoldersModel.addTag(folderName, tag).catch(() => setTagFolderAssignmentFailed(true));
  };

  const handleDropOnTagFolder = (folderName: string, event: React.DragEvent) => {
    event.preventDefault();
    setDragOverTagFolder(null);
    try {
      const payload = JSON.parse(event.dataTransfer.getData(tagFoldersModel.dragType)) as TagDragPayload;
      if (typeof payload?.tag === 'string') addTagToFolder(folderName, payload.tag);
    } catch {
      // 태그가 아닌 것을 놓았다
    }
  };

  const renderTagRow = (tag: TagSummary, folderName?: string) => {
    const editId = tag.id;
    const path = tagPath(tag.name);
    const rowKey = `${folderName ?? ''}\u0000${tag.name}`;
    const dragOver = dragOverTag === rowKey;
    const menuOpen = tagFolderMenu?.tag === tag.name && folderName === undefined;
    const rowButtonSx = { p: 0.25, color: sidebarTextSecondary, opacity: 0, transition: 'opacity 120ms ease', '.pdfit-tag-row:hover &, .pdfit-tag-row:focus-within &': { opacity: 0.8 }, '&:focus-visible, &:hover': { opacity: 1, color: 'error.main', bgcolor: sidebarHover }, '@media (hover: none)': { opacity: 0.8 } };
    const folderButtonSx = { ...rowButtonSx, '&:focus-visible, &:hover': { opacity: 1, color: sidebarTextPrimary, bgcolor: sidebarHover } };
    return (
      <ListItem
        key={rowKey}
        className="pdfit-tag-row"
        data-testid={folderName === undefined ? 'lnb-tag-row' : 'lnb-folder-tag-row'}
        draggable={tagFoldersAvailable}
        onDragStart={(event) => {
          if (!tagFoldersAvailable) return;
          const payload: TagDragPayload = { tag: tag.name, ...(folderName !== undefined ? { fromFolder: folderName } : {}) };
          event.dataTransfer.setData(tagFoldersModel.dragType, JSON.stringify(payload));
          event.dataTransfer.effectAllowed = 'copyMove';
        }}
        onDragEnd={() => setDragOverTagFolder(null)}
        secondaryAction={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            {folderName !== undefined && (
              <Tooltip title={t('removeTagFromFolder')} placement="right" arrow>
                <IconButton
                  size="small"
                  data-testid="lnb-folder-tag-remove"
                  aria-label={`${tag.name} ${t('removeTagFromFolder')}`}
                  onClick={(event) => { event.stopPropagation(); void tagFoldersModel.removeTag(folderName, tag.name).catch(() => undefined); }}
                  sx={folderButtonSx}
                >
                  <FolderOffOutlinedIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            )}
            {folderName === undefined && tagFoldersAvailable && (
              <Tooltip title={t(RSC.SIDEBAR_TAGFOLDER_MOVE_BUTTON)} placement="right" arrow>
                <IconButton
                  size="small"
                  aria-label={t(RSC.SIDEBAR_TAGFOLDER_MOVE_BUTTON)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-controls={menuOpen ? tagFolderMenuId : undefined}
                  onClick={(event) => setTagFolderMenu({ anchor: event.currentTarget, tag: tag.name })}
                  sx={folderButtonSx}
                >
                  <FolderOutlinedIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            )}
            {editId && (
              <Tooltip title={t(RSC.SIDEBAR_TAG_EDIT_BUTTON, { name: tag.name })} placement="right" arrow>
                <IconButton size="small" aria-label={t(RSC.SIDEBAR_TAG_EDIT_BUTTON, { name: tag.name })}
                  aria-haspopup="dialog" onClick={() => setEditTag({ ...tag, id: editId })}
                  sx={{ ...folderButtonSx, opacity: activeTag === tag.name ? 0.8 : 0 }}>
                  <EditOutlinedIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={t('deleteTag')} placement="right" arrow>
              <IconButton
                size="small"
                aria-label={t('deleteTag')}
                onClick={(event) => void handleDeleteTag(tag, event)}
                sx={rowButtonSx}
              >
                <DeleteIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Box>
        }
        sx={{ pr: (tagFoldersAvailable || folderName !== undefined ? 7 : 4) + (editId ? 3 : 0) }}
        disablePadding
        onDragOver={(event) => {
          if (!isBookDrag(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDragOverTag(rowKey);
        }}
        onDragLeave={() => setDragOverTag(null)}
        onDrop={(event) => { if (isBookDrag(event)) void handleDropOnTag(tag.name, event); }}
      >
        <ListItemButton
          selected={activeTag === tag.name}
          onClick={() => { go(path); onMobileClose(); }}
          sx={{
            borderRadius: 1,
            mx: 1,
            pl: folderName === undefined ? 1.5 : 3.5,
            py: 0.4,
            outline: dragOver ? '2px solid' : 'none',
            outlineColor: 'secondary.main',
            backgroundColor: dragOver ? 'rgba(34, 197, 94, 0.16)' : undefined,
            color: sidebarTextPrimary,
            '&:hover': { backgroundColor: sidebarHover },
            '&.Mui-selected': {
              color: sidebarTextPrimary,
              backgroundColor: `${tag.color}29`,
              boxShadow: `inset 3px 0 0 ${tag.color}`,
              '&:hover': { backgroundColor: 'rgba(34, 197, 94, 0.16)' },
            },
          }}
        >
          <ListItemText
            primary={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <TagGlyph icon={tag.icon} data-testid="lnb-tag-icon" sx={{ fontSize: 14, flexShrink: 0, color: tag.color }} />
                <Typography noWrap variant="body2" sx={{ fontSize: '0.8rem', flex: 1 }}>
                  <DisplayName value={tag.name} />
                </Typography>
                <Typography variant="caption" sx={{ color: sidebarTextDisabled, fontSize: '0.68rem', flexShrink: 0 }}>
                  {tag.bookCount}
                </Typography>
              </Box>
            }
            disableTypography
          />
        </ListItemButton>
      </ListItem>
    );
  };

  const renderTagFolder = (folder: TagFolder) => {
    const open = !collapsedTagFolders.has(folder.name);
    const dragOver = dragOverTagFolder === folder.name;
    const members = folder.tags.map((name) => tagsByName.get(name)).filter((tag): tag is TagSummary => Boolean(tag));
    return (
      <Box
        component="li"
        key={folder.name}
        data-testid="lnb-tag-folder"
        onDragOver={(event) => {
          if (!isTagDrag(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDragOverTagFolder(folder.name);
        }}
        onDragLeave={(event) => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
          setDragOverTagFolder((current) => current === folder.name ? null : current);
        }}
        onDrop={(event) => { if (isTagDrag(event)) handleDropOnTagFolder(folder.name, event); }}
        sx={{
          borderRadius: 1,
          outline: dragOver ? '2px solid' : 'none',
          outlineColor: sidebarAccent,
          outlineOffset: -2,
          backgroundColor: dragOver ? 'action.selected' : undefined,
        }}
      >
        <ListItem
          component="div"
          className="pdfit-tag-row"
          disablePadding
          secondaryAction={
            <Tooltip title={t('deleteTagFolder')} placement="right" arrow>
              <IconButton
                size="small"
                data-testid="lnb-tag-folder-delete"
                aria-label={`${folder.name} ${t('deleteTagFolder')}`}
                onClick={(event) => { event.stopPropagation(); setConfirmDelete({ kind: 'tag_folder', name: folder.name }); }}
                sx={{ p: 0.25, color: sidebarTextSecondary, opacity: 0, transition: 'opacity 120ms ease', '.pdfit-tag-row:hover &, .pdfit-tag-row:focus-within &': { opacity: 0.8 }, '&:focus-visible, &:hover': { opacity: 1, color: 'error.main', bgcolor: sidebarHover }, '@media (hover: none)': { opacity: 0.8 } }}
              >
                <DeleteIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          }
          sx={{ pr: 4 }}
        >
          <ListItemButton
            data-testid="lnb-tag-folder-toggle"
            aria-expanded={open}
            aria-label={folder.name}
            onClick={() => toggleTagFolder(folder.name)}
            sx={{
              borderRadius: 1,
              mx: 1,
              pl: 0.75,
              py: 0.4,
              color: sidebarTextPrimary,
              '&:hover': { backgroundColor: sidebarHover },
            }}
          >
            <ListItemText
              primary={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {open
                    ? <ExpandMoreIcon aria-hidden sx={{ fontSize: 16, flexShrink: 0, color: sidebarTextSecondary }} />
                    : <ChevronRightIcon aria-hidden sx={{ fontSize: 16, flexShrink: 0, color: sidebarTextSecondary }} />}
                  <FolderOutlinedIcon aria-hidden sx={{ fontSize: 15, flexShrink: 0, color: sidebarAccent }} />
                  <Typography noWrap variant="body2" sx={{ fontSize: '0.8rem', flex: 1 }}>
                    <DisplayName value={folder.name} />
                  </Typography>
                  <Typography data-testid="lnb-tag-folder-count" variant="caption" sx={{ color: sidebarTextDisabled, fontSize: '0.68rem', flexShrink: 0 }}>
                    {members.length}
                  </Typography>
                </Box>
              }
              disableTypography
            />
          </ListItemButton>
        </ListItem>
        {open && (
          <List dense disablePadding data-testid="lnb-tag-folder-tags">
            {members.length === 0
              ? <Typography component="li" variant="caption" sx={{ color: sidebarTextDisabled, pl: 4.5, pr: 2, display: 'block', py: 0.25 }}>{t('tagFolderEmpty')}</Typography>
              : members.map((tag) => renderTagRow(tag, folder.name))}
          </List>
        )}
      </Box>
    );
  };

  return (
    <>
      <Drawer
        variant={isMobile ? 'temporary' : 'permanent'}
        open={!isMobile || mobileOpen}
        onClose={onMobileClose}
        sx={{
          width: { md: LNB_WIDTH },
          flexShrink: 0,
          '& .MuiDrawer-root': { width: LNB_WIDTH },
          '& .MuiDrawer-paper': {
            width: LNB_WIDTH,
            height: '100dvh',
            top: 0,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            backgroundColor: sidebarBackground,
            color: sidebarTextPrimary,
            borderRight: '1px solid',
            borderColor: sidebarDivider,
          },
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '40px minmax(0, 1fr) auto',
            alignItems: 'center',
            gap: 1.25,
            px: 1.75,
            py: 1.5,
            flexShrink: 0,
            borderBottom: '1px solid', borderColor: sidebarDivider,
          }}
        >
          <Box component={Link} to="/" data-testid="lnb-home-link" aria-label={ui('메인화면으로 이동')} title={ui('메인화면으로 이동')} sx={{ gridColumn: '1 / 3', display: 'grid', gridTemplateColumns: '40px minmax(0, 1fr)', alignItems: 'center', gap: 1.25, minWidth: 0, textDecoration: 'none', borderRadius: 1, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 3 }, '&:hover': { bgcolor: sidebarHover } }}>
          <Box component="img" src="/brand/pdfit-logo-dark.png" alt="" aria-hidden="true" sx={{ width: 48, height: 48, objectFit: 'contain' }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="subtitle1"
              fontWeight={700}
              sx={{ overflow: 'hidden', color: sidebarTextPrimary, textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}
            >
              {appName}
            </Typography>
            <Typography
              variant="caption"
              sx={{ display: 'block', mt: 0.35, color: sidebarTextSecondary, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.08em' }}
            >
              v{appVersion}
            </Typography>
          </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Tooltip title={t('language')} placement="bottom" arrow>
              <IconButton data-testid="lnb-preferences" size="small" aria-label={t('language')} aria-haspopup="dialog" onClick={() => setPreferencesOpen(true)} sx={{ color: sidebarTextSecondary, '&:hover': { color: sidebarTextPrimary, bgcolor: sidebarHover } }}>
                <LanguageIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {extraSidebarItems.filter((item) => !item.placement || item.placement === 'header').map((item) => (
              <Tooltip key={item.path} title={sidebarLabel(item)} placement="bottom" arrow>
                <IconButton
                  size="small"
                  aria-label={sidebarLabel(item)}
                  onClick={() => { go(item.path); onMobileClose(); }}
                  color={isActive(item.path) ? 'primary' : 'inherit'}
                  sx={{
                    color: isActive(item.path) ? sidebarAccent : sidebarTextSecondary,
                    '&:hover': { color: sidebarTextPrimary, bgcolor: sidebarHover },
                  }}
                >
                  {item.icon}
                </IconButton>
              </Tooltip>
            ))}
          </Box>
        </Box>

        <Box
          component="form"
          role="search"
          data-testid="lnb-search"
          aria-label={t('searchBooksPlaceholder')}
          onSubmit={submitSearch}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 1, flexShrink: 0, borderBottom: '1px solid', borderColor: sidebarDivider }}
        >
          <TextField
            fullWidth
            size="small"
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={t('searchBooksPlaceholder')}
            inputProps={{ 'aria-label': t('searchBooksPlaceholder'), 'data-testid': 'lnb-search-input', maxLength: 200, enterKeyHint: 'search' }}
            InputProps={{
              endAdornment: searchText ? (
                <IconButton size="small" edge="end" data-testid="lnb-search-clear" aria-label={t('clearPdfSearch')} onClick={() => setSearchText('')} sx={{ color: sidebarTextSecondary }}>
                  <ClearIcon sx={{ fontSize: 16 }} />
                </IconButton>
              ) : undefined,
            }}
            sx={{
              '& .MuiOutlinedInput-root': { height: 34, fontSize: '0.85rem' },
              // 브라우저 기본 검색 지우기 버튼은 위의 지우기 버튼과 겹치므로 숨긴다.
              '& input[type="search"]::-webkit-search-cancel-button': { display: 'none' },
            }}
          />
          <Tooltip title={t('searchButton')} placement="bottom" arrow>
            <span>
              <IconButton type="submit" data-testid="lnb-search-submit" aria-label={t('searchButton')} disabled={!searchText.trim()} size="small" sx={{ width: 34, height: 34, borderRadius: 1, color: selectedAccent, border: '1px solid', borderColor: sidebarDivider, '&:hover': { bgcolor: sidebarHover } }}>
                <SearchIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {extraSidebarItems.some((item) => item.placement === 'primary') && (
            <List dense disablePadding sx={{ pt: 0.75, pb: 0.25 }}>
              {extraSidebarItems.filter((item) => item.placement === 'primary').map((item) => (
                <ListItemButton
                  key={item.path}
                  data-testid={`lnb-primary-${item.path.replace(/^\//, '').replace(/\//g, '-')}`}
                  selected={isActive(item.path)}
                  onClick={() => { go(item.path); onMobileClose(); }}
                  sx={{ borderRadius: 1, mx: 1, py: 0.75, color: sidebarTextPrimary, '&:hover': { bgcolor: sidebarHover }, '&.Mui-selected': { color: sidebarTextPrimary, backgroundColor: selectedNavigationBackground, boxShadow: `inset 3px 0 0 ${selectedAccent}`, '&:hover': { backgroundColor: selectedNavigationBackground } } }}
                >
                  <ListItemIcon sx={{ minWidth: 28, color: isActive(item.path) ? selectedAccent : sidebarTextSecondary }}>{item.icon}</ListItemIcon>
                  <ListItemText primary={<Typography variant="caption" fontWeight={700} letterSpacing={0.7}>{sidebarLabel(item)}</Typography>} />
                </ListItemButton>
              ))}
            </List>
          )}
          {favoritesAvailable && (
            <List dense disablePadding sx={{ pt: 0.5, pb: 0.25 }}>
              <ListItemButton
                data-testid="lnb-favorites"
                aria-label={t('favorites')}
                selected={isActive(FAVORITES_PATH)}
                onClick={() => { go(FAVORITES_PATH); onMobileClose(); }}
                sx={{ borderRadius: 1, mx: 1, py: 0.6, color: sidebarTextPrimary, '&:hover': { bgcolor: sidebarHover }, '&.Mui-selected': { color: sidebarTextPrimary, backgroundColor: selectedNavigationBackground, boxShadow: `inset 3px 0 0 ${selectedAccent}`, '&:hover': { backgroundColor: selectedNavigationBackground } } }}
              >
                <ListItemIcon sx={{ minWidth: 28 }}><StarRoundedIcon aria-hidden sx={{ fontSize: 18, color: '#fbbf24' }} /></ListItemIcon>
                <ListItemText primary={<Typography variant="caption" fontWeight={700}>{t('favorites')}</Typography>} />
                <Typography data-testid="lnb-favorites-count" variant="caption" aria-hidden="true" sx={{ color: sidebarTextDisabled, fontSize: '0.68rem' }}>{favoriteCount}</Typography>
              </ListItemButton>
            </List>
          )}
          <Box>
            <Box
              role="button"
              tabIndex={0}
              aria-label={t('tags')}
              aria-expanded={tagsOpen}
              data-testid="lnb-tags-section"
              sx={{
                px: 1.5,
                py: 0.75,
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer',
                color: sidebarTextSecondary,
                '&:hover': { backgroundColor: sidebarHover },
              }}
              onClick={() => setTagsOpen((value) => !value)}
              onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setTagsOpen((value) => !value); } }}
            >
              {tagsOpen ? (
                <ExpandMoreIcon sx={{ fontSize: 16, color: sidebarTextSecondary, mr: 0.5 }} />
              ) : (
                <ChevronRightIcon sx={{ fontSize: 16, color: sidebarTextSecondary, mr: 0.5 }} />
              )}
              <Tooltip title={t('tags')} placement="right" arrow><TagIcon sx={{ fontSize: 18, color: sidebarAccent }} /></Tooltip>
              <Typography variant="caption" sx={{ ml: 0.75, fontWeight: 700 }}>{t('tags')}</Typography>
              {/* 헤더 행 자체가 접기/펼치기 버튼이므로 클릭이 행으로 올라가지 않게 막는다. */}
              {tagFoldersAvailable && (
                <Tooltip title={t('createTagFolder')} placement="bottom" arrow>
                  <IconButton
                    data-testid="lnb-create-tag-folder"
                    size="small"
                    aria-label={t('createTagFolder')}
                    aria-haspopup="dialog"
                    onClick={(event) => { event.stopPropagation(); setTagFolderError(null); setNewTagFolderName(''); setTagFolderDialogOpen(true); }}
                    sx={{ ml: 'auto', mr: 0.5, p: 0.25, color: sidebarTextSecondary, '&:hover': { color: sidebarTextPrimary, bgcolor: sidebarHover } }}
                  >
                    <CreateNewFolderOutlinedIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title={t('tagIndexOpen')} placement="bottom" arrow>
                <IconButton
                  data-testid="lnb-tag-index"
                  size="small"
                  aria-label={t('tagIndexOpen')}
                  aria-current={isActive(TAG_INDEX_PATH) ? 'page' : undefined}
                  onClick={(event) => { event.stopPropagation(); go(TAG_INDEX_PATH); onMobileClose(); }}
                  sx={{
                    ml: tagFoldersAvailable ? 0 : 'auto',
                    mr: 0.5,
                    p: 0.25,
                    color: isActive(TAG_INDEX_PATH) ? selectedAccent : sidebarTextSecondary,
                    '&:hover': { color: sidebarTextPrimary, bgcolor: sidebarHover },
                  }}
                >
                  <ViewQuiltOutlinedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
              <Typography
                data-testid="tag-assignment-total"
                variant="caption"
                title={t('tagAssignmentTotal', { count: totalTagAssignments })}
                aria-label={t('tagAssignmentTotal', { count: totalTagAssignments })}
                sx={{ color: sidebarTextSecondary, minWidth: 24, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
              >
                {totalTagAssignments}
              </Typography>
            </Box>

            <Collapse in={tagsOpen} timeout="auto" unmountOnExit>
              <List dense disablePadding sx={{ pb: tags.length === 0 ? 0 : undefined }}>
                <ListItem disablePadding data-testid="lnb-untagged-row">
                  <ListItemButton
                    data-testid="lnb-untagged"
                    selected={location.pathname === UNTAGGED_PATH}
                    onClick={() => { go(UNTAGGED_PATH); onMobileClose(); }}
                    sx={{
                      borderRadius: 1,
                      mx: 1,
                      pl: 1.5,
                      py: 0.4,
                      color: sidebarTextPrimary,
                      '&:hover': { backgroundColor: sidebarHover },
                      '&.Mui-selected': {
                        color: sidebarTextPrimary,
                        backgroundColor: selectedNavigationBackground,
                        boxShadow: `inset 3px 0 0 ${selectedAccent}`,
                        '&:hover': { backgroundColor: selectedNavigationBackground },
                      },
                    }}
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <LabelOffOutlinedIcon aria-hidden data-testid="lnb-untagged-icon" sx={{ fontSize: 14, flexShrink: 0, color: sidebarTextSecondary }} />
                          <Typography noWrap variant="body2" sx={{ fontSize: '0.8rem', flex: 1 }}>{t('untagged')}</Typography>
                          <Typography data-testid="lnb-untagged-count" variant="caption" sx={{ color: sidebarTextDisabled, fontSize: '0.68rem', flexShrink: 0 }}>
                            {untaggedCount}
                          </Typography>
                        </Box>
                      }
                      disableTypography
                    />
                  </ListItemButton>
                </ListItem>
              </List>
              {tagFoldersAvailable && tagFolders.length > 0 && (
                <List dense disablePadding data-testid="lnb-tag-folders">
                  {tagFolders.map(renderTagFolder)}
                </List>
              )}
              {tags.length === 0 ? (
                <Typography variant="caption" sx={{ color: sidebarTextDisabled, px: 2, display: 'block', py: 0.5, pb: 1 }}>
                  {t('addTagHint')}
                </Typography>
              ) : (
                <List dense disablePadding sx={{ pb: 1 }}>
                  {rootTags.map((tag) => renderTagRow(tag))}
                </List>
              )}
            </Collapse>
          </Box>
          <Box>
            <Box
              role="button"
              tabIndex={0}
              aria-label={t('folders')}
              aria-expanded={foldersOpen}
              data-testid="lnb-folders-section"
              sx={{
                px: 1.5,
                py: 0.75,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                color: sidebarTextSecondary,
                '&:hover': { backgroundColor: sidebarHover },
              }}
              onClick={() => setFoldersOpen((value) => !value)}
              onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setFoldersOpen((value) => !value); } }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {foldersOpen ? (
                  <ExpandMoreIcon sx={{ fontSize: 16, color: sidebarTextSecondary }} />
                ) : (
                  <ChevronRightIcon sx={{ fontSize: 16, color: sidebarTextSecondary }} />
                )}
                <Tooltip title={t('folders')} placement="right" arrow><FolderIcon sx={{ fontSize: 18, color: sidebarAccent }} /></Tooltip>
              <Typography variant="caption" sx={{ ml: 0.75, fontWeight: 700 }}>{t('folders')}</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                <Tooltip title={t('refreshFolders')} placement="right" arrow>
                  <span>
                    <IconButton
                      size="small"
                      aria-label={t('refreshFolders')}
                      onClick={(event) => { event.stopPropagation(); void handleRefresh(); }}
                      disabled={refreshing}
                      sx={{ p: 0.25, color: sidebarTextSecondary, '&:hover': { color: sidebarTextPrimary, bgcolor: sidebarHover } }}
                    >
                      {refreshing ? <CircularProgress size={14} /> : <RefreshIcon sx={{ fontSize: 16 }} />}
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={t('createFolder')} placement="right" arrow>
                  <IconButton
                    size="small"
                    data-testid="create-folder-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setDialogOpen(true);
                    }}
                    sx={{ p: 0.25, color: sidebarTextSecondary, '&:hover': { color: sidebarTextPrimary, bgcolor: sidebarHover } }}
                  >
                    <CreateNewFolderIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>

            <Collapse in={foldersOpen} timeout="auto" unmountOnExit>
              {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
                  <CircularProgress size={14} />
                </Box>
              ) : folders.length === 0 ? (
                <Typography variant="caption" sx={{ color: sidebarTextDisabled, px: 2, display: 'block', pb: 1 }}>
                  {t('createFolderHint')}
                </Typography>
              ) : (
                <List dense disablePadding>
                  {folders.map((folder) => {
                    const folderPath = `/folder/${encodeURIComponent(folder.name)}`;
                    const selected = location.pathname === folderPath;
                    const dragOver = dragOverFolder === folder.name;

                    return (
                      <ListItem
                        key={folder.name}
                        data-testid="lnb-folder-row"
                        disablePadding
                        secondaryAction={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                            <Tooltip title={t('renameFolder')} placement="right" arrow>
                              <IconButton
                                size="small"
                                data-testid="lnb-folder-rename"
                                aria-label={`${folder.name} ${t('renameFolder')}`}
                                onClick={(event) => openRenameFolder(folder, event)}
                                sx={{ p: 0.5, color: sidebarTextSecondary, opacity: 0.8, '&:hover': { opacity: 1, color: sidebarTextPrimary, bgcolor: sidebarHover } }}
                              >
                                <EditOutlinedIcon sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Tooltip>
                            {!folder.isRoot && <Tooltip title={t('deleteFolder')} placement="right" arrow>
                              <IconButton
                                size="small"
                                data-testid="lnb-folder-delete"
                                aria-label={`${folder.name} ${t('deleteFolder')}`}
                                onClick={(event) => void handleDeleteFolder(folder.name, event)}
                                sx={{ p: 0.5, color: sidebarTextSecondary, opacity: 0.8, '&:hover': { opacity: 1, color: 'error.main', bgcolor: sidebarHover } }}
                              >
                                <DeleteIcon sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Tooltip>}
                            {folder.isRoot && <Box aria-hidden="true" sx={{ width: 24, height: 24 }} />}
                          </Box>
                        }
                        sx={{ pr: 7 }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                          setDragOverFolder(folder.name);
                        }}
                        onDragLeave={() => setDragOverFolder(null)}
                        onDrop={(event) => void handleDropOnFolder(folder.name, event)}
                      >
                        <ListItemButton
                          selected={selected}
                          onClick={() => { go(folderPath); onMobileClose(); }}
                          sx={{
                            borderRadius: 1,
                            mx: 1,
                            py: 0.5,
                            outline: dragOver ? '2px solid' : 'none',
                            outlineColor: sidebarAccent,
                            backgroundColor: dragOver ? 'action.selected' : undefined,
                            color: sidebarTextPrimary,
                            '&:hover': { backgroundColor: sidebarHover },
                            '&.Mui-selected': {
                              color: sidebarTextPrimary,
                              backgroundColor: selectedNavigationBackground,
                              boxShadow: `inset 3px 0 0 ${selectedAccent}`,
                              '&:hover': { backgroundColor: selectedNavigationBackground },
                            },
                          }}
                        >
                          <ListItemText
                            primary={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Typography noWrap variant="body2" sx={{ fontSize: '0.8rem', flex: 1 }}>
                                  <DisplayName value={folder.name} />
                                </Typography>
                                <Typography
                                  variant="caption"
                                  sx={{ color: selected ? sidebarTextPrimary : sidebarTextDisabled, fontSize: '0.68rem', flexShrink: 0, minWidth: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                                >
                                  {t('pdfCount', { count: folder.pdfCount })}
                                </Typography>
                              </Box>
                            }
                            disableTypography
                          />
                        </ListItemButton>
                      </ListItem>
                    );
                  })}
                </List>
              )}
            </Collapse>
          </Box>

          <List dense disablePadding sx={{ py: 0.5 }}>
            <Tooltip title={t('bookmarks')} placement="right" arrow>
              <ListItemButton
                data-testid="lnb-bookmarks"
                aria-label={t('bookmarks')}
                selected={isActive('/bookmarks')}
                onClick={() => { go('/bookmarks'); onMobileClose(); }}
                sx={{ borderRadius: 1, mx: 1, py: 0.6, color: sidebarTextPrimary, '&:hover': { bgcolor: sidebarHover }, '&.Mui-selected': { color: sidebarTextPrimary, backgroundColor: selectedNavigationBackground, boxShadow: `inset 3px 0 0 ${selectedAccent}`, '&:hover': { backgroundColor: selectedNavigationBackground } } }}
              >
                <ListItemIcon sx={{ minWidth: 28 }}><AttachFileIcon sx={{ fontSize: 17, color: sidebarAccent }} /></ListItemIcon>
                <ListItemText primary={<Typography variant="caption" fontWeight={700}>{t('bookmarks')}</Typography>} />
                <Typography variant="caption" aria-hidden="true" sx={{ color: sidebarTextDisabled, fontSize: '0.68rem' }}>{bookmarkCount}</Typography>
              </ListItemButton>
            </Tooltip>
          </List>
        </Box>
        {extraSidebarItems.some((item) => item.placement === 'footer') && (
          <List dense disablePadding sx={{ flexShrink: 0, py: 0.5, borderTop: '1px solid', borderColor: sidebarDivider }}>
            {extraSidebarItems.filter((item) => item.placement === 'footer').map((item) => (
              <ListItemButton
                key={item.path}
                data-testid={`lnb-footer-${item.path.replace(/^\//, '').replace(/\//g, '-')}`}
                selected={isActive(item.path)}
                onClick={() => { go(item.path); onMobileClose(); }}
                sx={{ borderRadius: 1, mx: 1, py: 0.65, color: sidebarTextPrimary, '&:hover': { bgcolor: sidebarHover }, '&.Mui-selected': { color: sidebarTextPrimary, backgroundColor: selectedNavigationBackground, boxShadow: `inset 3px 0 0 ${selectedAccent}`, '&:hover': { backgroundColor: selectedNavigationBackground } } }}
              >
                <ListItemIcon sx={{ minWidth: 28, color: isActive(item.path) ? selectedAccent : sidebarTextSecondary }}>{item.icon}</ListItemIcon>
                <ListItemText primary={<Typography variant="caption" fontWeight={700} letterSpacing={0.5}>{sidebarLabel(item)}</Typography>} />
              </ListItemButton>
            ))}
          </List>
        )}
        {extraSidebarFooter && (
          <Box sx={{ flexShrink: 0, color: sidebarTextPrimary, borderTop: '1px solid', borderColor: sidebarDivider }}>
            {extraSidebarFooter}
          </Box>
        )}
      </Drawer>

      {editTag && <TagEditDialog tag={editTag} onClose={() => setEditTag(null)} />}

      <Menu
        anchorEl={tagFolderMenu?.anchor}
        open={tagFolderMenu !== null}
        onClose={() => setTagFolderMenu(null)}
        MenuListProps={{ id: tagFolderMenuId, 'aria-label': t(RSC.SIDEBAR_TAGFOLDER_MOVE_BUTTON) }}
        PaperProps={{ sx: { maxHeight: 320, maxWidth: 'min(320px, calc(100vw - 32px))' } }}
      >
        {tagFolders.length === 0
          ? <MenuItem disabled>{t(RSC.SIDEBAR_TAGFOLDER_NOFOLDERS_MESSAGE)}</MenuItem>
          : tagFolders.map((folder) => (
            <MenuItem
              key={folder.name}
              onClick={() => {
                if (!tagFolderMenu) return;
                setTagFolderMenu(null);
                addTagToFolder(folder.name, tagFolderMenu.tag);
              }}
            >
              <Typography noWrap variant="body2"><DisplayName value={folder.name} /></Typography>
            </MenuItem>
          ))}
      </Menu>
      <TagNoticeSnackbar
        notice={tagFolderAssignmentFailed ? { severity: 'error', message: t(RSC.SIDEBAR_TAGFOLDER_ASSIGNFAILED_ALERT) } : null}
        onClose={() => setTagFolderAssignmentFailed(false)}
      />

      <Dialog open={preferencesOpen} onClose={() => setPreferencesOpen(false)} maxWidth="xs" fullWidth aria-labelledby="pdfit-preferences-title" data-testid="preferences-dialog">
        <DialogTitle id="pdfit-preferences-title">{t('settings')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {languagePreference && selectedLanguage && (
            <FormControl fullWidth size="small" sx={{ mt: 1 }}>
              <InputLabel id="pdfit-preferences-language-label">{t('language')}</InputLabel>
              <Select
                data-testid="preferences-language"
                labelId="pdfit-preferences-language-label"
                label={t('language')}
                value={selectedLanguage}
                onChange={(event) => languagePreference.model.setLanguage(event.target.value as PdfitLanguage)}
              >
                {(Object.entries(languagePreference.labels(selectedLanguage)) as [PdfitLanguage, string][]).map(([option, label]) => <MenuItem key={option} value={option}>{label}</MenuItem>)}
              </Select>
            </FormControl>
          )}
          <ToggleButtonGroup
            data-testid="preferences-color-mode"
            exclusive
            fullWidth
            value={colorMode}
            onChange={(_, value: 'light' | 'dark' | null) => { if (value) pdfitAppearancePreferenceModel.setMode(value); }}
            aria-label={`${t('darkMode')} / ${t('lightMode')}`}
          >
            <ToggleButton value="dark" sx={{ gap: 1 }}><DarkModeOutlinedIcon fontSize="small" />{t('darkMode')}</ToggleButton>
            <ToggleButton value="light" sx={{ gap: 1 }}><LightModeOutlinedIcon fontSize="small" />{t('lightMode')}</ToggleButton>
          </ToggleButtonGroup>
        </DialogContent>
        <DialogActions><Button onClick={() => setPreferencesOpen(false)}>{t('close')}</Button></DialogActions>
      </Dialog>

      <Dialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setNewFolderName('');
          setError(null);
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t('createFolder')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label={t('folderName')}
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void handleCreate();
              }
            }}
            disabled={creating}
            error={Boolean(error)}
            helperText={error ?? ''}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDialogOpen(false);
              setNewFolderName('');
              setError(null);
            }}
            disabled={creating}
          >
            {t('cancel')}
          </Button>
          <Button variant="contained" onClick={() => void handleCreate()} disabled={!newFolderName.trim() || creating}>
            {creating ? t('creating') : t('create')}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={tagFolderDialogOpen}
        onClose={() => { if (!creatingTagFolder) setTagFolderDialogOpen(false); }}
        maxWidth="xs"
        fullWidth
        data-testid="create-tag-folder-dialog"
      >
        <DialogTitle>{t('createTagFolder')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            data-testid="create-tag-folder-input"
            label={t('tagFolderName')}
            value={newTagFolderName}
            onChange={(event) => { setNewTagFolderName(event.target.value); setTagFolderError(null); }}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void handleCreateTagFolder(); }}
            disabled={creatingTagFolder}
            error={Boolean(tagFolderError)}
            helperText={tagFolderError ?? ''}
            inputProps={{ maxLength: 100 }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTagFolderDialogOpen(false)} disabled={creatingTagFolder}>{t('cancel')}</Button>
          <Button data-testid="create-tag-folder-save" variant="contained" onClick={() => void handleCreateTagFolder()} disabled={!newTagFolderName.trim() || creatingTagFolder}>
            {creatingTagFolder ? t('creating') : t('create')}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(renameTarget)}
        onClose={() => { if (!renaming) setRenameTarget(null); }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t('renameFolder')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            data-testid="rename-folder-input"
            label={t('folderName')}
            value={renameName}
            onChange={(event) => { setRenameName(event.target.value); setRenameError(null); }}
            onKeyDown={(event) => { if (event.key === 'Enter') void handleRenameFolder(); }}
            disabled={renaming}
            error={Boolean(renameError)}
            helperText={renameError ?? ''}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameTarget(null)} disabled={renaming}>{t('cancel')}</Button>
          <Button data-testid="rename-folder-save" variant="contained" onClick={() => void handleRenameFolder()} disabled={!renameName.trim() || renameName.trim() === renameTarget?.name || renaming}>
            {renaming ? t('renaming') : t('save')}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('deleteConfirmation')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ whiteSpace: confirmDelete?.kind === 'all_tags' ? 'pre-line' : 'normal' }}>
            {confirmDelete?.kind === 'folder'
              ? t('deleteFolderQuestion', { name: confirmDelete.name })
              : confirmDelete?.kind === 'tag_folder'
                ? t('deleteTagFolderQuestion', { name: confirmDelete.name })
              : confirmDelete?.kind === 'all_tags'
                ? t('deleteAllTagsQuestion', { count: confirmDelete.count ?? 0 })
                : t('deleteTagQuestion', { name: confirmDelete?.name ?? '', count: confirmDelete?.count ?? 0 })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="error" onClick={() => setConfirmDelete(null)}>{t('cancel')}</Button>
          <Button color="error" variant="contained" sx={{ bgcolor: "error.dark", "&:hover": { bgcolor: "error.main" } }} onClick={() => void confirmDeleteItem()}>{t('delete')}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

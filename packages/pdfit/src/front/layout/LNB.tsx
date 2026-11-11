import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import LabelOffOutlinedIcon from '@mui/icons-material/LabelOffOutlined';
import ViewQuiltOutlinedIcon from '@mui/icons-material/ViewQuiltOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FolderIcon from '@mui/icons-material/Folder';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import TagIcon from '../components/HashTagIcon.js';
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
import { folderLibraryModel } from '../model/folderLibraryModel';
import { listAllBookmarks } from '../api/bookmarks';
import { subscribeBookmarkChanges } from '../model/bookmarkEvents.js';
import type { PdfitLanguage } from '../model/languagePreference.js';
import { distinctTagColor } from '../../shared/tagColor.js';
import { UNTAGGED_PATH } from '../model/untagged.js';
import { TAG_INDEX_PATH } from '../model/tagIndex.js';
import { TAG_SUMMARY_OPTIMISTIC_EVENT, type TagSummaryOptimisticDetail } from '../model/tagSummaryEvents.js';
import { usePdfitI18n, useTranslatedDisplayText } from '../i18n/usePdfitI18n.js';
import { pdfitAppearancePreferenceModel } from '../model/appearancePreference.js';
import { synchronizeLibraryMetadata } from '../model/libraryMetadataSync.js';

export const LNB_WIDTH = 288;

export interface DragPayload {
  folder: string;
  filename: string;
  driveFileId?: string;
}

export const DRAG_TYPE = 'application/pdf-item';

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
  const [untaggedCount, setUntaggedCount] = useState(0);
  const [bookmarkCount, setBookmarkCount] = useState(0);
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
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'folder' | 'tag' | 'all_tags'; name: string; count?: number } | null>(null);

  // 태그는 이름의 유니코드(UTF-16 코드 유닛) 순으로 정렬한다. 로케일 비교나 분류 그룹 순서는 쓰지 않는다.
  const orderedTags = useMemo(
    () => [...tags].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)),
    [tags],
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
    try {
      const data = await tagsApi.listSummary();
      setTags(data);
    } catch {
      // keep current tag list on error
    }
    try {
      setUntaggedCount(await tagsApi.countUntaggedBooks());
    } catch {
      // 미분류 개수를 못 구해도 마지막 값을 유지한다
    }
  }, []);

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
      await Promise.all([loadFolders(), loadTags(), loadBookmarkCount()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : ui("새로고침에 실패했습니다."));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;
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
        await Promise.all([loadFolders(), loadTags(), loadBookmarkCount()]);
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

    return () => {
      window.removeEventListener('folders-changed', onFolderChange);
      window.removeEventListener('tags-changed', onTagChange);
      window.removeEventListener(TAG_SUMMARY_OPTIMISTIC_EVENT, onOptimisticTagChange);
      unsubscribeBookmarks();
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
        await onAiTagRemoved?.({ tag: target.name });
      } else {
        await tagsApi.deleteAll();
        await onAiTagRemoved?.({});
        setTags([]);
        folderLibraryModel.invalidateTags();
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
      await Promise.all([loadFolders(), loadTags()]);
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
              <Tooltip title={t('tagIndexOpen')} placement="bottom" arrow>
                <IconButton
                  data-testid="lnb-tag-index"
                  size="small"
                  aria-label={t('tagIndexOpen')}
                  aria-current={isActive(TAG_INDEX_PATH) ? 'page' : undefined}
                  onClick={(event) => { event.stopPropagation(); go(TAG_INDEX_PATH); onMobileClose(); }}
                  sx={{
                    ml: 'auto',
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
              {tags.length === 0 ? (
                <Typography variant="caption" sx={{ color: sidebarTextDisabled, px: 2, display: 'block', py: 0.5, pb: 1 }}>
                  {t('addTagHint')}
                </Typography>
              ) : (
                <List dense disablePadding sx={{ pb: 1 }}>
                  {orderedTags.map((tag) => {
                        const tagPath = `/tag/${encodeURIComponent(tag.name)}`;
                        const dragOver = dragOverTag === tag.name;
                        return (
                          <ListItem
                            key={tag.name}
                            className="pdfit-tag-row"
                            secondaryAction={
                              <Tooltip title={t('deleteTag')} placement="right" arrow>
                                <IconButton
                                  size="small"
                                  aria-label={t('deleteTag')}
                                  onClick={(event) => void handleDeleteTag(tag, event)}
                                  sx={{ p: 0.25, color: sidebarTextSecondary, opacity: 0, transition: 'opacity 120ms ease', '.pdfit-tag-row:hover &, .pdfit-tag-row:focus-within &': { opacity: 0.8 }, '&:focus-visible, &:hover': { opacity: 1, color: 'error.main', bgcolor: sidebarHover }, '@media (hover: none)': { opacity: 0.8 } }}
                                >
                                  <DeleteIcon sx={{ fontSize: 14 }} />
                                </IconButton>
                              </Tooltip>
                            }
                            sx={{ pr: 4 }}
                            disablePadding
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = 'copy';
                              setDragOverTag(tag.name);
                            }}
                            onDragLeave={() => setDragOverTag(null)}
                            onDrop={(event) => void handleDropOnTag(tag.name, event)}
                          >
                            <ListItemButton
                              selected={location.pathname === tagPath}
                              onClick={() => { go(tagPath); onMobileClose(); }}
                              sx={{
                                borderRadius: 1,
                                mx: 1,
                                pl: 1.5,
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
                                    <LocalOfferOutlinedIcon aria-hidden data-testid="lnb-tag-icon" sx={{ fontSize: 14, flexShrink: 0, color: tag.color }} />
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
                  })}
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

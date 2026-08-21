import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FolderIcon from '@mui/icons-material/Folder';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import LanguageIcon from '@mui/icons-material/Language';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePdfitFrontConfig } from '../context';
import { foldersApi, type FolderInfo } from '../api/folders';
import { tagsApi, type TagSummary } from '../api/tags';
import TagColorPicker from '../components/TagColorPicker';
import { folderLibraryModel } from '../model/folderLibraryModel';
import { listAllBookmarks } from '../api/bookmarks';
import { subscribeBookmarkChanges } from '../model/bookmarkEvents.js';
import type { PdfitLanguage } from '../model/languagePreference.js';

export const LNB_WIDTH = 288;

export interface DragPayload {
  folder: string;
  filename: string;
}

export const DRAG_TYPE = 'application/pdf-item';

const noopSubscribe = (_listener: () => void) => () => undefined;
const zeroVersion = () => 0;

interface LNBProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export default function LNB({ mobileOpen, onMobileClose }: LNBProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { appName, appVersion, extraSidebarItems, extraSidebarFooter, navigationGuard } = usePdfitFrontConfig();
  const go = (path: string) => navigate(navigationGuard?.(path) ?? path);
  const { languagePreference } = usePdfitFrontConfig();
  const [languageAnchor, setLanguageAnchor] = useState<HTMLElement | null>(null);
  useSyncExternalStore(
    languagePreference?.model.subscribe ?? noopSubscribe,
    languagePreference?.model.getVersion ?? zeroVersion,
    languagePreference?.model.getVersion ?? zeroVersion,
  );
  const selectedLanguage = languagePreference?.model.language;
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [bookmarkCount, setBookmarkCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [foldersOpen, setFoldersOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(true);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [dragOverTag, setDragOverTag] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'folder' | 'tag'; name: string; count?: number } | null>(null);

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
      folderLibraryModel.invalidateFiles();
      folderLibraryModel.invalidateTags();
      await Promise.all([loadFolders(), loadTags(), loadBookmarkCount()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '새로고침에 실패했습니다.');
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
    const onFolderChange = () => void loadFolders();
    const onTagChange = () => void loadTags();
    const onBookmarkChange = () => void loadBookmarkCount();

    window.addEventListener('folders-changed', onFolderChange);
    window.addEventListener('tags-changed', onTagChange);
    const unsubscribeBookmarks = subscribeBookmarkChanges(onBookmarkChange);

    return () => {
      window.removeEventListener('folders-changed', onFolderChange);
      window.removeEventListener('tags-changed', onTagChange);
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

  const confirmDeleteItem = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);

    try {
      if (target.kind === 'folder') {
        await foldersApi.delete(target.name);
        folderLibraryModel.drop(target.name);
        await loadFolders();
      } else {
        await tagsApi.delete(target.name);
        setTags((current) => current.filter((item) => item.name !== target.name));
        folderLibraryModel.invalidateTags();
      }
      if (target.kind === 'folder' && location.pathname === `/folder/${encodeURIComponent(target.name)}`) {
        go('/');
        onMobileClose();
      }
    } catch {
      // keep current UI state on error
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
      await foldersApi.moveFile(payload.folder, targetFolder, payload.filename);
      folderLibraryModel.get(payload.folder).removeFile(payload.filename);
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
      const currentTags = await tagsApi.listForBook(payload.folder, payload.filename);
      if (currentTags.includes(tag)) {
        return;
      }

      await tagsApi.addTag(payload.folder, payload.filename, tag);
      folderLibraryModel.get(payload.folder).addTag(payload.filename, tag);
      await loadTags();
      window.dispatchEvent(
        new CustomEvent('tag-added', {
          detail: { folder: payload.folder, filename: payload.filename, tag },
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
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            backgroundColor: '#1b1b1d',
            borderRight: '1px solid rgba(255, 255, 255, 0.06)',
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
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          <Box component="img" src="/brand/pdfit-logo-dark.png" alt="" aria-hidden="true" sx={{ width: 48, height: 48, objectFit: 'contain' }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="subtitle1"
              fontWeight={700}
              sx={{ overflow: 'hidden', color: '#fff', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}
            >
              {appName}
            </Typography>
            <Typography
              variant="caption"
              sx={{ display: 'block', mt: 0.35, color: '#9a9aa0', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.08em' }}
            >
              v{appVersion}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            {extraSidebarItems.filter((item) => item.placement !== 'primary').map((item) => (
              <Tooltip key={item.path} title={item.label} placement="bottom" arrow>
                <IconButton
                  size="small"
                  aria-label={item.label}
                  onClick={() => { go(item.path); onMobileClose(); }}
                  color={isActive(item.path) ? 'primary' : 'inherit'}
                  sx={{
                    color: isActive(item.path) ? 'primary.main' : '#9a9aa0',
                    '&:hover': { color: '#fff' },
                  }}
                >
                  {item.icon}
                </IconButton>
              </Tooltip>
            ))}
            {languagePreference && selectedLanguage && (() => {
              const labels = languagePreference.labels(selectedLanguage);
              return (
              <>
                <Tooltip title={languagePreference.selectorLabel(selectedLanguage)} placement="bottom" arrow>
                  <IconButton
                    size="small"
                    aria-label={languagePreference.selectorLabel(selectedLanguage)}
                    aria-controls={languageAnchor ? 'pdfit-language-menu' : undefined}
                    aria-expanded={languageAnchor ? 'true' : undefined}
                    aria-haspopup="menu"
                    onClick={(event) => setLanguageAnchor(event.currentTarget)}
                    sx={{ color: '#9a9aa0', '&:hover': { color: '#fff' } }}
                  >
                    <LanguageIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Menu
                  id="pdfit-language-menu"
                  anchorEl={languageAnchor}
                  open={Boolean(languageAnchor)}
                  onClose={() => setLanguageAnchor(null)}
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                  transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                  MenuListProps={{ 'aria-label': languagePreference.menuLabel(selectedLanguage) }}
                >
                  {(Object.keys(labels) as PdfitLanguage[]).map((option) => (
                    <MenuItem
                      key={option}
                      selected={option === selectedLanguage}
                      onClick={() => { languagePreference.model.setLanguage(option); setLanguageAnchor(null); }}
                    >
                      {labels[option]}
                    </MenuItem>
                  ))}
                </Menu>
              </>
              );
            })()}
          </Box>
        </Box>

        <Divider />

        <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {extraSidebarItems.some((item) => item.placement === 'primary') && (
            <List dense disablePadding sx={{ pt: 0.75, pb: 0.25 }}>
              {extraSidebarItems.filter((item) => item.placement === 'primary').map((item) => (
                <ListItemButton
                  key={item.path}
                  data-testid={`lnb-primary-${item.label.toLowerCase()}`}
                  selected={isActive(item.path)}
                  onClick={() => { go(item.path); onMobileClose(); }}
                  sx={{ borderRadius: 1, mx: 1, py: 0.75, '&.Mui-selected': { backgroundColor: '#2a2f36', boxShadow: 'inset 3px 0 0 #3b82f6', '&:hover': { backgroundColor: '#2a2f36' } } }}
                >
                  <ListItemIcon sx={{ minWidth: 28, color: isActive(item.path) ? '#60a5fa' : '#9a9aa0' }}>{item.icon}</ListItemIcon>
                  <ListItemText primary={<Typography variant="caption" fontWeight={700} letterSpacing={0.7}>{item.label}</Typography>} />
                </ListItemButton>
              ))}
            </List>
          )}
          <List dense disablePadding sx={{ py: 0.5 }}>
            <ListItemButton
              data-testid="lnb-bookmarks"
              selected={isActive('/bookmarks')}
              onClick={() => { go('/bookmarks'); onMobileClose(); }}
              sx={{ borderRadius: 1, mx: 1, py: 0.6, '&.Mui-selected': { backgroundColor: '#2a2f36', boxShadow: 'inset 3px 0 0 #3b82f6', '&:hover': { backgroundColor: '#2a2f36' } } }}
            >
              <ListItemIcon sx={{ minWidth: 28 }}><BookmarkIcon sx={{ fontSize: 17, color: '#3b82f6' }} /></ListItemIcon>
              <ListItemText primary={<Typography variant="caption" fontWeight={600} letterSpacing={0.5}>BOOKMARKS</Typography>} />
              <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.68rem' }}>{bookmarkCount}</Typography>
            </ListItemButton>
          </List>

          <Box>
            <Box
              sx={{
                px: 1.5,
                py: 0.75,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                color: '#9a9aa0',
                '&:hover': { backgroundColor: 'action.hover' },
              }}
              onClick={() => setFoldersOpen((value) => !value)}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {foldersOpen ? (
                  <ExpandMoreIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                ) : (
                  <ChevronRightIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                )}
                <Typography
                  variant="caption"
                  color="text.secondary"
                  fontWeight={600}
                  letterSpacing={0.5}
                  sx={{ textTransform: 'uppercase', userSelect: 'none' }}
                >
                  Folders
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                <Tooltip title="폴더 새로고침" placement="right" arrow>
                  <span>
                    <IconButton
                      size="small"
                      aria-label="폴더 새로고침"
                      onClick={(event) => { event.stopPropagation(); void handleRefresh(); }}
                      disabled={refreshing}
                      sx={{ p: 0.25 }}
                    >
                      {refreshing ? <CircularProgress size={14} /> : <RefreshIcon sx={{ fontSize: 16 }} />}
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Create folder" placement="right" arrow>
                  <IconButton
                    size="small"
                    data-testid="create-folder-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setDialogOpen(true);
                    }}
                    sx={{ p: 0.25 }}
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
                <Typography variant="caption" color="text.disabled" sx={{ px: 2, display: 'block', pb: 1 }}>
                  Create a folder to start adding PDFs.
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
                        disablePadding
                        secondaryAction={
                          <Tooltip title="Delete folder" placement="right" arrow>
                            <span>
                              <IconButton
                                size="small"
                                disabled={folder.isRoot}
                                onClick={(event) => void handleDeleteFolder(folder.name, event)}
                                sx={{ p: 0.25, opacity: folder.isRoot ? 0.15 : 0.4, '&:hover': { opacity: 1, color: 'error.main' } }}
                              >
                                <DeleteIcon sx={{ fontSize: 14 }} />
                              </IconButton>
                            </span>
                          </Tooltip>
                        }
                        sx={{ pr: 4 }}
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
                            outlineColor: 'primary.main',
                            backgroundColor: dragOver ? '#2a2f36' : undefined,
                            '&.Mui-selected': {
                              backgroundColor: '#2a2f36',
                              boxShadow: `inset 3px 0 0 ${folder.color}`,
                              '&:hover': { backgroundColor: '#2a2f36' },
                            },
                          }}
                        >
                          <ListItemIcon sx={{ minWidth: 28 }}>
                            <TagColorPicker color={folder.color} label="폴더 색상 변경" icon={<FolderIcon sx={{ fontSize: 17, color: folder.color }} />} onChange={(color) => void foldersApi.updateColor(folder.name, color).then(() => { setFolders((current) => current.map((item) => item.name === folder.name ? { ...item, color } : item)); window.dispatchEvent(new Event('folders-changed')); })} />
                          </ListItemIcon>
                          <ListItemText
                            primary={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Typography noWrap variant="body2" sx={{ fontSize: '0.8rem', flex: 1 }}>
                                  {folder.name}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  color={selected ? 'inherit' : 'text.disabled'}
                                  sx={{ fontSize: '0.68rem', flexShrink: 0 }}
                                >
                                  {folder.pdfCount}
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
              sx={{
                px: 1.5,
                py: 0.75,
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer',
                '&:hover': { backgroundColor: 'action.hover' },
              }}
              onClick={() => setTagsOpen((value) => !value)}
            >
              {tagsOpen ? (
                <ExpandMoreIcon sx={{ fontSize: 16, color: 'text.secondary', mr: 0.5 }} />
              ) : (
                <ChevronRightIcon sx={{ fontSize: 16, color: 'text.secondary', mr: 0.5 }} />
              )}
              <Typography
                variant="caption"
                color="text.secondary"
                fontWeight={600}
                letterSpacing={0.5}
                sx={{ textTransform: 'uppercase', userSelect: 'none' }}
              >
                Tags
              </Typography>
            </Box>

            <Collapse in={tagsOpen} timeout="auto" unmountOnExit>
              {tags.length === 0 ? (
                <Typography variant="caption" color="text.disabled" sx={{ px: 2, display: 'block', pb: 1 }}>
                  Add tags to a PDF to see them here.
                </Typography>
              ) : (
                <List dense disablePadding>
                  {tags.map((tag) => {
                    const tagPath = `/tag/${encodeURIComponent(tag.name)}`;
                    const dragOver = dragOverTag === tag.name;
                    return (
                      <ListItem
                        key={tag.name}
                        secondaryAction={
                          <Tooltip title="Delete tag" placement="right" arrow>
                            <IconButton
                              size="small"
                              aria-label="Delete tag"
                              onClick={(event) => void handleDeleteTag(tag, event)}
                              sx={{ p: 0.25, opacity: 0.4, '&:hover': { opacity: 1, color: 'error.main' } }}
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
                            py: 0.4,
                            outline: dragOver ? '2px solid' : 'none',
                            outlineColor: 'secondary.main',
                            backgroundColor: dragOver ? 'rgba(34, 197, 94, 0.16)' : undefined,
                            '&.Mui-selected': {
                              backgroundColor: `${tag.color}29`,
                              boxShadow: `inset 3px 0 0 ${tag.color}`,
                              '&:hover': { backgroundColor: 'rgba(34, 197, 94, 0.16)' },
                            },
                          }}
                        >
                          <ListItemIcon sx={{ minWidth: 28 }} onClick={(event) => event.stopPropagation()}>
                            <TagColorPicker color={tag.color} onChange={(color) => void tagsApi.updateColor(tag.name, color).then(() => { setTags((current) => current.map((item) => item.name === tag.name ? { ...item, color } : item)); window.dispatchEvent(new Event('tags-changed')); })} />
                          </ListItemIcon>
                          <ListItemText
                            primary={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Typography noWrap variant="body2" sx={{ fontSize: '0.8rem', flex: 1 }}>
                                  {tag.name}
                                </Typography>
                                <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.68rem', flexShrink: 0 }}>
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
        </Box>
        {extraSidebarFooter && (
          <Box sx={{ flexShrink: 0, borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
            {extraSidebarFooter}
          </Box>
        )}
      </Drawer>

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
        <DialogTitle>Create folder</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Folder name"
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
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void handleCreate()} disabled={!newFolderName.trim() || creating}>
            {creating ? 'Creating...' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>삭제 확인</DialogTitle>
        <DialogContent>
          <Typography>{confirmDelete?.kind === 'folder' ? `Delete folder "${confirmDelete.name}" and all PDFs inside it?` : `Delete tag "${confirmDelete?.name}" from all ${confirmDelete?.count ?? 0} books?`}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void confirmDeleteItem()}>Delete</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

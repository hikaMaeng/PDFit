import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, List,
  CircularProgress, Alert, Chip, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  MenuItem, Select, FormControl, InputLabel, TextField, Autocomplete,
} from '@mui/material';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import DeleteIcon from '@mui/icons-material/Delete';
import { tagsApi, BookRef } from '../api/tags';
import { foldersApi, FolderInfo } from '../api/folders';
import PdfListItem from '../components/PdfListItem';
import TagColorPicker from '../components/TagColorPicker';
import { folderLibraryModel } from '../model/folderLibraryModel';

interface TagDialogState {
  folder: string;
  file: string;
  currentTags: string[];
}

export default function TagPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const tagName = decodeURIComponent(name ?? '');

  const [books, setBooks] = useState<BookRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tagColor, setTagColor] = useState('#22c55e');

  /** `${folder}/${filename}` → 태그 목록 */
  const [bookTags, setBookTags] = useState<Record<string, string[]>>({});

  // ─── 이동 다이얼로그 ──────────────────────────────────────
  const [moveDialog, setMoveDialog] = useState<{ folder: string; file: string } | null>(null);
  const [allFolders, setAllFolders] = useState<FolderInfo[]>([]);
  const [moveTarget, setMoveTarget] = useState('');
  const [moving, setMoving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ folder: string; filename: string } | null>(null);

  // ─── 태그 다이얼로그 ──────────────────────────────────────
  const [tagDialog, setTagDialog] = useState<TagDialogState | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [tagLoading, setTagLoading] = useState(false);

  // ─── 초기 로드 ────────────────────────────────────────────
  const loadBooks = useCallback(async () => {
    if (!tagName) return;
    setLoading(true);
    setError(null);
    try {
      const [data, summaries] = await Promise.all([tagsApi.listBooks(tagName), tagsApi.listSummary()]);
      setTagColor(summaries.find((item) => item.name === tagName)?.color ?? '#22c55e');
      setBooks(data);
      setBookTags(Object.fromEntries(data.map((book) => [
        `${book.folder}/${book.filename}`, book.tags,
      ])));
    } catch (e) {
      setError(e instanceof Error ? e.message : '로드 실패');
    } finally {
      setLoading(false);
    }
  }, [tagName]);

  useEffect(() => { loadBooks(); }, [loadBooks]);

  useEffect(() => {
    const refreshColor = () => void tagsApi.listSummary().then((items) => {
      const color = items.find((item) => item.name === tagName)?.color;
      if (color) setTagColor(color);
    });
    window.addEventListener('tags-changed', refreshColor);
    return () => window.removeEventListener('tags-changed', refreshColor);
  }, [tagName]);

  // ─── 삭제 ─────────────────────────────────────────────────
  const handleDelete = useCallback((folder: string, filename: string) => {
    setConfirmDelete({ folder, filename });
  }, []);

  const confirmDeleteBook = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await foldersApi.deleteFile(target.folder, target.filename);
      setBooks((prev) => prev.filter((b) => !(b.folder === target.folder && b.filename === target.filename)));
      folderLibraryModel.get(target.folder).removeFile(target.filename);
      window.dispatchEvent(new Event('folders-changed'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '삭제 실패');
    }
  };

  // ─── 이동 ─────────────────────────────────────────────────
  const openMoveDialog = useCallback(async (folder: string, filename: string) => {
    const folders = await foldersApi.list();
    setAllFolders(folders.filter((f) => f.name !== folder));
    setMoveTarget('');
    setMoveDialog({ folder, file: filename });
  }, []);

  const handleMove = async () => {
    if (!moveDialog || !moveTarget) return;
    setMoving(true);
    try {
      await foldersApi.moveFile(moveDialog.folder, moveTarget, moveDialog.file);
      // 폴더가 바뀌어도 태그가 유지되므로 목록에서 폴더명만 갱신
      setBooks((prev) => prev.map((b) =>
        b.folder === moveDialog.folder && b.filename === moveDialog.file
          ? { ...b, folder: moveTarget }
          : b,
      ));
      const oldKey = `${moveDialog.folder}/${moveDialog.file}`;
      const newKey = `${moveTarget}/${moveDialog.file}`;
      setBookTags((prev) => {
        const { [oldKey]: tags, ...rest } = prev;
        return { ...rest, [newKey]: tags ?? [] };
      });
      folderLibraryModel.get(moveDialog.folder).removeFile(moveDialog.file);
      folderLibraryModel.invalidateFiles([moveTarget]);
      window.dispatchEvent(new Event('folders-changed'));
      setMoveDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '이동 실패');
    } finally {
      setMoving(false);
    }
  };

  // ─── 태그 다이얼로그 ──────────────────────────────────────
  const openTagDialog = useCallback(async (folder: string, filename: string) => {
    const key = `${folder}/${filename}`;
    setTagLoading(true);
    setTagInput('');
    try {
      const [currentTags, globalTags] = await Promise.all([
        tagsApi.listForBook(folder, filename),
        tagsApi.list(),
      ]);
      setTagDialog({ folder, file: filename, currentTags });
      setAllTags(globalTags);
      setBookTags((prev) => ({ ...prev, [key]: currentTags }));
    } catch {
      setError('태그 로드 실패');
    } finally {
      setTagLoading(false);
    }
  }, []);

  const handleAddTag = async (tag: string) => {
    if (!tagDialog || !tag.trim()) return;
    const trimmed = tag.trim();
    if (tagDialog.currentTags.includes(trimmed)) return;
    try {
      await tagsApi.addTag(tagDialog.folder, tagDialog.file, trimmed);
      const key = `${tagDialog.folder}/${tagDialog.file}`;
      setTagDialog((prev) => prev ? { ...prev, currentTags: [...prev.currentTags, trimmed] } : prev);
      setBookTags((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), trimmed] }));
      setAllTags((prev) => prev.includes(trimmed) ? prev : [...prev, trimmed].sort());
      setTagInput('');
      folderLibraryModel.get(tagDialog.folder).addTag(tagDialog.file, trimmed);
      window.dispatchEvent(new Event('tags-changed'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '태그 추가 실패');
    }
  };

  const handleRemoveTag = async (tag: string) => {
    if (!tagDialog) return;
    const key = `${tagDialog.folder}/${tagDialog.file}`;
    try {
      await tagsApi.removeTag(tagDialog.folder, tagDialog.file, tag);
      setTagDialog((prev) => prev ? { ...prev, currentTags: prev.currentTags.filter((t) => t !== tag) } : prev);
      setBookTags((prev) => ({ ...prev, [key]: (prev[key] ?? []).filter((t) => t !== tag) }));
      if (tag === tagName) {
        setBooks((prev) => prev.filter((b) => !(b.folder === tagDialog.folder && b.filename === tagDialog.file)));
      }
      folderLibraryModel.get(tagDialog.folder).removeTag(tagDialog.file, tag);
      window.dispatchEvent(new Event('tags-changed'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '태그 삭제 실패');
    }
  };

  const handleInlineRemoveTag = useCallback(async (folder: string, filename: string, tag: string) => {
    const key = `${folder}/${filename}`;
    try {
      await tagsApi.removeTag(folder, filename, tag);
      setBookTags((prev) => ({ ...prev, [key]: (prev[key] ?? []).filter((t) => t !== tag) }));
      if (tag === tagName) {
        setBooks((prev) => prev.filter((b) => !(b.folder === folder && b.filename === filename)));
      }
      folderLibraryModel.get(folder).removeTag(filename, tag);
      window.dispatchEvent(new Event('tags-changed'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '태그 삭제 실패');
    }
  }, [tagName]);

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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <TagColorPicker color={tagColor} size="medium" onChange={(color) => void tagsApi.updateColor(tagName, color).then(() => { setTagColor(color); window.dispatchEvent(new Event('tags-changed')); })} />
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="h5" fontWeight={700}>{tagName}</Typography>
            <Chip label={`PDF ${books.length}개`} size="small" color="secondary" variant="outlined" />
          </Box>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {/* PDF 목록 */}
      <Box>
        {books.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <PictureAsPdfIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
            <Typography color="text.secondary">이 태그가 붙은 PDF가 없습니다.</Typography>
          </Box>
        ) : (
          <List disablePadding>
            {books.map((book) => {
              const key = `${book.folder}/${book.filename}`;
              return (
                <PdfListItem
                  key={key}
                  filename={book.filename}
                  href={`/viewer/${encodeURIComponent(book.folder)}/${encodeURIComponent(book.filename)}`}
                  folder={book.folder}
                  secondaryLinkLabel={book.folder}
                  onSecondaryLink={openFolder}
                  tags={bookTags[key] ?? []}
                  tagColors={{ [tagName]: tagColor }}
                  onTagDelete={handleInlineRemoveTag}
                  onManageTags={openTagDialog}
                  onMove={openMoveDialog}
                  onDelete={handleDelete}
                  manageTagsLabel="태그 관리"
                  moveLabel="다른 폴더로 이동"
                  deleteLabel="삭제"
                />
              );
            })}
          </List>
        )}
      </Box>

      {/* 이동 다이얼로그 */}
      <Dialog open={!!moveDialog} onClose={() => setMoveDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>다른 폴더로 이동</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            "{moveDialog?.file}"을 이동할 폴더를 선택하세요.
          </Typography>
          <FormControl fullWidth>
            <InputLabel>대상 폴더</InputLabel>
            <Select value={moveTarget} label="대상 폴더" onChange={(e) => setMoveTarget(e.target.value)}>
              {allFolders.map((f) => (
                <MenuItem key={f.name} value={f.name}>{f.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoveDialog(null)} disabled={moving}>취소</Button>
          <Button variant="contained" onClick={handleMove} disabled={!moveTarget || moving}>
            {moving ? '이동 중...' : '이동'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>삭제 확인</DialogTitle>
        <DialogContent><Typography>"{confirmDelete?.filename}"을 삭제하시겠습니까?</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>취소</Button>
          <Button color="error" variant="contained" onClick={() => void confirmDeleteBook()}>삭제</Button>
        </DialogActions>
      </Dialog>

      {/* 태그 관리 다이얼로그 */}
      <Dialog
        open={!!tagDialog}
        onClose={() => { setTagDialog(null); setTagInput(''); }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LocalOfferIcon color="secondary" fontSize="small" />
            태그 관리
          </Box>
        </DialogTitle>
        <DialogContent>
          {tagLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                {tagDialog?.file}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2, minHeight: 32 }}>
                {tagDialog?.currentTags.length === 0 ? (
                  <Typography variant="caption" color="text.disabled">태그 없음</Typography>
                ) : (
                  tagDialog?.currentTags.map((tag) => (
                    <Chip
                      key={tag}
                      label={tag}
                      size="small"
                      variant="outlined"
                      sx={{ borderColor: tag === tagName ? tagColor : undefined, color: tag === tagName ? tagColor : undefined }}
                      onDelete={() => handleRemoveTag(tag)}
                    />
                  ))
                )}
              </Box>
              <Autocomplete
                freeSolo
                options={allTags.filter((t) => !tagDialog?.currentTags.includes(t))}
                inputValue={tagInput}
                onInputChange={(_e, val) => setTagInput(val)}
                onChange={(_e, val) => { if (val) handleAddTag(val); }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    autoFocus
                    label="태그 추가"
                    size="small"
                    placeholder="입력 후 Enter 또는 선택"
                  />
                )}
              />
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setTagDialog(null); setTagInput(''); }}>닫기</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

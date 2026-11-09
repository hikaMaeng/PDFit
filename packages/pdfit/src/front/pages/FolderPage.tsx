import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, List,
  IconButton, Tooltip, Button, CircularProgress, Alert, LinearProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, MenuItem, Select,
  FormControl, InputLabel, Chip, Checkbox,
  Autocomplete, TextField, Snackbar,
} from '@mui/material';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DeleteIcon from '@mui/icons-material/Delete';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import RefreshIcon from '@mui/icons-material/Refresh';
import { foldersApi, FolderInfo } from '../api/folders';
import { tagsApi } from '../api/tags';
import TagColorPicker from '../components/TagColorPicker';
import PdfListItem from '../components/PdfListItem';
import { folderLibraryModel } from '../model/folderLibraryModel';
import { useFolderLibrary } from '../hooks/useFolderLibrary';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}


interface TagDialogState {
  file: string;
  driveFileId?: string;
  currentTags: string[];
}

interface TagNotice {
  message: string;
  severity: 'info' | 'success' | 'error';
}

function FolderPage({ folderName: requestedFolderName }: { folderName?: string }) {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const folderName = requestedFolderName ?? decodeURIComponent(name ?? '');

  const [error, setError] = useState<string | null>(null);
  const folderModel = folderLibraryModel.get(folderName);
  const { files, fileTags, isRootFolder, loading, error: loadError } = useFolderLibrary(folderName);

  // 업로드
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState<'uploading' | 'indexing' | 'refreshing'>('uploading');
  const [dragActive, setDragActive] = useState(false);

  // 이동 다이얼로그
  const [moveDialog, setMoveDialog] = useState<{ file: string } | null>(null);
  const [allFolders, setAllFolders] = useState<FolderInfo[]>([]);
  const [moveTarget, setMoveTarget] = useState('');
  const [moving, setMoving] = useState(false);

  // 태그 다이얼로그
  const [tagDialog, setTagDialog] = useState<TagDialogState | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [tagLoading, setTagLoading] = useState(false);
  const [tagMutation, setTagMutation] = useState<string | null>(null);
  const [tagNotice, setTagNotice] = useState<TagNotice | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tagColors, setTagColors] = useState<Record<string, string>>({});
  const [folderColor, setFolderColor] = useState('#3b82f6');
  const [confirmDelete, setConfirmDelete] = useState<
    | { kind: 'file' | 'folder'; name: string }
    | { kind: 'selection'; names: string[] }
    | null
  >(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(() => new Set());
  const [deletingSelection, setDeletingSelection] = useState(false);

  useEffect(() => {
    setSelectedFiles(new Set());
  }, [folderName]);

  useEffect(() => {
    const available = new Set(files.map((file) => file.name));
    setSelectedFiles((current) => {
      const next = new Set([...current].filter((filename) => available.has(filename)));
      return next.size === current.size ? current : next;
    });
  }, [files]);

  useEffect(() => {
    void foldersApi.list().then((items) => setFolderColor(items.find((item) => item.name === folderName)?.color ?? '#3b82f6'));
    const onFolderChange = () => void foldersApi.list().then((items) => setFolderColor(items.find((item) => item.name === folderName)?.color ?? '#3b82f6'));
    window.addEventListener('folders-changed', onFolderChange);
    return () => window.removeEventListener('folders-changed', onFolderChange);
  }, [folderName]);

  useEffect(() => {
    const loadColors = () => void tagsApi.listSummary().then((items) => setTagColors(Object.fromEntries(items.map((item) => [item.name, item.color]))));
    loadColors();
    window.addEventListener('tags-changed', loadColors);
    return () => window.removeEventListener('tags-changed', loadColors);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await foldersApi.refresh();
      await folderModel.refresh();
      window.dispatchEvent(new Event('folders-changed'));
      window.dispatchEvent(new Event('tags-changed'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '새로고침에 실패했습니다.');
    } finally {
      setRefreshing(false);
    }
  };

  // LNB 드래그 드롭으로 태그가 추가됐을 때 즉시 반영
  useEffect(() => {
    const onTagAdded = (e: Event) => {
      const { folder, filename, tag } = (e as CustomEvent<{ folder: string; filename: string; tag: string }>).detail;
      if (folder !== folderName) return;
      folderModel.addTag(filename, tag);
    };
    window.addEventListener('tag-added', onTagAdded);
    return () => window.removeEventListener('tag-added', onTagAdded);
  }, [folderName, folderModel]);

  const uploadFiles = useCallback(async (selected: File[]) => {
    if (selected.length === 0 || uploading) return;
    setError(null);
    setUploading(true);
    setUploadProgress(0);
    setUploadPhase('uploading');
    try {
      await foldersApi.upload(folderName, selected, setUploadProgress, setUploadPhase);
      setUploadProgress(100);
    } catch (e) {
      setError(e instanceof Error ? e.message : '업로드 실패');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }, [folderModel, folderName, uploading]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = '';
    await uploadFiles(selected);
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files') || uploading) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files') || uploading) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    if (uploading) return;

    const dropped = Array.from(e.dataTransfer.files);
    const pdfFiles = dropped.filter(isPdfFile);
    if (pdfFiles.length === 0) {
      setError('PDF 파일만 업로드할 수 있습니다.');
      return;
    }

    await uploadFiles(pdfFiles);
    if (pdfFiles.length !== dropped.length) {
      setError(`PDF가 아닌 파일 ${dropped.length - pdfFiles.length}개를 제외했습니다.`);
    }
  };

  const handleDelete = useCallback((_rowFolder: string, filename: string) => {
    setConfirmDelete({ kind: 'file', name: filename });
  }, []);

  const confirmDeleteItem = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      if (target.kind === 'selection') {
        setDeletingSelection(true);
        const failed: string[] = [];
        for (const filename of target.names) {
          try {
            await foldersApi.deleteFile(folderName, filename);
            folderModel.removeFile(filename);
          } catch {
            failed.push(filename);
          }
        }
        setSelectedFiles(new Set(failed));
        if (failed.length > 0) {
          throw new Error(`${target.names.length - failed.length}개를 삭제했고, ${failed.length}개는 삭제하지 못했습니다.`);
        }
      } else if (target.kind === 'file') {
        await foldersApi.deleteFile(folderName, target.name);
        folderModel.removeFile(target.name);
        setSelectedFiles((current) => {
          const next = new Set(current);
          next.delete(target.name);
          return next;
        });
      } else {
        await foldersApi.delete(target.name);
        window.dispatchEvent(new Event('folders-changed'));
        navigate('/');
      }
      window.dispatchEvent(new Event('folders-changed'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '삭제 실패');
    } finally {
      setDeletingSelection(false);
    }
  };

  const handleSelectionChange = useCallback((_rowFolder: string, filename: string, selected: boolean) => {
    setSelectedFiles((current) => {
      const next = new Set(current);
      if (selected) next.add(filename);
      else next.delete(filename);
      return next;
    });
  }, []);

  const allFilesSelected = files.length > 0 && selectedFiles.size === files.length;

  const handleSelectAll = (_event: React.ChangeEvent<HTMLInputElement>, checked: boolean) => {
    setSelectedFiles(checked ? new Set(files.map((file) => file.name)) : new Set());
  };

  const handleDeleteSelection = () => {
    if (selectedFiles.size === 0) return;
    setConfirmDelete({ kind: 'selection', names: [...selectedFiles] });
  };

  const openMoveDialog = useCallback(async (_rowFolder: string, filename: string) => {
    const folders = await foldersApi.list();
    setAllFolders(folders.filter((f) => f.name !== folderName));
    setMoveTarget('');
    setMoveDialog({ file: filename });
  }, [folderName]);

  const handleMove = async () => {
    if (!moveDialog || !moveTarget) return;
    setMoving(true);
    try {
      await foldersApi.moveFile(folderName, moveTarget, moveDialog.file);
      folderModel.removeFile(moveDialog.file);
      window.dispatchEvent(new Event('folders-changed'));
      setMoveDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '이동 실패');
    } finally {
      setMoving(false);
    }
  };

  // ─── 태그 다이얼로그 ──────────────────────────────────────
  const openTagDialog = useCallback(async (_rowFolder: string, filename: string, driveFileId?: string) => {
    setTagDialog({ file: filename, driveFileId, currentTags: fileTags[filename] ?? [] });
    setTagLoading(true);
    setTagInput('');
    try {
      const [currentTags, globalTags] = await Promise.all([
        tagsApi.listForBook(folderName, filename, driveFileId),
        tagsApi.list(),
      ]);
      setTagDialog({ file: filename, driveFileId, currentTags });
      setAllTags(globalTags);
    } catch {
      setError('태그 로드 실패');
    } finally {
      setTagLoading(false);
    }
  }, [fileTags, folderName]);

  const handleAddTag = async (tag: string) => {
    if (!tagDialog || !tag.trim() || tagMutation) return;
    const trimmed = tag.trim();
    if (tagDialog.currentTags.includes(trimmed)) {
      setTagInput('');
      setTagNotice({ message: `"${trimmed}"은(는) 이미 추가된 태그입니다.`, severity: 'info' });
      return;
    }
    const filename = tagDialog.file;
    const driveFileId = tagDialog.driveFileId;
    setTagMutation(trimmed);
    setTagNotice({ message: `"${trimmed}" 태그를 추가하는 중입니다…`, severity: 'info' });
    setTagDialog((prev) => prev ? { ...prev, currentTags: [...prev.currentTags, trimmed] } : prev);
    folderModel.addTag(filename, trimmed);
    setAllTags((prev) => prev.includes(trimmed) ? prev : [...prev, trimmed].sort());
    setTagInput('');
    try {
      await tagsApi.addTag(folderName, filename, trimmed, driveFileId);
      window.dispatchEvent(new Event('tags-changed'));
      setTagNotice({ message: `"${trimmed}" 태그가 추가되었습니다.`, severity: 'success' });
    } catch (e) {
      await tagsApi.restoreCachedRelation(folderName, filename, trimmed, false, driveFileId);
      setAllTags(await tagsApi.list());
      setTagDialog((prev) => prev ? { ...prev, currentTags: prev.currentTags.filter((item) => item !== trimmed) } : prev);
      folderModel.removeTag(filename, trimmed);
      const message = e instanceof Error ? e.message : '태그 추가 실패';
      setError(message);
      setTagNotice({ message: `태그를 추가하지 못했습니다. ${message}`, severity: 'error' });
    } finally {
      setTagMutation(null);
    }
  };

  const handleRemoveTag = async (tag: string) => {
    if (!tagDialog || tagMutation) return;
    const filename = tagDialog.file;
    const driveFileId = tagDialog.driveFileId;
    setTagMutation(tag);
    setTagNotice({ message: `"${tag}" 태그를 삭제하는 중입니다…`, severity: 'info' });
    setTagDialog((prev) => prev ? { ...prev, currentTags: prev.currentTags.filter((item) => item !== tag) } : prev);
    folderModel.removeTag(filename, tag);
    try {
      await tagsApi.removeTag(folderName, filename, tag, driveFileId);
      window.dispatchEvent(new Event('tags-changed'));
      setTagNotice({ message: `"${tag}" 태그가 삭제되었습니다.`, severity: 'success' });
    } catch (e) {
      await tagsApi.restoreCachedRelation(folderName, filename, tag, true, driveFileId);
      setTagDialog((prev) => prev && !prev.currentTags.includes(tag) ? { ...prev, currentTags: [...prev.currentTags, tag] } : prev);
      folderModel.addTag(filename, tag);
      const message = e instanceof Error ? e.message : '태그 삭제 실패';
      setError(message);
      setTagNotice({ message: `태그를 삭제하지 못했습니다. ${message}`, severity: 'error' });
    } finally {
      setTagMutation(null);
    }
  };

  const handleInlineRemoveTag = useCallback(async (_rowFolder: string, filename: string, tag: string, driveFileId?: string) => {
    if (tagMutation) return;
    setTagMutation(tag);
    setTagNotice({ message: `"${tag}" 태그를 삭제하는 중입니다…`, severity: 'info' });
    folderModel.removeTag(filename, tag);
    try {
      await tagsApi.removeTag(folderName, filename, tag, driveFileId);
      window.dispatchEvent(new Event('tags-changed'));
      setTagNotice({ message: `"${tag}" 태그가 삭제되었습니다.`, severity: 'success' });
    } catch (e) {
      await tagsApi.restoreCachedRelation(folderName, filename, tag, true, driveFileId);
      folderModel.addTag(filename, tag);
      const message = e instanceof Error ? e.message : '태그 삭제 실패';
      setError(message);
      setTagNotice({ message: `태그를 삭제하지 못했습니다. ${message}`, severity: 'error' });
    } finally {
      setTagMutation(null);
    }
  }, [folderModel, folderName, tagMutation]);

  const handleDeleteFolder = async () => {
    if (isRootFolder) return;
    setConfirmDelete({ kind: 'folder', name: folderName });
  };

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;
  }

  return (
    <Box
      data-testid="folder-drop-zone"
      aria-label="PDF 드래그 앤 드롭 업로드 영역"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
      sx={{ position: 'relative', minHeight: 'calc(100vh - 96px)' }}
    >
      {dragActive && (
        <Box
          data-testid="pdf-drop-overlay"
          role="status"
          aria-live="polite"
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            border: '2px dashed',
            borderColor: 'primary.main',
            borderRadius: 2,
            bgcolor: 'rgba(18, 25, 38, 0.92)',
            backdropFilter: 'blur(2px)',
            pointerEvents: 'none',
          }}
        >
          <UploadFileIcon color="primary" sx={{ fontSize: 56 }} />
          <Typography variant="h6" fontWeight={700}>PDF 파일을 놓아 업로드</Typography>
          <Typography variant="body2" color="text.secondary">여러 PDF를 한 번에 업로드할 수 있습니다.</Typography>
        </Box>
      )}
      {/* 폴더 헤더 */}
      <Box sx={{ px: 1, py: 0, mb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <TagColorPicker color={folderColor} size="medium" label="폴더 색상 변경" icon={<FolderOpenIcon sx={{ fontSize: 32, color: folderColor }} />} onChange={(color) => void foldersApi.updateColor(folderName, color).then(() => { setFolderColor(color); window.dispatchEvent(new Event('folders-changed')); })} />
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="h5" fontWeight={700}>{folderName}</Typography>
              <Chip label={`PDF ${files.length}개`} size="small" color="primary" variant="outlined" />
              <Chip
                label={`${formatBytes(files.reduce((s, f) => s + f.size, 0))}`}
                size="small"
                variant="outlined"
              />
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {files.length > 0 && (
              <Tooltip title={allFilesSelected ? '전체 선택 해제' : '전체 선택'} arrow>
                <Checkbox
                  data-testid="pdf-select-all"
                  inputProps={{ 'aria-label': 'PDF 전체 선택' }}
                  checked={allFilesSelected}
                  indeterminate={selectedFiles.size > 0 && !allFilesSelected}
                  onChange={handleSelectAll}
                  disabled={deletingSelection}
                  size="small"
                />
              </Tooltip>
            )}
            <Button
              data-testid="delete-selected-pdfs"
              color="error"
              variant={selectedFiles.size > 0 ? 'contained' : 'outlined'}
              size="small"
              startIcon={<DeleteIcon />}
              disabled={selectedFiles.size === 0 || deletingSelection}
              onClick={handleDeleteSelection}
              sx={{ minWidth: 104 }}
            >
              {deletingSelection ? '삭제 중...' : `선택 삭제${selectedFiles.size > 0 ? ` (${selectedFiles.size})` : ''}`}
            </Button>
            <Tooltip title="폴더 새로고침" arrow>
              <span>
                <IconButton color="primary" onClick={() => void handleRefresh()} disabled={refreshing || loading}>
                  {refreshing ? <CircularProgress size={22} /> : <RefreshIcon />}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="PDF 업로드" arrow>
              <span>
                <IconButton color="primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                  <UploadFileIcon />
                </IconButton>
              </span>
            </Tooltip>
            {!isRootFolder && (
              <Tooltip title="폴더 삭제" arrow>
                <IconButton color="error" onClick={handleDeleteFolder}>
                  <DeleteIcon />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>

        {uploading && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress variant="determinate" value={uploadProgress} />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              {uploadPhase === 'uploading' ? '파일 전송 중...' : uploadPhase === 'indexing' ? 'Drive 메타데이터 반영 중...' : '목록 갱신 중...'} {uploadProgress}%
            </Typography>
          </Box>
        )}
      </Box>

      {(loadError ?? error) && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{loadError ?? error}</Alert>}

      {/* PDF 목록 */}
      <Box>
        {files.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <PictureAsPdfIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
            <Typography color="text.secondary">PDF 파일이 없습니다.</Typography>
            <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>
              PDF 파일을 여기로 드래그하거나 버튼을 눌러 업로드하세요.
            </Typography>
            <Button
              startIcon={<UploadFileIcon />}
              onClick={() => fileInputRef.current?.click()}
              sx={{ mt: 2 }}
            >
              PDF 업로드
            </Button>
          </Box>
        ) : (
          <List disablePadding>
            {files.map((file) => (
              <PdfListItem
                key={file.name}
                filename={file.name}
                href={`/viewer/${encodeURIComponent(folderName)}/${encodeURIComponent(file.name)}${file.driveFileId ? `?driveFileId=${encodeURIComponent(file.driveFileId)}` : ''}`}
                folder={folderName}
                driveFileId={file.driveFileId}
                size={file.size}
                modifiedAt={file.modifiedAt}
                tags={fileTags[file.name] ?? []}
                tagColors={tagColors}
                onTagDelete={(rowFolder, filename, tag) => handleInlineRemoveTag(rowFolder, filename, tag, file.driveFileId)}
                onManageTags={(rowFolder, filename) => openTagDialog(rowFolder, filename, file.driveFileId)}
                onMove={openMoveDialog}
                onDelete={handleDelete}
                manageTagsLabel="태그 관리"
                moveLabel="다른 폴더로 이동"
                deleteLabel="삭제"
                selected={selectedFiles.has(file.name)}
                onSelectionChange={handleSelectionChange}
              />
            ))}
          </List>
        )}
      </Box>

      {/* 숨겨진 파일 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        multiple
        hidden
        onChange={handleUpload}
      />

      {/* 파일 이동 다이얼로그 */}
      <Dialog open={!!moveDialog} onClose={() => setMoveDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>다른 폴더로 이동</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            "{moveDialog?.file}"을 이동할 폴더를 선택하세요.
          </Typography>
          <FormControl fullWidth>
            <InputLabel>대상 폴더</InputLabel>
            <Select
              value={moveTarget}
              label="대상 폴더"
              onChange={(e) => setMoveTarget(e.target.value)}
            >
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
        <DialogContent>
          <Typography>
            {confirmDelete?.kind === 'folder'
              ? `"${confirmDelete.name}" 폴더와 모든 PDF를 삭제하시겠습니까?`
              : confirmDelete?.kind === 'selection'
                ? `선택한 PDF ${confirmDelete.names.length}개를 삭제하시겠습니까?`
                : `"${confirmDelete?.name}"을 삭제하시겠습니까?`}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>취소</Button>
          <Button color="error" variant="contained" onClick={() => void confirmDeleteItem()}>삭제</Button>
        </DialogActions>
      </Dialog>

      {/* 태그 관리 다이얼로그 */}
      <Dialog
        open={!!tagDialog}
        onClose={() => { if (!tagMutation) { setTagDialog(null); setTagInput(''); } }}
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

              {/* 현재 태그 목록 */}
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
                      sx={{
                        borderColor: tagColors[tag] ?? '#22c55e',
                        color: tagColors[tag] ?? '#22c55e',
                        '& .MuiChip-deleteIcon': { color: tagColors[tag] ?? '#22c55e' },
                      }}
                      disabled={tagMutation !== null}
                      onDelete={() => void handleRemoveTag(tag)}
                    />
                  ))
                )}
              </Box>

              {/* 태그 추가 (자동완성 + 자유입력) */}
              <Autocomplete
                freeSolo
                disabled={tagMutation !== null}
                options={allTags.filter((t) => !tagDialog?.currentTags.includes(t))}
                inputValue={tagInput}
                onInputChange={(_e, val) => setTagInput(val)}
                onChange={(_e, val) => {
                  if (val) void handleAddTag(val);
                }}
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
          <Button disabled={tagMutation !== null} onClick={() => { setTagDialog(null); setTagInput(''); }}>닫기</Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={tagNotice !== null}
        autoHideDuration={tagNotice?.severity === 'info' ? null : 2600}
        onClose={(_event, reason) => { if (reason !== 'clickaway') setTagNotice(null); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={tagNotice?.severity ?? 'info'} variant="filled" onClose={() => setTagNotice(null)}>
          {tagNotice?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default React.memo(FolderPage);

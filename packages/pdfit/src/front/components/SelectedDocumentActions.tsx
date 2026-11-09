import React, { useState } from 'react';
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import FolderDestinationPicker from './FolderDestinationPicker.js';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import DeleteIcon from '@mui/icons-material/Delete';
import { foldersApi, type FolderInfo } from '../api/folders';
import { folderLibraryModel } from '../model/folderLibraryModel';
import { usePdfitI18n } from '../i18n/usePdfitI18n';

export interface SelectedDocument { folder: string; filename: string; driveFileId?: string; }

interface Props {
  documents: SelectedDocument[];
  disabled?: boolean;
  onDelete: () => void;
  onMoved: (documents: SelectedDocument[], target: string) => void;
  onError: (message: string) => void;
}

/** Selection actions and move confirmation; see docs/internals.md. */
export default function SelectedDocumentActions({ documents, disabled, onDelete, onMoved, onError }: Props) {
  const { t, ui } = usePdfitI18n();
  const [targets, setTargets] = useState<SelectedDocument[] | null>(null);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const openMove = async () => {
    const snapshot = [...documents];
    if (!snapshot.length || busy || disabled) return;
    setBusy(true);
    try {
      setFolders((await foldersApi.list()).filter((folder) => !snapshot.every((document) => document.folder === folder.name)));
      setDestination('');
      setTargets(snapshot);
    } catch (error) { onError(error instanceof Error ? error.message : t('moveToFolder')); }
    finally { setBusy(false); }
  };
  const move = async () => {
    if (!targets || !destination || busy) return;
    setBusy(true);
    const moved: SelectedDocument[] = [];
    const failed: SelectedDocument[] = [];
    for (const document of targets) {
      try {
        if (document.folder !== destination) {
          await foldersApi.moveFile(document.folder, destination, document.filename, document.driveFileId);
          folderLibraryModel.get(document.folder).removeFile(document.filename, document.driveFileId);
        }
        moved.push(document);
      } catch { failed.push(document); }
    }
    if (moved.length) {
      folderLibraryModel.invalidateFiles([destination]);
      onMoved(moved, destination);
      window.dispatchEvent(new Event('folders-changed'));
    }
    setBusy(false);
    setTargets(null);
    if (failed.length) onError(t('moveSelectedPartial', { completed: moved.length, failed: failed.length }));
  };
  return <>
    {documents.length > 0 && <Box data-testid="selected-document-actions" sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: .5 }}>
      <Button data-testid="move-selected-pdfs" aria-label={t('moveToFolder')} size="small" color="primary" disabled={disabled || busy} onClick={() => void openMove()} startIcon={busy ? <CircularProgress size={16} /> : <DriveFileMoveIcon fontSize="small" />} sx={{ whiteSpace: 'nowrap' }}>{t('moveFolder')}</Button>
      <Button data-testid="delete-selected-pdfs" aria-label={t('deleteSelected')} size="small" color="error" disabled={disabled || busy} onClick={onDelete} startIcon={<DeleteIcon fontSize="small" />} sx={{ whiteSpace: 'nowrap' }}>{t('delete')}</Button>
    </Box>}
    <Dialog open={targets !== null} onClose={() => { if (!busy) setTargets(null); }} maxWidth="xs" fullWidth>
      <DialogTitle>{t('moveToFolder')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('chooseMoveFolder')}
          <Box component="span" sx={{ display: 'block', mt: .75, overflowWrap: 'anywhere' }}>
            {targets?.length === 1 ? <>{ui('파일명')} : <Box component="span" translate="no">{targets[0].filename}</Box></> : t('selectedCount', { count: targets?.length ?? 0 })}
          </Box>
        </Typography>
        {targets && <FolderDestinationPicker folders={folders} value={destination} onChange={setDestination} disabled={busy} />}

      </DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setTargets(null)}>{t('cancel')}</Button><Button variant="contained" disabled={!destination || busy} onClick={() => void move()}>{busy ? t('moving') : t('move')}</Button></DialogActions>
    </Dialog>
  </>;
}

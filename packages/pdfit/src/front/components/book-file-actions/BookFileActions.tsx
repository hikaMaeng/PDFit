import { useId, useState, type FormEvent } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, TextField, Tooltip } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { isValidPdfFilename } from '../../../common/protocol/file-rename/index.js';
import { FileRenameError, foldersApi } from '../../api/folders.js';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import { FILE_ACTION } from './resource.js';

type Book = { folder: string; filename: string; driveFileId?: string };

function RenameDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  const { t } = usePdfitI18n();
  const titleId = useId();
  const formId = useId();
  const [name, setName] = useState(book.filename);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'conflict' | 'failed' | null>(null);
  const trimmedName = name.trim();
  const newName = /\.pdf$/i.test(trimmedName) ? trimmedName : trimmedName + book.filename.slice(-4);
  const valid = isValidPdfFilename(newName);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !valid || newName === book.filename) return;
    setSaving(true);
    setError(null);
    try {
      await foldersApi.renameFile({ ...book, newName });
      onClose();
    } catch (cause) {
      setError(cause instanceof FileRenameError && cause.status === 409 ? 'conflict' : 'failed');
    } finally {
      setSaving(false);
    }
  };

  return <Dialog open fullWidth maxWidth="xs" aria-labelledby={titleId} onClose={saving ? undefined : onClose}>
    <DialogTitle id={titleId}>{t(FILE_ACTION.RENAME)}</DialogTitle>
    <DialogContent>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{t(error === 'conflict' ? FILE_ACTION.CONFLICT : FILE_ACTION.ERROR)}</Alert>}
      <form id={formId} onSubmit={(event) => void submit(event)}>
        <TextField autoFocus fullWidth value={name} label={t(FILE_ACTION.NAME)} margin="dense" disabled={saving}
          error={Boolean(trimmedName) && !valid} helperText={trimmedName && !valid ? t(FILE_ACTION.INVALID) : undefined}
          onFocus={(event) => event.target.setSelectionRange(0, Math.max(0, event.target.value.length - 4))}
          onChange={(event) => { setName(event.target.value); setError(null); }} />
      </form>
    </DialogContent>
    <DialogActions>
      <Button disabled={saving} onClick={onClose}>{t('cancel')}</Button>
      <Button type="submit" form={formId} variant="contained" disabled={saving || !valid || newName === book.filename}>{t('save')}</Button>
    </DialogActions>
  </Dialog>;
}

export default function BookFileActions({ book, disabled, onMove, onDelete }: {
  book: Book;
  disabled: boolean;
  onMove?: (folder: string, filename: string) => void;
  onDelete?: (folder: string, filename: string) => void;
}) {
  const { t } = usePdfitI18n();
  const menuId = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState(false);

  return <>
    <Tooltip title={t(FILE_ACTION.MENU)}>
      <span><IconButton aria-label={t(FILE_ACTION.MENU)} aria-haspopup="menu" aria-controls={anchor ? menuId : undefined}
        aria-expanded={Boolean(anchor)} disabled={disabled} onClick={(event) => setAnchor(event.currentTarget)}>
        <MoreVertIcon fontSize="small" />
      </IconButton></span>
    </Tooltip>
    <Menu MenuListProps={{ id: menuId }} anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
      <MenuItem onClick={() => { setAnchor(null); setRenaming(true); }}>
        <ListItemIcon><DriveFileRenameOutlineIcon fontSize="small" /></ListItemIcon>
        <ListItemText>{t(FILE_ACTION.RENAME)}</ListItemText>
      </MenuItem>
      {onMove && <MenuItem onClick={() => { setAnchor(null); onMove(book.folder, book.filename); }}>
        <ListItemIcon><DriveFileMoveIcon fontSize="small" /></ListItemIcon>
        <ListItemText>{t('moveToFolder')}</ListItemText>
      </MenuItem>}
      {onDelete && <MenuItem sx={{ color: 'error.main' }} onClick={() => { setAnchor(null); onDelete(book.folder, book.filename); }}>
        <ListItemIcon sx={{ color: 'inherit' }}><DeleteOutlineIcon fontSize="small" /></ListItemIcon>
        <ListItemText>{t('delete')}</ListItemText>
      </MenuItem>}
    </Menu>
    {renaming && <RenameDialog book={book} onClose={() => setRenaming(false)} />}
  </>;
}

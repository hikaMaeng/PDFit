import { useState, useSyncExternalStore } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import ImageSearchIcon from '@mui/icons-material/ImageSearch';
import { coversAvailable, subscribeCovers } from '../api/covers.js';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';
import RealCoverDialog from './RealCoverDialog.js';

export default function BookCoverReplaceButton({ folder, filename }: { folder: string; filename: string }) {
  const { t } = usePdfitI18n();
  const available = useSyncExternalStore(subscribeCovers, coversAvailable, () => false);
  const [open, setOpen] = useState(false);
  if (!available) return null;
  const label = t('realCover');
  return <>
    <Tooltip title={label}><span>
      <IconButton aria-label={label} aria-haspopup="dialog" data-testid="pdf-cover-real-cover" size="small"
        onClick={() => setOpen(true)} sx={{ color: 'primary.main' }}>
        <ImageSearchIcon fontSize="small" />
      </IconButton>
    </span></Tooltip>
    <RealCoverDialog open={open} folder={folder} filename={filename} onClose={() => setOpen(false)} />
  </>;
}

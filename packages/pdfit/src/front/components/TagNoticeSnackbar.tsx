import { Alert, Snackbar } from '@mui/material';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';

export interface TagNotice {
  message: string;
  severity: 'info' | 'success' | 'error';
}

interface TagNoticeSnackbarProps {
  notice: TagNotice | null;
  onClose: () => void;
}

export default function TagNoticeSnackbar({ notice, onClose }: TagNoticeSnackbarProps) {
  const { ui } = usePdfitI18n();
  const severity = notice?.severity ?? 'info';
  return (
    <Snackbar
      open={notice !== null}
      autoHideDuration={severity === 'info' ? null : 2600}
      onClose={(_event, reason) => { if (reason !== 'clickaway') onClose(); }}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      sx={{
        top: { xs: 12, sm: 20 },
        zIndex: (theme) => theme.zIndex.snackbar,
      }}
    >
      <Alert
        severity={severity}
        variant="outlined"
        onClose={onClose}
        sx={{
          minWidth: { xs: 'min(320px, calc(100vw - 24px))', sm: 320 },
          color: 'text.primary',
          backgroundColor: 'background.paper',
          borderColor: 'divider',
          boxShadow: '0 10px 28px rgba(0, 0, 0, 0.38)',
          '& .MuiAlert-icon': { color: severity === 'info' ? 'primary.main' : `${severity}.main`, opacity: 1 },
          '& .MuiAlert-action': { color: 'text.secondary' },
        }}
      >
        {notice ? ui(notice.message) : null}
      </Alert>
    </Snackbar>
  );
}

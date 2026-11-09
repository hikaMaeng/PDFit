import { useState, useSyncExternalStore } from 'react';
import { Box, Button, CircularProgress, Paper, Typography } from '@mui/material';
import { backgroundSyncModel } from '../model/backgroundSyncModel.js';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';

export default function BackgroundSyncIndicator() {
  const { t } = usePdfitI18n();
  useSyncExternalStore(backgroundSyncModel.subscribe, backgroundSyncModel.getSnapshot, backgroundSyncModel.getSnapshot);
  const entries = backgroundSyncModel.getEntries();
  const active = entries.filter((entry) => entry.status === 'pending' || entry.status === 'syncing');
  const failed = entries.filter((entry) => entry.status === 'failed');
  const [expanded, setExpanded] = useState(false);
  if (entries.length === 0) return null;

  return (
    <Box data-testid="background-sync-indicator" sx={{ position: 'fixed', zIndex: 1500, top: 10, right: 12, display: 'grid', justifyItems: 'end', gap: 0.75, pointerEvents: 'none' }}>
      {failed.length > 0 ? (
        <Button data-testid="background-sync-failed" color="error" variant="contained" size="small" onClick={() => setExpanded((value) => !value)} sx={{ pointerEvents: 'auto', textTransform: 'none' }}>
          {t('backgroundFailed', { count: failed.length })}
        </Button>
      ) : (
        <Paper elevation={4} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.75 }}>
          <CircularProgress size={15} />
          <Typography variant="caption">{t('backgroundSaving', { count: active.length })}</Typography>
        </Paper>
      )}
      {expanded && failed.length > 0 && (
        <Paper data-testid="background-sync-failure-list" elevation={6} sx={{ width: 280, p: 1, pointerEvents: 'auto' }}>
          {failed.map((entry) => (
            <Box key={entry.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="caption" display="block" noWrap>{entry.label}</Typography>
                <Typography variant="caption" color="error" display="block" noWrap>{entry.error}</Typography>
              </Box>
              {entry.retry && <Button size="small" onClick={() => backgroundSyncModel.retry(entry.id)}>{t('retry')}</Button>}
            </Box>
          ))}
        </Paper>
      )}
    </Box>
  );
}

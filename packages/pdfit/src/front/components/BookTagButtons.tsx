import { CircularProgress, IconButton, Tooltip, useTheme } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';
import type { AiModelProgress } from '../../common/protocol/ai-model/index.js';
import HashTagIcon from './HashTagIcon.js';

export function BookAutoTagButton({ onClick, disabled, running, modelPhase }: { onClick: () => void; disabled: boolean; running?: boolean; modelPhase?: AiModelProgress }) {
  const { t } = usePdfitI18n();
  const theme = useTheme();
  const color = theme.palette.mode === 'light' ? '#b7791f' : '#f59e0b';
  const label = t('aiAutoTag');
  const statusLabels = { queued: 'aiModelQueued', running: 'aiModelRunning' } as const;
  const status = modelPhase && t(statusLabels[modelPhase]);
  return <Tooltip title={status ?? label}><span>
    <IconButton data-testid="pdf-ai-auto-tag" aria-label={label} size="small" disabled={disabled || running}
      onClick={onClick} sx={{ color, p: .25, '&:hover': { bgcolor: `${color}1f` } }}>
      {running ? <CircularProgress size={16} color="inherit" aria-label={status ?? label} /> : <AutoAwesomeIcon sx={{ fontSize: 16 }} />}
    </IconButton>
  </span></Tooltip>;
}

export function BookManageTagsButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  const { t } = usePdfitI18n();
  const label = t('manageTags');
  return <Tooltip title={label}><span>
    <IconButton aria-label={label} aria-haspopup="dialog" size="small" disabled={disabled} onClick={onClick} sx={{ color: 'primary.main' }}>
      <HashTagIcon fontSize="small" />
    </IconButton>
  </span></Tooltip>;
}

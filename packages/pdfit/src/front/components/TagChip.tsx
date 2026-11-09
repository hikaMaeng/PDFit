import React from 'react';
import { Chip, useTheme, type ChipProps } from '@mui/material';
import { alpha } from '@mui/material/styles';
import TagIcon from './HashTagIcon.js';
import { tagColorForMode } from '../../shared/tagColor.js';
import { useTranslatedDisplayText } from '../i18n/usePdfitI18n.js';

interface TagChipProps {
  tag: string;
  color?: string;
  onDelete?: () => void;
  onClick?: () => void;
  disabled?: boolean;
  size?: ChipProps['size'];
  compact?: boolean;
  plain?: boolean;
  hashLabel?: boolean;
}

/** 목록, 표지, 관리창, 뷰어에서 동일한 태그 형식을 사용한다. */
export default function TagChip({ tag, color, onDelete, onClick, disabled, size = 'small', compact = false, plain = false, hashLabel = false }: TagChipProps) {
  const theme = useTheme();
  const label = useTranslatedDisplayText(tag);
  const displayColor = tagColorForMode(color, theme.palette.mode);

  return (
    <Chip
      data-testid="pdf-tag-chip"
      label={hashLabel ? `# ${label}` : plain ? `#${label}` : label}
      title={label}
      translate="no"
      icon={plain || hashLabel ? undefined : <TagIcon />}
      size={size}
      variant="outlined"
      disabled={disabled}
      onDelete={onDelete}
      onClick={onClick}
      sx={{
        height: compact ? 22 : 24,
        maxWidth: compact ? 'min(150px, 100%)' : 220,
        border: plain ? 0 : undefined,
        borderColor: displayColor,
        borderRadius: plain ? 0.5 : 99,
        color: displayColor,
        bgcolor: 'transparent',
        fontSize: '.75rem',
        transition: theme.transitions.create(['background-color', 'box-shadow'], { duration: 150 }),
        '&:not(.Mui-disabled):hover, &:not(.Mui-disabled):focus-within': {
          bgcolor: alpha(displayColor, theme.palette.mode === 'dark' ? 0.28 : 0.16),
          boxShadow: plain ? 'none' : `0 0 0 1px ${alpha(displayColor, 0.4)}`,
        },
        '& .MuiChip-icon': { ml: compact ? 0.5 : 0.75, color: displayColor, fontSize: compact ? 14 : 15 },
        '& .MuiChip-label': { px: compact ? 0.5 : 0.75, overflow: 'hidden', textOverflow: 'ellipsis' },
        '& .MuiChip-deleteIcon': { mr: 0.5, color: displayColor, '&:hover': { color: displayColor, opacity: 0.75 } },
      }}
    />
  );
}

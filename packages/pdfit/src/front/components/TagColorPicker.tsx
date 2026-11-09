import React, { useState } from 'react';
import { IconButton, Popover, Box, Tooltip } from '@mui/material';
import HashTagIcon from './HashTagIcon.js';
import type { ReactNode } from 'react';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';

export const TAG_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
  '#fb7185', '#be123c', '#f59e0b', '#84cc16', '#15803d',
  '#0f766e', '#0e7490', '#1d4ed8', '#4338ca', '#7e22ce',
  '#c026d3', '#9d174d', '#92400e', '#78716c', '#475569',
];

/** 태그 입력 색상 기억 규칙은 docs/internals.md를 따른다. */
export function lastTagInputColor(): string {
  try { const color = localStorage.getItem('pdfit.tag-input-color'); return color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#3b82f6'; }
  catch { return '#3b82f6'; }
}

/** 사용자가 직접 고른 태그 입력 색상을 기억한다. */
export function rememberTagInputColor(color: string): void {
  try { localStorage.setItem('pdfit.tag-input-color', color); } catch { /* See docs/internals.md. */ }
}

interface Props { color: string; onChange: (color: string) => void; size?: 'small' | 'medium'; label?: string; icon?: ReactNode; variant?: 'tag' | 'swatch'; }

export default function TagColorPicker({ color, onChange, size = 'small', label = '태그 색상 변경', icon, variant = 'tag' }: Props) {
  const { ui } = usePdfitI18n();
  const displayedLabel = ui(label);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return <>
    <Tooltip title={displayedLabel} arrow><IconButton size={size} aria-label={displayedLabel} aria-haspopup="dialog" aria-expanded={!!anchor} onClick={(event) => { event.stopPropagation(); setAnchor(event.currentTarget); }}>
      {icon ?? (variant === 'swatch'
        ? <Box component="span" data-testid="tag-color-swatch" sx={{ width: size === 'small' ? 22 : 32, height: size === 'small' ? 22 : 32, borderRadius: '50%', bgcolor: color, border: '2px solid', borderColor: 'background.paper', boxShadow: (theme) => `0 0 0 1px ${theme.palette.divider}` }} />
        : <HashTagIcon sx={{ fontSize: size === 'small' ? 17 : 32, color }} />)}
    </IconButton>
    </Tooltip>
    <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} slotProps={{ paper: { role: 'dialog', 'aria-label': displayedLabel } }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 28px)', gap: 0.75, p: 1 }}>
        {TAG_COLORS.map((item) => <button key={item} data-testid="tag-color-option" type="button" aria-label={item} aria-pressed={item === color} onClick={(event) => { event.stopPropagation(); onChange(item); setAnchor(null); }} style={{ width: 26, height: 26, borderRadius: '50%', border: item === color ? '3px solid white' : '1px solid rgba(0,0,0,.2)', outline: item === color ? `2px solid ${item}` : 'none', background: item, cursor: 'pointer' }} />)}
      </Box>
    </Popover>
  </>;
}

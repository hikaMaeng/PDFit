import React, { useState } from 'react';
import { IconButton, Popover, Box } from '@mui/material';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import type { ReactNode } from 'react';

export const TAG_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'];

interface Props { color: string; onChange: (color: string) => void; size?: 'small' | 'medium'; label?: string; icon?: ReactNode; }

export default function TagColorPicker({ color, onChange, size = 'small', label = '태그 색상 변경', icon }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return <>
    <IconButton size={size} aria-label={label} onClick={(event) => { event.stopPropagation(); setAnchor(event.currentTarget); }}>
      {icon ?? <LocalOfferIcon sx={{ fontSize: size === 'small' ? 17 : 32, color }} />}
    </IconButton>
    <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 28px)', gap: 0.75, p: 1 }}>
        {TAG_COLORS.map((item) => <button key={item} type="button" aria-label={item} onClick={() => { onChange(item); setAnchor(null); }} style={{ width: 26, height: 26, borderRadius: '50%', border: item === color ? '3px solid white' : '1px solid rgba(0,0,0,.2)', outline: item === color ? `2px solid ${item}` : 'none', background: item, cursor: 'pointer' }} />)}
      </Box>
    </Popover>
  </>;
}

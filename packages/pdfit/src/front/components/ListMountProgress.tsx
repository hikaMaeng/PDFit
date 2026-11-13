import React from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';

/**
 * Tail of a progressively mounted library list: the sentinel `useProgressiveItems`
 * watches, plus the indicator shown while chunks are still being added. `data-list-mounted`
 * is the hook for browser tests: it turns `true` once every item is in the DOM.
 */
export default function ListMountProgress({ done, sentinelRef, rendered, total }: { done: boolean; sentinelRef: React.RefCallback<HTMLElement | null>; rendered: number; total: number }) {
  const { ui } = usePdfitI18n();
  return <Box
    ref={sentinelRef}
    data-testid="list-mount-sentinel"
    data-list-mounted={done ? 'true' : 'false'}
    data-list-rendered={rendered}
    data-list-total={total}
    sx={{ display: 'grid', placeItems: 'center', minHeight: done ? 0 : 56 }}
  >
    {done ? null : <Box role="status" aria-label={ui("목록 불러오는 중")} sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
      <CircularProgress size={16} thickness={4} />
      <Typography variant="caption">{ui("목록 불러오는 중 {p0}/{p1}", { p0: String(rendered), p1: String(total) })}</Typography>
    </Box>}
  </Box>;
}

import React, { type ReactNode } from 'react';
import { Box } from '@mui/material';

/** Keeps selection controls and column headings together; see docs/internals.md. */
export default function LibraryFixedControls({ children }: { children: ReactNode }) {
  return <Box data-testid="library-fixed-controls" sx={{ position: 'sticky', top: 'calc(-1 * var(--pdfit-main-padding-y, 0px))', zIndex: 5, bgcolor: 'background.default' }}>{children}</Box>;
}

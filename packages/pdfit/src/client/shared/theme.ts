export const pdfitBaseTheme = {
  palette: {
    mode: 'dark',
    primary: { main: '#3b82f6', light: '#60a5fa', dark: '#2563eb', contrastText: '#ffffff' },
    secondary: { main: '#4ade80', dark: '#22c55e', contrastText: '#07130b' },
    error: { main: '#ef4444' },
    warning: { main: '#f59e0b' },
    success: { main: '#22c55e' },
    background: {
      default: '#141414',
      paper: '#202124',
    },
    text: {
      primary: '#f5f5f5',
      secondary: '#c7c7cc',
      disabled: '#6f7278',
    },
    divider: 'rgba(255, 255, 255, 0.06)',
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h4: { fontWeight: 750 },
    h5: { fontWeight: 750 },
    h6: { fontWeight: 700 },
    button: { fontWeight: 650, textTransform: 'none' as const },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { backgroundColor: '#141414' },
        body: { backgroundColor: '#141414', color: '#f5f5f5' },
        '*': { boxSizing: 'border-box' },
        '.pdfit-pdf-row .pdfit-row-reveal': {
          opacity: 0,
          pointerEvents: 'none',
          transition: 'opacity 160ms ease',
        },
        '.pdfit-pdf-row .pdfit-row-actions': {
          opacity: 0.58,
          pointerEvents: 'auto',
        },
        '.pdfit-pdf-row:hover .pdfit-row-reveal, .pdfit-pdf-row:focus-within .pdfit-row-reveal, .pdfit-pdf-row[data-selected="true"] .pdfit-row-selection': {
          opacity: 1,
          pointerEvents: 'auto',
        },
        '@media (hover: none)': {
          '.pdfit-pdf-row .pdfit-row-reveal': { opacity: 1, pointerEvents: 'auto' },
        },
        '.pdfit-row-action:hover': {
          backgroundColor: 'rgba(127, 127, 127, 0.14)',
          transform: 'translateY(-1px)',
        },
        '.pdfit-row-action:focus-visible': {
          opacity: 1,
          backgroundColor: 'rgba(59, 130, 246, 0.18)',
          outline: '2px solid #3b82f6',
          outlineOffset: 1,
        },
        '.pdfit-row-action-delete:hover, .pdfit-row-action-delete:focus-visible': {
          color: '#ef4444 !important',
        },
        '*::-webkit-scrollbar': { width: 8, height: 8 },
        '*::-webkit-scrollbar-thumb': {
          border: '2px solid transparent',
          borderRadius: 999,
          background: '#3a3c42',
          backgroundClip: 'padding-box',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#1b1b1d',
          borderColor: 'rgba(255, 255, 255, 0.06)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: '#202124',
          borderColor: '#2b2c30',
        },
        outlined: { borderColor: '#2b2c30' },
      },
    },
    MuiDivider: { styleOverrides: { root: { borderColor: 'rgba(255, 255, 255, 0.06)' } } },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          transition: 'background-color 150ms ease, color 150ms ease',
          '&:hover': { backgroundColor: '#25272b' },
          '&.Mui-selected': {
            color: '#ffffff',
            backgroundColor: '#2a2f36',
            boxShadow: 'inset 3px 0 0 #3b82f6',
            '&:hover': { backgroundColor: '#2a2f36' },
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 6 },
        containedPrimary: { boxShadow: 'none', '&:hover': { boxShadow: 'none', backgroundColor: '#4f8ffb' } },
        outlined: { borderColor: '#3b82f6' },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          '&:hover': { backgroundColor: '#34363c' },
        },
      },
    },
    MuiTextField: { defaultProps: { variant: 'outlined', size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: '#242528',
          '& fieldset': { borderColor: '#32343a' },
          '&:hover fieldset': { borderColor: '#3a3c42' },
          '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
        },
      },
    },
    MuiInputLabel: { styleOverrides: { root: { color: '#9a9aa0' } } },
    MuiSelect: {
      styleOverrides: {
        select: { backgroundColor: '#242528' },
        icon: { color: '#9a9aa0' },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { backgroundColor: '#2b2d31', borderColor: 'rgba(255, 255, 255, 0.08)' },
        colorPrimary: { backgroundColor: 'rgba(59, 130, 246, 0.18)' },
        colorSecondary: { backgroundColor: 'rgba(34, 197, 94, 0.18)' },
      },
    },
    MuiTableCell: { styleOverrides: { root: { borderColor: 'rgba(255, 255, 255, 0.06)' } } },
    MuiDialog: { styleOverrides: { paper: { backgroundImage: 'none', backgroundColor: '#202124', border: '1px solid #2b2c30' } } },
  },
} as const;

export function createPdfitBaseTheme(mode: 'light' | 'dark') {
  if (mode === 'dark') return pdfitBaseTheme;
  // See packages/pdfit/docs/internals.md#문서-목록-정렬과-라이트-팔레트.
  const canvas = '#f8f8f8';
  const surface = '#ffffff';
  const input = '#ffffff';
  const sidebar = '#ffffff';
  const primary = '#2563eb';
  const divider = '#e8e8e8';
  return {
    ...pdfitBaseTheme,
    palette: {
      ...pdfitBaseTheme.palette,
      mode: 'light' as const,
      primary: { main: primary, light: '#60a5fa', dark: '#1d4ed8', contrastText: '#ffffff' },
      secondary: { main: '#287e72', light: '#45998c', dark: '#1f6259', contrastText: '#ffffff' },
      success: { main: '#258365', dark: '#1b654e', contrastText: '#ffffff' },
      warning: { main: '#a5691f', dark: '#805017', contrastText: '#ffffff' },
      error: { main: '#b84c55', dark: '#933740', contrastText: '#ffffff' },
      background: { default: canvas, paper: surface },
      text: { primary: '#30343b', secondary: '#626975', disabled: '#9298a2' },
      divider,
    },
    components: {
      ...pdfitBaseTheme.components,
      MuiCssBaseline: { styleOverrides: { ...pdfitBaseTheme.components.MuiCssBaseline.styleOverrides, html: { backgroundColor: canvas }, body: { backgroundColor: canvas, color: '#30343b' }, '.pdfit-pdf-row': { backgroundColor: 'transparent' }, '.pdfit-pdf-row:hover': { backgroundColor: '#f7f8fb' }, '.pdfit-row-action-delete:hover, .pdfit-row-action-delete:focus-visible': { color: '#b84c55 !important' }, '*::-webkit-scrollbar-thumb': { ...pdfitBaseTheme.components.MuiCssBaseline.styleOverrides['*::-webkit-scrollbar-thumb'], background: '#b9bec7' } } },
      MuiDrawer: { styleOverrides: { paper: { backgroundColor: sidebar, borderColor: '#d2d2d2' } } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none', backgroundColor: surface, borderColor: divider }, outlined: { borderColor: divider } } },
      MuiDivider: { styleOverrides: { root: { borderColor: divider } } },
      MuiListItemButton: { styleOverrides: { root: { ...pdfitBaseTheme.components.MuiListItemButton.styleOverrides.root, '&:hover': { backgroundColor: '#f0f3f8' }, '&.Mui-selected': { color: '#30343b', backgroundColor: '#eaf1ff', boxShadow: `inset 3px 0 0 ${primary}`, '&:hover': { backgroundColor: '#dee9ff' } } } } },
      MuiButton: { styleOverrides: { root: { borderRadius: 6 }, containedPrimary: { boxShadow: 'none', '&:hover': { boxShadow: 'none', backgroundColor: '#1d4ed8' } }, outlined: { borderColor: primary } } },
      MuiIconButton: { styleOverrides: { root: { borderRadius: 8, '&:hover': { backgroundColor: '#f0f3f8' } } } },
      MuiOutlinedInput: { styleOverrides: { root: { backgroundColor: input, '& fieldset': { borderColor: '#bfc4ce' }, '&:hover fieldset': { borderColor: '#8b94a3' }, '&.Mui-focused fieldset': { borderColor: primary } } } },
      MuiInputLabel: { styleOverrides: { root: { color: '#626975' } } },
      MuiSelect: { styleOverrides: { select: { backgroundColor: input }, icon: { color: '#626975' } } },
      MuiChip: { styleOverrides: { root: { backgroundColor: '#f2f4f7', borderColor: divider }, colorPrimary: { backgroundColor: 'rgba(37,99,235,.08)' }, colorSecondary: { backgroundColor: 'rgba(40,126,114,.11)' } } },
      MuiTableCell: { styleOverrides: { root: { borderColor: divider } } },
      MuiDialog: { styleOverrides: { paper: { backgroundImage: 'none', backgroundColor: surface, border: `1px solid ${divider}` } } },
    },
  };
}

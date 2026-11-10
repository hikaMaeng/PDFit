import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { CssBaseline, GlobalStyles, ThemeProvider, createTheme } from '@mui/material';
import App from './App.js';
import {
  PdfitFrontProvider,
  type PdfitFrontExtension,
  type PdfitFrontRuntimeConfig,
} from './context.js';

const baseTheme = {
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
    text: { primary: '#f5f5f5', secondary: '#c7c7cc', disabled: '#6f7278' },
    divider: 'rgba(255, 255, 255, 0.06)',
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
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
        root: { backgroundImage: 'none', backgroundColor: '#202124', borderColor: '#2b2c30' },
        outlined: { borderColor: '#2b2c30' },
      },
    },
    MuiDivider: { styleOverrides: { root: { borderColor: 'rgba(255, 255, 255, 0.06)' } } },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          '&:hover': { backgroundColor: '#25272b' },
          '&.Mui-selected': {
            color: '#ffffff', backgroundColor: '#2a2f36', boxShadow: 'inset 3px 0 0 #3b82f6',
            '&:hover': { backgroundColor: '#2a2f36' },
          },
        },
      },
    },
    MuiButton: { styleOverrides: { root: { borderRadius: 6 }, containedPrimary: { boxShadow: 'none' } } },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 8, '&:hover': { backgroundColor: '#34363c' } } } },
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
    MuiSelect: { styleOverrides: { select: { backgroundColor: '#242528' }, icon: { color: '#9a9aa0' } } },
    MuiChip: { styleOverrides: { root: { backgroundColor: '#2b2d31', borderColor: 'rgba(255, 255, 255, 0.08)' } } },
    MuiTableCell: { styleOverrides: { root: { borderColor: 'rgba(255, 255, 255, 0.06)' } } },
    MuiDialog: { styleOverrides: { paper: { backgroundImage: 'none', backgroundColor: '#202124', border: '1px solid #2b2c30' } } },
  },
} as const;

export type { PdfitFrontExtension, PdfitSidebarItem } from './context.js';

export function createPdfitFrontApp(extension: PdfitFrontExtension = {}) {
  const config: PdfitFrontRuntimeConfig = {
    appName: extension.appName ?? 'PDFit',
    appVersion: extension.appVersion ?? '0.0.0',
    extraRoutes: extension.extraRoutes ?? [],
    extraSidebarItems: extension.extraSidebarItems ?? [],
    aiAutoTagAccess: extension.aiAutoTagAccess,
    aiBulkTagLimit: extension.aiBulkTagLimit,
    onAiTagProcessed: extension.onAiTagProcessed,
    onAiTagRemoved: extension.onAiTagRemoved,
    bookMetadataEnabled: extension.bookMetadataEnabled,
    serverThumbnails: extension.serverThumbnails,
    bookResearchAccess: extension.bookResearchAccess,
    themeOptions: extension.themeOptions,
    languagePreference: extension.languagePreference,
  };

  const theme = createTheme(baseTheme, config.themeOptions ?? {});

  return function PdfitFrontApp() {
    return (
      <React.StrictMode>
        <PdfitFrontProvider value={config}>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <GlobalStyles styles={{
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
                backgroundColor: theme.palette.action.hover,
                transform: 'translateY(-1px)',
              },
              '.pdfit-row-action:focus-visible': {
                opacity: 1,
                backgroundColor: theme.palette.action.selected,
                outline: `2px solid ${theme.palette.primary.main}`,
                outlineOffset: 1,
              },
              '.pdfit-row-action-delete:hover, .pdfit-row-action-delete:focus-visible': {
                color: `${theme.palette.error.main} !important`,
              },
            }} />
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ThemeProvider>
        </PdfitFrontProvider>
      </React.StrictMode>
    );
  };
}

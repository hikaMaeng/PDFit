import React, { useEffect, useState } from 'react';
import { Typography, Box, Paper, Button, Chip, Divider, Stack } from '@mui/material';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import FolderIcon from '@mui/icons-material/Folder';
import FolderCopyIcon from '@mui/icons-material/FolderCopy';
import SpeedIcon from '@mui/icons-material/Speed';
import StorageIcon from '@mui/icons-material/Storage';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import GitHubIcon from '@mui/icons-material/GitHub';
import LabelIcon from '@mui/icons-material/Label';
import { Link } from 'react-router-dom';
import { usePdfitFrontConfig } from '../context';
import { foldersApi } from '../api/folders';
import { useTheme } from '@mui/material/styles';
import { usePdfitI18n } from '../i18n/usePdfitI18n';

export default function HomePage() {
  const theme = useTheme();
  const isLight = theme.palette.mode === 'light';
  const { t } = usePdfitI18n();
  const { appName, appVersion, navigationGuard } = usePdfitFrontConfig();
  const [rootFolderName, setRootFolderName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadRootFolder = async () => {
      try {
        const folders = await foldersApi.list();
        if (active) setRootFolderName(folders.find((folder) => folder.isRoot)?.name ?? folders[0]?.name ?? null);
      } catch {
        if (active) setRootFolderName(null);
      }
    };
    void loadRootFolder();
    window.addEventListener('folders-changed', loadRootFolder);
    return () => {
      active = false;
      window.removeEventListener('folders-changed', loadRootFolder);
    };
  }, []);

  const rootFolderPath = rootFolderName ? `/folder/${encodeURIComponent(rootFolderName)}` : '/';
  const libraryPath = navigationGuard?.(rootFolderPath) ?? rootFolderPath;

  const features = [
    { icon: <AttachFileIcon />, title: t('visualBookmarks'), copy: t('visualBookmarksCopy') },
    { icon: <MenuBookIcon />, title: t('readingFlow'), copy: t('readingFlowCopy') },
    { icon: <AutoAwesomeIcon />, title: t('aiMetadata'), copy: t('aiMetadataCopy') },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 60px)', gap: 2.5, pb: 4 }}>
      <Paper variant="outlined" sx={{ position: 'relative', overflow: 'hidden', p: { xs: 2.5, md: 5 }, borderRadius: 2, background: isLight ? '#ffffff' : 'linear-gradient(135deg, #202124 0%, #202b3f 100%)' }}>
        <Box
          component="img"
          src="/brand/pdfit-logo-dark.png"
          alt="PDFit"
          sx={{
            position: 'absolute',
            right: { xs: -28, sm: 24, md: 72 },
            top: { xs: 18, md: 22 },
            width: { xs: 118, sm: 150, md: 190 },
            height: { xs: 118, sm: 150, md: 190 },
            objectFit: 'contain',
            opacity: 0.92,
            filter: isLight ? 'none' : 'drop-shadow(0 14px 22px rgba(0,0,0,.24))',
          }}
        />
        <Stack spacing={2} sx={{ position: 'relative', maxWidth: 720 }}>
          <Stack direction="row" spacing={1} alignItems="center"><Chip size="small" label={`v${appVersion}`} color="primary" variant="outlined" /></Stack>
          <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: '-.04em', fontSize: { xs: '2rem', md: '3rem' } }}>{t('homeHeroLead')}<br /><Box component="span" sx={{ color: isLight ? 'primary.main' : 'primary.light' }}>{t('homeHeroAccent')}</Box></Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 600, lineHeight: 1.8 }}>{t('homeHeroCopy')}</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Button component={Link} to={libraryPath} disabled={!rootFolderName} variant="contained" startIcon={<FolderIcon />} endIcon={<ArrowForwardIcon />}>{t('openLibrary')}</Button>
            <Button component={Link} to="/bookmarks" variant="outlined" startIcon={<AttachFileIcon />}>{t('viewBookmarks')}</Button>
          </Stack>
        </Stack>
      </Paper>

      <Box><Typography variant="h6" fontWeight={750}>{t('coreValues')}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: .5 }}>{t('coreValuesCopy')}</Typography></Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, 1fr)' }, gap: 1.5 }}>
        <Paper variant="outlined" sx={{ p: { xs: 2.25, md: 3 }, minHeight: 220, background: isLight ? '#ffffff' : 'linear-gradient(135deg, #202124 0%, #17243b 100%)' }}>
          <Box sx={{ display: 'grid', placeItems: 'center', width: 48, height: 48, mb: 2, borderRadius: 1.5, color: isLight ? 'primary.main' : 'primary.light', backgroundColor: 'rgba(59,130,246,.16)' }}><SpeedIcon /></Box>
          <Typography variant="h5" fontWeight={800}>{t('fastViewer')}</Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1, lineHeight: 1.7 }}>{t('fastViewerCopy')}</Typography>
          <Chip label="WebGPU · PDFium WASM" size="small" sx={{ mt: 2 }} />
        </Paper>
        <Paper variant="outlined" sx={{ p: { xs: 2.25, md: 3 }, minHeight: 220, background: isLight ? '#ffffff' : 'linear-gradient(135deg, #202124 0%, #202d2a 100%)' }}>
          <Box sx={{ display: 'grid', placeItems: 'center', width: 48, height: 48, mb: 2, borderRadius: 1.5, color: isLight ? 'primary.main' : '#4ade80', backgroundColor: isLight ? '#edf4ff' : 'rgba(34,197,94,.14)' }}><LabelIcon /></Box>
          <Typography variant="h5" fontWeight={800}>{t('tagMap')}</Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1, lineHeight: 1.7 }}>{t('tagMapCopy')}</Typography>
          <Chip label={t('folders') + ' · ' + t('tags') + ' · ' + t('searchPdfs')} size="small" sx={{ mt: 2 }} />
        </Paper>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1.5 }}>
        {features.map((feature) => <Paper key={feature.title} variant="outlined" sx={{ p: 2.25, minHeight: 170, backgroundColor: 'background.paper' }}><Box sx={{ display: 'grid', placeItems: 'center', width: 38, height: 38, mb: 1.5, borderRadius: 1.5, color: isLight ? 'primary.main' : 'primary.light', backgroundColor: 'rgba(59,130,246,.14)' }}>{feature.icon}</Box><Typography fontWeight={700}>{feature.title}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: .75, lineHeight: 1.6 }}>{feature.copy}</Typography></Paper>)}
      </Box>

      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, backgroundColor: 'background.paper' }}><Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} justifyContent="space-between"><Box><Stack direction="row" spacing={1} alignItems="center"><GitHubIcon sx={{ color: isLight ? 'primary.main' : 'primary.light' }} /><Typography fontWeight={700}>{t('sourceAndReleases')}</Typography></Stack><Typography variant="body2" color="text.secondary" sx={{ mt: .75 }}>{t('sourceAndReleasesCopy')}</Typography></Box><Button component="a" href="https://github.com/hikaMaeng/PDFit" target="_blank" rel="noreferrer" variant="outlined" endIcon={<ArrowForwardIcon />} sx={{ flexShrink: 0 }}>github.com/hikaMaeng/PDFit</Button></Stack><Divider sx={{ my: 2 }} /><Stack direction="row" spacing={1} flexWrap="wrap"><Chip icon={<StorageIcon />} label={'PostgreSQL · ' + t('documentInfo')} size="small" variant="outlined" /><Chip icon={<MenuBookIcon />} label={'WebGPU · ' + t('fastViewer')} size="small" variant="outlined" /><Chip label="Docker · 15201" size="small" variant="outlined" /></Stack></Paper>
    </Box>
  );
}

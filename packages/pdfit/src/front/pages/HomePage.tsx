import { useEffect, useState, type ReactNode } from 'react';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ArticleOutlined from '@mui/icons-material/ArticleOutlined';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import BookmarksOutlined from '@mui/icons-material/BookmarksOutlined';
import DriveFileMoveOutlined from '@mui/icons-material/DriveFileMoveOutlined';
import FolderOpenOutlined from '@mui/icons-material/FolderOpenOutlined';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import GitHub from '@mui/icons-material/GitHub';
import GridViewOutlined from '@mui/icons-material/GridViewOutlined';
import LabelOutlined from '@mui/icons-material/LabelOutlined';
import ManageSearchOutlined from '@mui/icons-material/ManageSearchOutlined';
import MenuBookOutlined from '@mui/icons-material/MenuBookOutlined';
import OpenInNewOutlined from '@mui/icons-material/OpenInNewOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import TextSnippetOutlined from '@mui/icons-material/TextSnippetOutlined';
import TranslateOutlined from '@mui/icons-material/TranslateOutlined';
import { Link } from 'react-router-dom';
import { foldersApi } from '../api/folders';
import { usePdfitFrontConfig } from '../context';
import { usePdfitI18n } from '../i18n/usePdfitI18n';
import { FAVORITES_PATH } from '../model/favorites';
import { TAG_INDEX_PATH } from '../model/tagIndex';
import { UNTAGGED_PATH } from '../model/untagged';
import { RSC } from './home/resource';

type Feature = { icon: ReactNode; title: string; description: string };

const buttonLayout = {
  minHeight: 42,
  textAlign: 'start',
  whiteSpace: 'normal',
  '& .MuiButton-startIcon': { marginInlineStart: '-4px', marginInlineEnd: '8px' },
  '& .MuiButton-endIcon': { marginInlineStart: '8px', marginInlineEnd: '-4px' },
} as const;

function FeaturePanel({ id, title, icon, accent, features, actions }: {
  id: string;
  title: string;
  icon: ReactNode;
  accent: string;
  features: Feature[];
  actions: ReactNode;
}) {
  return (
    <Paper
      component="section"
      aria-labelledby={id}
      variant="outlined"
      sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, p: { xs: 2.25, md: 3 }, borderRadius: 2.5, borderBlockStart: `3px solid ${alpha(accent, 0.62)}` }}
    >
      <Stack direction="row" alignItems="center" gap={1.5}>
        <Box sx={{ display: 'grid', placeItems: 'center', flexShrink: 0, width: 44, height: 44, borderRadius: 1.5, color: accent, bgcolor: alpha(accent, 0.12) }}>
          {icon}
        </Box>
        <Typography id={id} component="h2" variant="h5" sx={{ fontSize: { xs: '1.23rem', lg: '1.45rem' }, overflowWrap: 'anywhere' }}>
          {title}
        </Typography>
      </Stack>
      <Box component="ul" role="list" sx={{ listStyle: 'none', p: 0, my: 2.25, flex: 1 }}>
        {features.map(({ icon: itemIcon, title: itemTitle, description }) => (
          <Box component="li" key={itemTitle} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, py: 1.45, borderBlockEnd: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', mt: 0.25, flexShrink: 0, color: accent }}>{itemIcon}</Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography component="h3" fontSize="0.97rem" fontWeight={750}>{itemTitle}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35, lineHeight: 1.65 }}>{description}</Typography>
            </Box>
          </Box>
        ))}
      </Box>
      <Stack direction="row" flexWrap="wrap" gap={1}>
        {actions}
      </Stack>
    </Paper>
  );
}

function LibraryArtwork() {
  return (
    <Box aria-hidden="true" sx={{ display: { xs: 'none', sm: 'grid', md: 'none', lg: 'grid' }, placeItems: 'center', minHeight: 195, direction: 'ltr' }}>
      <Box sx={{ position: 'relative', width: 238, height: 192, color: '#93c5fd' }}>
        <Box sx={{ position: 'absolute', inset: '3px 7px', borderRadius: '50%', background: 'radial-gradient(ellipse, #2563eb5c, transparent 70%)' }} />
        <Box sx={{ position: 'absolute', inset: '20px 40px 21px 39px', transform: 'rotate(-14deg)', border: '1px solid #60a5fa70', bgcolor: '#1d3761', borderRadius: 2 }} />
        <Box sx={{ position: 'absolute', inset: '20px 34px 21px 55px', transform: 'rotate(13deg)', border: '1px solid #8199bb78', bgcolor: '#263b59', borderRadius: 2 }} />
        <Box sx={{ position: 'absolute', inset: '18px 49px 20px', display: 'grid', justifyItems: 'center', alignContent: 'center', gap: 1.5, border: '1px solid #91b7f17a', bgcolor: '#172b49', borderRadius: 2, boxShadow: '0 16px 28px #08132165' }}>
          <Box component="img" src="/brand/pdfit-logo-dark.png" alt="" sx={{ width: 75, height: 75, objectFit: 'contain' }} />
          <Box sx={{ width: 64, height: 4, borderRadius: 2, bgcolor: '#6081ad' }} />
          <Box sx={{ width: 44, height: 4, borderRadius: 2, bgcolor: '#38567f' }} />
        </Box>
        <Box sx={{ position: 'absolute', top: 23, right: 13, display: 'grid', placeItems: 'center', width: 45, height: 45, border: '1px solid #a78bfa80', bgcolor: '#2c2451', color: '#d8c7ff', borderRadius: 1.5, boxShadow: '0 8px 20px #08132155' }}>
          <AutoAwesomeOutlined fontSize="small" />
        </Box>
        <Box sx={{ position: 'absolute', bottom: 24, left: 12, display: 'grid', placeItems: 'center', width: 45, height: 45, border: '1px solid #60a5fa80', bgcolor: '#193b69', borderRadius: 1.5, boxShadow: '0 8px 20px #08132155' }}>
          <LabelOutlined fontSize="small" />
        </Box>
      </Box>
    </Box>
  );
}

export default function HomePage() {
  const theme = useTheme();
  const isLight = theme.palette.mode === 'light';
  const { t } = usePdfitI18n();
  const { extraRoutes, navigationGuard, displayTranslation } = usePdfitFrontConfig();
  const [library, setLibrary] = useState<{ rootFolderName: string | null; loadFailed: boolean }>({ rootFolderName: null, loadFailed: false });
  const [libraryRetry, setLibraryRetry] = useState(0);
  const { rootFolderName, loadFailed } = library;

  useEffect(() => {
    let active = true;
    let latestRequest = 0;
    const loadRootFolder = async () => {
      const request = ++latestRequest;
      try {
        const folders = await foldersApi.list();
        if (active && request === latestRequest) {
          const folder = folders.find((item) => item.isRoot) ?? folders[0];
          setLibrary({ rootFolderName: folder?.name ?? null, loadFailed: false });
        }
      } catch {
        if (active && request === latestRequest) setLibrary((current) => ({ ...current, loadFailed: true }));
      }
    };
    void loadRootFolder();
    window.addEventListener('folders-changed', loadRootFolder);
    return () => {
      active = false;
      window.removeEventListener('folders-changed', loadRootFolder);
    };
  }, [libraryRetry]);

  const destination = (path: string) => navigationGuard?.(path) ?? path;
  const libraryPath = rootFolderName ? `/folder/${encodeURIComponent(rootFolderName)}` : '/';
  // The standalone app registers this route with its local OCR and AI server integration.
  const aiSettings = extraRoutes.find((route) => route.path === '/settings');
  const libraryAccent = isLight ? '#1e54b4' : '#81b8ff';
  const aiAccent = isLight ? '#6942b6' : '#c5adff';

  const libraryFeatures = [
    { icon: <DriveFileMoveOutlined fontSize="small" />, title: t(RSC.organizeTitle), description: t(RSC.organizeDescription) },
    { icon: <ManageSearchOutlined fontSize="small" />, title: t(RSC.findTitle), description: t(RSC.findDescription) },
    { icon: <GridViewOutlined fontSize="small" />, title: t(RSC.browseTitle), description: t(aiSettings ? RSC.browseLocalDescription : RSC.browseDescription) },
  ];
  const aiFeatures = [
    { icon: <LabelOutlined fontSize="small" />, title: t(RSC.autoTagTitle), description: t(RSC.autoTagDescription) },
    { icon: <TextSnippetOutlined fontSize="small" />, title: t(RSC.scanTitle), description: t(RSC.scanDescription) },
    ...(displayTranslation ? [{ icon: <TranslateOutlined fontSize="small" />, title: t(RSC.translateTitle), description: t(RSC.translateDescription) }] : []),
  ];

  return (
    <Stack spacing={{ xs: 2, md: 2.5 }} sx={{ pb: 4, maxWidth: 1380, mx: 'auto', '&:lang(ko)': { wordBreak: 'keep-all', overflowWrap: 'anywhere' } }}>
      <Paper
        component="header"
        variant="outlined"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) 238px', md: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(255px, 0.46fr)' },
          alignItems: 'center',
          gap: { sm: 2, lg: 3 },
          px: { xs: 2.5, sm: 3, lg: 5 },
          py: { xs: 3, md: 4.25 },
          borderRadius: 3,
          color: '#f1f6ff',
          background: 'linear-gradient(120deg, #111b2c 12%, #172b46 72%, #1b3456)',
          borderColor: '#49658e',
        }}
      >
        <Box>
          <Typography component="h1" sx={{ fontSize: { xs: '2rem', sm: '2.8rem', xl: '3.3rem' }, fontWeight: 820, lineHeight: 1.13, letterSpacing: '-0.035em', overflowWrap: 'anywhere' }}>
            {t(RSC.heroTitle)}<br />
            <Box component="span" sx={{ color: '#98caff' }}>{t(aiSettings ? RSC.heroAccent : RSC.heroCommonAccent)}</Box>
          </Typography>
          <Typography sx={{ maxWidth: '62ch', mt: 1.75, color: '#cedbef', lineHeight: 1.7 }}>
            {t(aiSettings ? RSC.heroDescription : RSC.heroCommonDescription)}
          </Typography>
          <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 2.5 }}>
            {!rootFolderName && loadFailed ? (
              <Button variant="outlined" onClick={() => {
                setLibrary((current) => ({ ...current, loadFailed: false }));
                setLibraryRetry((attempt) => attempt + 1);
              }} startIcon={<FolderOpenOutlined />} sx={{ ...buttonLayout, color: '#dbeaff', borderColor: '#7897bf' }}>
                {t(RSC.retryLibrary)}
              </Button>
            ) : (
              <Button component={Link} to={destination(libraryPath)} disabled={!rootFolderName} variant="contained" startIcon={<FolderOpenOutlined />} sx={{ ...buttonLayout, bgcolor: '#a4ceff', color: '#102746', boxShadow: 'none', '&:hover': { bgcolor: '#c4e0ff', boxShadow: 'none' }, '&.Mui-disabled': { bgcolor: '#2a3b53', color: '#b5c2d6' } }}>
                {t(RSC.openLibrary)}
              </Button>
            )}
            <Button component={Link} to={destination(TAG_INDEX_PATH)} variant="outlined" startIcon={<GridViewOutlined />} sx={{ ...buttonLayout, color: '#dbeaff', borderColor: '#7897bf', '&:hover': { borderColor: '#c1dbff', bgcolor: '#ffffff14' } }}>
              {t(RSC.openTagIndex)}
            </Button>
          </Stack>
        </Box>
        <LibraryArtwork />
      </Paper>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: aiSettings ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)' }, gap: { xs: 2, md: 2.5 } }}>
        <FeaturePanel
          id="home-library"
          title={t(RSC.libraryTitle)}
          icon={<FolderOutlined />}
          accent={libraryAccent}
          features={libraryFeatures}
          actions={<>
            <Button component={Link} to={destination(UNTAGGED_PATH)} variant="outlined" sx={{ ...buttonLayout, color: libraryAccent, borderColor: alpha(libraryAccent, 0.55) }}>{t(RSC.untagged)}</Button>
            <Button component={Link} to={destination(FAVORITES_PATH)} variant="text" sx={{ ...buttonLayout, color: libraryAccent }}>{t(RSC.favorites)}</Button>
          </>}
        />
        {aiSettings && (
          <FeaturePanel
            id="home-ai"
            title={t(RSC.aiTitle)}
            icon={<AutoAwesomeOutlined />}
            accent={aiAccent}
            features={aiFeatures}
            actions={<Button component={Link} to={destination(aiSettings.path)} variant="outlined" startIcon={<SettingsOutlined />} sx={{ ...buttonLayout, color: aiAccent, borderColor: alpha(aiAccent, 0.55), '&:hover': { borderColor: aiAccent, bgcolor: alpha(aiAccent, 0.08) } }}>{t(RSC.aiSettings)}</Button>}
          />
        )}
      </Box>

      <Paper component="section" aria-labelledby="home-reading" variant="outlined" sx={{ p: { xs: 2.25, md: 3 }, borderRadius: 2.5 }}>
        <Typography id="home-reading" component="h2" variant="h5" sx={{ fontSize: { xs: '1.23rem', lg: '1.45rem' } }}>{t(RSC.readingTitle)}</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' }, gap: { xs: 2, md: 3 }, mt: 2 }}>
          <Stack direction="row" gap={1.5} alignItems="flex-start">
            <MenuBookOutlined sx={{ color: libraryAccent, mt: 0.2 }} />
            <Box>
              <Typography component="h3" fontWeight={750}>{t(RSC.viewerTitle)}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.45, lineHeight: 1.65 }}>{t(aiSettings ? RSC.viewerLocalDescription : RSC.viewerDescription)}</Typography>
            </Box>
          </Stack>
          <Stack direction="row" gap={1.5} alignItems="flex-start">
            <BookmarksOutlined sx={{ color: libraryAccent, mt: 0.2 }} />
            <Box>
              <Typography component="h3" fontWeight={750}>{t(RSC.clipsTitle)}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.45, lineHeight: 1.65 }}>{t(RSC.clipsDescription)}</Typography>
              <Button component={Link} to={destination('/bookmarks')} variant="text" sx={{ ...buttonLayout, px: 0, mt: 0.5, color: libraryAccent }}>{t(RSC.viewClips)}</Button>
            </Box>
          </Stack>
        </Box>
      </Paper>

      <Box component="footer" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, borderBlockStart: '1px solid', borderColor: 'divider', pt: 1 }}>
        <Button component="a" href="https://github.com/hikaMaeng/PDFit" target="_blank" rel="noreferrer" color="inherit" startIcon={<GitHub />} sx={buttonLayout}>{t(RSC.source)}</Button>
        <Button component="a" href="https://github.com/hikaMaeng/PDFit/blob/main/CHANGELOG.md" target="_blank" rel="noreferrer" color="inherit" startIcon={<ArticleOutlined />} endIcon={<OpenInNewOutlined />} sx={buttonLayout}>{t(RSC.changelog)}</Button>
      </Box>
    </Stack>
  );
}

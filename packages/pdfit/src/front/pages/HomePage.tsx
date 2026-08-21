import React, { useEffect, useState } from 'react';
import { Typography, Box, Paper, Button, Chip, Divider, Stack } from '@mui/material';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import FolderCopyIcon from '@mui/icons-material/FolderCopy';
import SpeedIcon from '@mui/icons-material/Speed';
import StorageIcon from '@mui/icons-material/Storage';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import GitHubIcon from '@mui/icons-material/GitHub';
import LabelIcon from '@mui/icons-material/Label';
import { Link } from 'react-router-dom';
import { usePdfitFrontConfig } from '../context';
import { foldersApi } from '../api/folders';

export default function HomePage() {
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
    { icon: <BookmarkIcon />, title: '시각적 북마크', copy: '페이지 영역을 고해상도로 캡처하고 좌표, 색상, 투명도, 코멘트를 함께 저장합니다.' },
    { icon: <MenuBookIcon />, title: '독서 흐름 유지', copy: '읽던 위치와 진행률을 기억해 어떤 세션에서도 바로 이어 읽습니다.' },
    { icon: <AutoAwesomeIcon />, title: 'AI를 위한 메타데이터', copy: 'PostgreSQL과 pgvector를 기반으로 AI 서버와 확장 가능한 검색을 준비합니다.' },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 60px)', gap: 2.5, pb: 4 }}>
      <Paper variant="outlined" sx={{ position: 'relative', overflow: 'hidden', p: { xs: 2.5, md: 5 }, borderRadius: 2, background: 'linear-gradient(135deg, #202124 0%, #202b3f 100%)' }}>
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
            filter: 'drop-shadow(0 14px 22px rgba(0,0,0,.24))',
          }}
        />
        <Stack spacing={2} sx={{ position: 'relative', maxWidth: 720 }}>
          <Stack direction="row" spacing={1} alignItems="center"><Chip size="small" label={`v${appVersion}`} color="primary" variant="outlined" /><Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '.16em' }}>{appName} READING WORKSPACE</Typography></Stack>
          <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: '-.04em', fontSize: { xs: '2rem', md: '3rem' } }}>수천 개의 PDF도<br /><Box component="span" sx={{ color: 'primary.light' }}>빠르게 읽고, 쉽게 찾는 서재</Box></Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 600, lineHeight: 1.8 }}>PDFit은 설치형 PDF 뷰어를 뛰어넘는 WebGPU·PDFium WebAssembly 기반의 속도와, 태그 중심의 직관적인 문서 관리 경험을 하나로 제공합니다.</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Button component={Link} to={libraryPath} disabled={!rootFolderName} variant="contained" endIcon={<ArrowForwardIcon />}>라이브러리 열기</Button>
            <Button component={Link} to="/bookmarks" variant="outlined" startIcon={<BookmarkIcon />}>북마크 보기</Button>
          </Stack>
        </Stack>
      </Paper>

      <Box><Typography variant="h6" fontWeight={750}>PDFit의 핵심 가치</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: .5 }}>읽는 속도와 정리하는 방식이 달라지면, 문서가 지식이 됩니다.</Typography></Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, 1fr)' }, gap: 1.5 }}>
        <Paper variant="outlined" sx={{ p: { xs: 2.25, md: 3 }, minHeight: 220, background: 'linear-gradient(135deg, #202124 0%, #17243b 100%)' }}>
          <Box sx={{ display: 'grid', placeItems: 'center', width: 48, height: 48, mb: 2, borderRadius: 1.5, color: 'primary.light', backgroundColor: 'rgba(59,130,246,.16)' }}><SpeedIcon /></Box>
          <Typography variant="h5" fontWeight={800}>기다림이 사라지는 PDF 뷰어</Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1, lineHeight: 1.7 }}>WebGPU와 PDFium WebAssembly 렌더링으로 페이지를 빠르게 표시합니다. 대용량 문서도 스크롤과 확대가 끊기지 않아 읽는 흐름을 방해하지 않습니다.</Typography>
          <Chip label="WebGPU · PDFium WASM" size="small" sx={{ mt: 2 }} />
        </Paper>
        <Paper variant="outlined" sx={{ p: { xs: 2.25, md: 3 }, minHeight: 220, background: 'linear-gradient(135deg, #202124 0%, #202d2a 100%)' }}>
          <Box sx={{ display: 'grid', placeItems: 'center', width: 48, height: 48, mb: 2, borderRadius: 1.5, color: '#4ade80', backgroundColor: 'rgba(34,197,94,.14)' }}><LabelIcon /></Box>
          <Typography variant="h5" fontWeight={800}>태그로 만드는 나만의 문서 지도</Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1, lineHeight: 1.7 }}>폴더를 뒤지는 대신 여러 태그를 조합해 필요한 PDF를 즉시 찾습니다. 기술·업무·관심사별로 방대한 컬렉션을 직관적으로 분류하고 탐색하세요.</Typography>
          <Chip label="Folders · Tags · Search" size="small" sx={{ mt: 2 }} />
        </Paper>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1.5 }}>
        {features.map((feature) => <Paper key={feature.title} variant="outlined" sx={{ p: 2.25, minHeight: 170, backgroundColor: '#202124' }}><Box sx={{ display: 'grid', placeItems: 'center', width: 38, height: 38, mb: 1.5, borderRadius: 1.5, color: 'primary.light', backgroundColor: 'rgba(59,130,246,.14)' }}>{feature.icon}</Box><Typography fontWeight={700}>{feature.title}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: .75, lineHeight: 1.6 }}>{feature.copy}</Typography></Paper>)}
      </Box>

      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, backgroundColor: '#202124' }}><Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} justifyContent="space-between"><Box><Stack direction="row" spacing={1} alignItems="center"><GitHubIcon sx={{ color: 'primary.light' }} /><Typography fontWeight={700}>소스와 릴리스 확인</Typography></Stack><Typography variant="body2" color="text.secondary" sx={{ mt: .75 }}>설치 명령보다 먼저 PDFit의 코드, 문서, 최신 릴리스를 확인하세요.</Typography></Box><Button component="a" href="https://github.com/hikaMaeng/PDFit" target="_blank" rel="noreferrer" variant="outlined" endIcon={<ArrowForwardIcon />} sx={{ flexShrink: 0 }}>github.com/hikaMaeng/PDFit</Button></Stack><Divider sx={{ my: 2 }} /><Stack direction="row" spacing={1} flexWrap="wrap"><Chip icon={<StorageIcon />} label="PostgreSQL metadata" size="small" variant="outlined" /><Chip icon={<MenuBookIcon />} label="WebGPU reader" size="small" variant="outlined" /><Chip label="Docker · port 15201" size="small" variant="outlined" /></Stack></Paper>
    </Box>
  );
}

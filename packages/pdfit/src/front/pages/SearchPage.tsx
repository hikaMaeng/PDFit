import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Chip, CircularProgress, List, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import FindInPageOutlinedIcon from '@mui/icons-material/FindInPageOutlined';
import GridViewIcon from '@mui/icons-material/GridView';
import SearchIcon from '@mui/icons-material/Search';
import ViewListIcon from '@mui/icons-material/ViewList';
import PdfCoverItem from '../components/PdfCoverItem';
import PdfListHeader from '../components/PdfListHeader';
import PdfListItem from '../components/PdfListItem';
import LibraryFixedControls from '../components/LibraryFixedControls';
import { foldersApi } from '../api/folders';
import { searchApi, type BookSearchResult } from '../api/search';
import { tagsApi, type BookRef } from '../api/tags';
import { usePdfitFrontConfig } from '../context';
import { usePdfitI18n } from '../i18n/usePdfitI18n';

const bookKey = (book: BookRef, index: number) => `${book.driveFileId ?? `${book.folder}/${book.filename}`}\u0000${index}`;

/** `/search?q=` — 책 제목 부분 문자열 검색 결과. 데이터는 파일 시스템이 아니라 DB에서 온다. */
export default function SearchPage() {
  const { t, ui } = usePdfitI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const query = (params.get('q') ?? '').trim();
  const { aiAutoTagAccess, serverThumbnails } = usePdfitFrontConfig();
  const compactTagActions = !(aiAutoTagAccess?.() ?? true);
  const [libraryView, setLibraryView] = useState<'list' | 'covers'>(() => localStorage.getItem('pdfit.library.view') === 'covers' ? 'covers' : 'list');
  const [result, setResult] = useState<BookSearchResult | null>(null);
  const [tagColors, setTagColors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(Boolean(query));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isCurrent: () => boolean, background: boolean) => {
    if (!query) { setResult(null); setLoading(false); setError(null); return; }
    if (!background) setLoading(true);
    setError(null);
    try {
      const [found, summaries] = await Promise.all([searchApi.booksByTitle(query), tagsApi.listSummary().catch(() => [])]);
      if (!isCurrent()) return;
      setResult(found);
      setTagColors(Object.fromEntries(summaries.map((item) => [item.name, item.color])));
    } catch (caught) {
      if (isCurrent()) setError(caught instanceof Error ? caught.message : ui("로드 실패"));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    let current = true;
    const isCurrent = () => current;
    void load(isCurrent, false);
    // 폴더·태그가 바뀌면 같은 검색어로 조용히 다시 조회한다.
    const refresh = () => void load(isCurrent, true);
    window.addEventListener('folders-changed', refresh);
    window.addEventListener('tags-changed', refresh);
    return () => {
      current = false;
      window.removeEventListener('folders-changed', refresh);
      window.removeEventListener('tags-changed', refresh);
    };
  }, [load]);

  const books = result?.books ?? [];
  const openFolder = useCallback((folder: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    navigate(`/folder/${encodeURIComponent(folder)}`);
  }, [navigate]);

  return (
    <Box data-testid="search-results-page" sx={{ py: 0.5 }}>
      <Box sx={{ px: 1, mb: 0.5, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <SearchIcon sx={{ fontSize: 30, color: 'primary.main' }} />
        <Typography component="h1" variant="h5" fontWeight={700}>{t('searchResultsTitle')}</Typography>
        {query && result && <Chip data-testid="search-result-count" label={t('searchResultsSummary', { count: result.total, query })} size="small" color="primary" variant="outlined" sx={{ borderRadius: '4px', fontWeight: 600, maxWidth: '100%' }} />}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {!query ? (
        <Box data-testid="search-results-empty" sx={{ py: 8, textAlign: 'center' }}>
          <FindInPageOutlinedIcon sx={{ fontSize: 44, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary">{t('searchEnterQuery')}</Typography>
        </Box>
      ) : loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>
      ) : books.length === 0 ? (
        <Box data-testid="search-results-empty" sx={{ py: 8, textAlign: 'center' }}>
          <FindInPageOutlinedIcon sx={{ fontSize: 44, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary">{t('noPdfSearchResults')}</Typography>
        </Box>
      ) : (
        <>
          <LibraryFixedControls>
            <Box data-testid="search-results-toolbar" role="toolbar" aria-label={t('bookList')} sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, px: 1, py: 0.5, borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider' }}>
              {result && result.total > books.length && <Typography data-testid="search-results-limited" variant="body2" color="text.secondary">{t('searchResultsLimited', { shown: books.length, total: result.total })}</Typography>}
              <ToggleButtonGroup exclusive size="small" value={libraryView} onChange={(_, value: 'list' | 'covers' | null) => { if (value) { setLibraryView(value); localStorage.setItem('pdfit.library.view', value); } }} sx={{ ml: 'auto' }}>
                <ToggleButton value="list" aria-label={t('listView')}><ViewListIcon fontSize="small" /></ToggleButton>
                <ToggleButton value="covers" aria-label={t('coverView')}><GridViewIcon fontSize="small" /></ToggleButton>
              </ToggleButtonGroup>
            </Box>
            {libraryView === 'list' && <PdfListHeader compactTagActions={compactTagActions} />}
          </LibraryFixedControls>
          {libraryView === 'list' ? (
            <List data-testid="search-results-list" disablePadding>
              {books.map((book, index) => (
                <PdfListItem
                  compactTagActions={compactTagActions}
                  key={bookKey(book, index)}
                  filename={book.filename}
                  href={`/viewer/${encodeURIComponent(book.folder)}/${encodeURIComponent(book.filename)}${book.driveFileId ? `?driveFileId=${encodeURIComponent(book.driveFileId)}` : ''}`}
                  folder={book.folder}
                  driveFileId={book.driveFileId}
                  size={book.size}
                  modifiedAt={book.modified_at}
                  tags={book.tags}
                  tagColors={tagColors}
                  secondaryLinkLabel={book.folder}
                  onSecondaryLink={openFolder}
                />
              ))}
            </List>
          ) : (
            <Box data-testid="pdf-cover-grid" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 2, px: 1, py: 1.5 }}>
              {books.map((book, index) => (
                <PdfCoverItem
                  key={bookKey(book, index)}
                  filename={book.filename}
                  folder={book.folder}
                  driveFileId={book.driveFileId}
                  size={book.size}
                  modifiedAt={book.modified_at}
                  url={foldersApi.fileUrl(book.folder, book.filename, book.driveFileId)}
                  serverCover={serverThumbnails}
                  thumbnailUrl={!serverThumbnails ? foldersApi.thumbnailUrl(book.driveFileId) : book.driveFileId ? foldersApi.thumbnailUrl(book.driveFileId, book.modified_at, book.size) : foldersApi.localThumbnailUrl(book.folder, book.filename, book.modified_at, book.size)}
                  tags={book.tags}
                  tagColors={tagColors}
                  selected={false}
                  hideSelection
                  onSelectionChange={() => {}}
                />
              ))}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

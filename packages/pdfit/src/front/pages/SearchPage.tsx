import type { TagIconName } from '../../shared/tagDetails.js';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Chip, CircularProgress, Tab, Tabs, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import FindInPageOutlinedIcon from '@mui/icons-material/FindInPageOutlined';
import GridViewIcon from '@mui/icons-material/GridView';
import SearchIcon from '@mui/icons-material/Search';
import ViewListIcon from '@mui/icons-material/ViewList';
import ListMountProgress from '../components/ListMountProgress';
import { useProgressiveItems } from '../components/useProgressiveItems';
import LibraryBookItem, { LibraryBookCollection } from '../components/LibraryBookItem.js';
import PdfListHeader from '../components/PdfListHeader';
import LibraryFixedControls from '../components/LibraryFixedControls';
import { bookActionIdentity, useBookLibraryActions } from '../components/useBookLibraryActions';
import { searchApi, type BookSearchResult } from '../api/search';
import { tagsApi, type BookRef } from '../api/tags';
import { usePdfitFrontConfig } from '../context';
import { usePdfitI18n } from '../i18n/usePdfitI18n';
import { CONTENT_SEARCH_SCOPES, isContentSearchScope, type ContentSearchScope } from '../../common/protocol/search/index.js';
import ContentSearchResults from './ContentSearchResults.js';

const bookKey = (book: BookRef, index: number) => `${book.driveFileId ?? `${book.folder}/${book.filename}`}\u0000${index}`;

type SearchTab = 'title' | ContentSearchScope;
const TAB_LABELS = {
  title: 'searchScopeTitle',
  outline: 'searchScopeOutline',
  'page-ocr': 'searchScopePageOcr',
  'clip-ocr': 'searchScopeClipOcr',
  'clip-memo': 'searchScopeClipMemo',
} as const;
const SEARCH_TABS: SearchTab[] = ['title', ...CONTENT_SEARCH_SCOPES];

/** See docs/content-search.md#tabs for the lazy request contract. */
export default function SearchPage() {
  const { t } = usePdfitI18n();
  const { contentSearch } = usePdfitFrontConfig();
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') ?? '').trim();
  const requestedTab = params.get('scope');
  const selected = query && contentSearch && isContentSearchScope(requestedTab) ? requestedTab : 'title';
  return <Box data-testid="search-results-page" sx={{ py: 0.5 }}>
    <Box sx={{ px: 1, mb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
      <SearchIcon sx={{ fontSize: 30, color: 'primary.main' }} />
      <Typography component="h1" variant="h5" fontWeight={700}>{t('searchResultsTitle')}</Typography>
    </Box>
    {contentSearch ? <>
      <Tabs value={selected} variant="scrollable" scrollButtons="auto"
        aria-label={t('searchResultsTitle')} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
        onChange={(_, tab: SearchTab) => {
          const next = new URLSearchParams(params);
          if (tab === 'title') next.delete('scope');
          else next.set('scope', tab);
          setParams(next);
        }}>
        {SEARCH_TABS.map((tab) => <Tab key={tab} value={tab} label={t(TAB_LABELS[tab])}
          disabled={!query && tab !== 'title'} id={`search-tab-${tab}`} aria-controls={`search-panel-${tab}`}
          sx={{ minWidth: { xs: 'auto', sm: 90 }, px: { xs: 1.25, sm: 2 } }} />)}
      </Tabs>
      {SEARCH_TABS.map((tab) => <Box key={tab} role="tabpanel" hidden={selected !== tab}
        id={`search-panel-${tab}`} aria-labelledby={`search-tab-${tab}`}>
        {selected === tab && (tab === 'title' ? <TitleSearchResults query={query} />
          : <ContentSearchResults key={JSON.stringify([query, tab])} scope={tab} query={query} />)}
      </Box>)}
    </> : <TitleSearchResults query={query} />}
  </Box>;
}

function TitleSearchResults({ query }: { query: string }) {
  const { t, ui } = usePdfitI18n();
  const navigate = useNavigate();
  const { serverThumbnails } = usePdfitFrontConfig();
  const [libraryView, setLibraryView] = useState<'list' | 'covers'>(() => localStorage.getItem('pdfit.library.view') === 'covers' ? 'covers' : 'list');
  const [result, setResult] = useState<BookSearchResult | null>(null);
  const [books, setBooks] = useState<BookRef[]>([]);
  const [tagColors, setTagColors] = useState<Record<string, string>>({});
  const [tagIcons, setTagIcons] = useState<Record<string, TagIconName | undefined>>({});
  const [loading, setLoading] = useState(Boolean(query));
  const [error, setError] = useState<string | null>(null);
  // 결과가 많아도 한 번에 다 붙이지 않고 위에서부터 조금씩 그린다.
  const { rendered: renderedBooks, done: listFullyMounted, sentinelRef: listSentinelRef } = useProgressiveItems(books, `${query}\u0000${libraryView}`);

  const load = useCallback(async (signal: AbortSignal, background: boolean) => {
    if (!query) { setResult(null); setBooks([]); setLoading(false); setError(null); return; }
    if (!background) setLoading(true);
    setError(null);
    try {
      const [found, summaries] = await Promise.all([searchApi.booksByTitle(query, signal), tagsApi.listSummary().catch(() => [])]);
      if (signal.aborted) return;
      setResult(found);
      setBooks(found.books);
      setTagColors(Object.fromEntries(summaries.map((item) => [item.name, item.color])));
      setTagIcons(Object.fromEntries(summaries.map((item) => [item.name, item.icon])));
    } catch (caught) {
      if (!signal.aborted) setError(caught instanceof Error ? caught.message : ui("로드 실패"));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [query, ui]);

  useEffect(() => {
    let controller = new AbortController();
    void load(controller.signal, false);
    // 폴더·태그가 바뀌면 같은 검색어로 조용히 다시 조회한다.
    const refresh = () => {
      controller.abort();
      controller = new AbortController();
      void load(controller.signal, true);
    };
    window.addEventListener('folders-changed', refresh);
    window.addEventListener('tags-changed', refresh);
    window.addEventListener('tag-added', refresh);
    return () => {
      controller.abort();
      window.removeEventListener('folders-changed', refresh);
      window.removeEventListener('tags-changed', refresh);
      window.removeEventListener('tag-added', refresh);
    };
  }, [load]);

  const actions = useBookLibraryActions({ books, setBooks, tagColors, setTagColors, onError: setError });
  const openFolder = useCallback((folder: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    navigate(`/folder/${encodeURIComponent(folder)}`);
  }, [navigate]);

  return (
    <Box sx={{ py: 0.5 }}>
      {query && result?.query === query && <Box sx={{ px: 1, pb: 0.5 }}>
        <Chip data-testid="search-result-count" label={t('searchResultsSummary', { count: result.total, query })} size="small" color="primary" variant="outlined" sx={{ borderRadius: '4px', fontWeight: 600, maxWidth: '100%' }} />
      </Box>}

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
            {libraryView === 'list' && <PdfListHeader />}
          </LibraryFixedControls>
          <LibraryBookCollection view={libraryView} listTestId="search-results-list">
            {renderedBooks.map((book, index) => (
              <LibraryBookItem key={bookKey(book, index)} view={libraryView}
                folder={book.folder} filename={book.filename} driveFileId={book.driveFileId}
                size={book.size} modifiedAt={book.modified_at} clipCount={book.clipCount} clipCountRevision={book.clipCountRevision}
                serverCover={serverThumbnails} tags={actions.tagsOf(book)} tagColors={tagColors} tagIcons={tagIcons}
                onOpenFolder={openFolder}
                onTagDelete={(folder, filename, tag) => void actions.removeTagInline(folder, filename, tag, book.driveFileId)}
                onManageTags={(folder, filename) => void actions.openTagDialog(folder, filename, book.driveFileId)}
                onAutoTag={actions.canUseAiAutoTag ? () => void actions.autoTag(book) : undefined}
                autoTagging={actions.isAutoTagging(bookActionIdentity(book))}
                autoTagDisabled={actions.isAutoTagDisabled(bookActionIdentity(book))}
                onEditMetadata={actions.bookMetadataEnabled ? () => void actions.openDocumentMetadata(book) : undefined}
                onMove={(folder, filename) => void actions.openMoveDialog(folder, filename, book.driveFileId)}
                onDelete={(folder, filename) => actions.requestDelete(folder, filename, book.driveFileId)}
              />
            ))}
          </LibraryBookCollection>
          <ListMountProgress done={listFullyMounted} sentinelRef={listSentinelRef} rendered={renderedBooks.length} total={books.length} />
        </>
      )}
      {actions.dialogs}
    </Box>
  );
}

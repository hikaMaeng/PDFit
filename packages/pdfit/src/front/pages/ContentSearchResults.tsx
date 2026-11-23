import { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Link, List, ListItem, Typography } from '@mui/material';
import type { ContentSearchHit, ContentSearchResult, ContentSearchScope } from '../../common/protocol/search/index.js';
import { searchApi } from '../api/search.js';
import BookClipsDialog from '../components/clips/BookClipsDialog.js';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';
import { openViewer, viewerUrl } from '../viewer/openViewer.js';

type RequestState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; result: ContentSearchResult };

export default function ContentSearchResults({ scope, query }: { scope: ContentSearchScope; query: string }) {
  const { t } = usePdfitI18n();
  const [request, setRequest] = useState<RequestState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [clip, setClip] = useState<ContentSearchHit | null>(null);

  // This panel is mounted only while its query and scope are selected.
  useEffect(() => {
    const controller = new AbortController();
    void searchApi.content(scope, query, controller.signal).then(
      (result) => { if (!controller.signal.aborted) setRequest({ status: 'ready', result }); },
      () => { if (!controller.signal.aborted) setRequest({ status: 'error' }); },
    );
    return () => controller.abort();
  }, [scope, query, attempt]);

  if (request.status === 'loading') return <Box sx={{ display: 'grid', justifyContent: 'center', py: 7 }}>
    <CircularProgress aria-label={t('loading')} />
  </Box>;
  if (request.status === 'error') return <Alert severity="error" sx={{ m: 1 }}
    action={<Button color="inherit" onClick={() => { setRequest({ status: 'loading' }); setAttempt(attempt + 1); }}>{t('retry')}</Button>}>
    {t('searchContentFailed')}
  </Alert>;
  const { result } = request;
  if (!result.hits.length) return <Typography color="text.secondary" sx={{ py: 8, textAlign: 'center' }}>{t('searchContentEmpty')}</Typography>;

  const clipScope = scope === 'clip-ocr' || scope === 'clip-memo';
  return <>
    {result.hasMore && <Typography color="text.secondary" variant="body2" sx={{ px: 2, pt: 1 }}>
      {t('searchContentLimited', { count: result.hits.length })}
    </Typography>}
    <List data-testid="content-search-results" disablePadding>
      {result.hits.map((hit) => <ListItem divider key={JSON.stringify([hit.folder, hit.filename, hit.id])} sx={{ alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>
          <Link href={viewerUrl(hit)} fontWeight={700} onClick={(event) => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            openViewer(hit);
          }}>{hit.filename}</Link>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {hit.folder}{hit.page === null ? '' : ` · ${t('clipPage', { page: hit.page })}`}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>{hit.snippet}</Typography>
        </Box>
        {clipScope && <Button size="small" onClick={() => setClip(hit)}>{t('searchOpenClip')}</Button>}
      </ListItem>)}
    </List>
    {clip && <BookClipsDialog book={clip} initialClipId={clip.id} onClose={() => setClip(null)} />}
  </>;
}

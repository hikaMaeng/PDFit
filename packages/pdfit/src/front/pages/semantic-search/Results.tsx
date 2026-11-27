import { useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, Box, Button, CircularProgress, Link, List, ListItem, MenuItem, TextField, Typography } from '@mui/material';
import { SEMANTIC_SCOPES, isSemanticScope, type SemanticScope } from '../../../common/protocol/embedding-search/index.js';
import BookClipsDialog from '../../components/clips/BookClipsDialog.js';
import BookCommentsDialog from '../../components/book-comments/BookCommentsDialog.js';
import { bookCommentsModel } from '../../components/book-comments/model.js';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import { openViewer, viewerUrl } from '../../viewer/openViewer.js';
import { SemanticSearchModel } from './model.js';
import { SEMANTIC } from './resource.js';

export default function SemanticResults({ q, scope, selectScope }: { q: string; scope?: SemanticScope; selectScope: (scope?: SemanticScope) => void }) {
  const { t } = usePdfitI18n();
  const [model] = useState(() => new SemanticSearchModel());
  useSyncExternalStore(model.subscribe, model.getVersion);
  useEffect(() => model.load(q, scope), [model, q, scope]);
  useEffect(() => () => { if (model.selected?.scope === 'book-comment') bookCommentsModel.close(); }, [model]);
  const { result, selected } = model;
  return <Box sx={{ p: 1.5 }}>
    <TextField select size="small" label={t(SEMANTIC.source)} value={scope ?? 'all'} sx={{ minWidth: 180, mb: 1.5 }}
      onChange={(event) => selectScope(isSemanticScope(event.target.value) ? event.target.value : undefined)}>
      <MenuItem value="all">{t(SEMANTIC.all)}</MenuItem>
      {SEMANTIC_SCOPES.map((source) => <MenuItem key={source} value={source}>{t(SEMANTIC.scopes[source])}</MenuItem>)}
    </TextField>
    {!result && <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress aria-label={t('loading')} /></Box>}
    {result?.status === 'unconfigured' && <Alert severity="info">{t(SEMANTIC.unconfigured)}</Alert>}
    {result?.status === 'indexing' && <Alert severity="info">{t(SEMANTIC.indexing)}</Alert>}
    {result?.status === 'unavailable' && <Alert severity="error">{t('searchContentFailed')}</Alert>}
    {result?.status === 'ready' && !result.hits.length && <Typography color="text.secondary">{t('searchContentEmpty')}</Typography>}
    <List data-testid="semantic-search-results" disablePadding>
      {result?.hits.map((hit) => <ListItem divider key={`${hit.scope}:${hit.id}`} sx={{ gap: 1, alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
          <Link href={viewerUrl(hit)} fontWeight={700} onClick={(event) => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            openViewer(hit);
          }}>{hit.filename}</Link>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {t(SEMANTIC.scopes[hit.scope])}{hit.page === null ? '' : ` · ${t('clipPage', { page: hit.page })}`}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>{hit.snippet}</Typography>
        </Box>
        {hit.scope === 'book-comment' && <Button size="small" onClick={() => {
          bookCommentsModel.open(hit, undefined, hit.id);
          model.select(hit);
        }}>{t(SEMANTIC.openComment)}</Button>}
        {(hit.scope === 'clip-ocr' || hit.scope === 'clip-memo') && <Button size="small" onClick={() => model.select(hit)}>{t('searchOpenClip')}</Button>}
      </ListItem>)}
    </List>
    {selected?.scope === 'book-comment' && <BookCommentsDialog book={selected} onClose={() => { bookCommentsModel.close(); model.select(null); }} />}
    {selected && selected.scope !== 'book-comment' && <BookClipsDialog book={selected} initialClipId={selected.id} onClose={() => model.select(null)} />}
  </Box>;
}

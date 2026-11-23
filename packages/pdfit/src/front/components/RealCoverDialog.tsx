import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';
import { applyCover, coverPreviewUrl, coverQueryFromFilename, coverVersion, findCoverCandidates, restoreCover, type BookCoverCandidate, type BookCoverSource } from '../api/covers.js';

type Props = {
  open: boolean;
  folder: string;
  filename: string;
  onClose: () => void;
};

/**
 * Picks a real book cover for one local PDF. Searching is deterministic (bookstore and
 * catalogue lookups ordered by title match); the user chooses the image.
 */
export default function RealCoverDialog({ open, folder, filename, onClose }: Props) {
  const { t } = usePdfitI18n();
  const [query, setQuery] = useState(() => coverQueryFromFilename(filename));
  const [state, setState] = useState<'idle' | 'searching' | 'done' | 'applying'>('idle');
  const [candidates, setCandidates] = useState<BookCoverCandidate[]>([]);
  const [failedSources, setFailedSources] = useState<BookCoverSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<AbortController | null>(null);
  const replaced = Boolean(coverVersion(folder, filename));

  const cancelSearch = useCallback(() => {
    searchRef.current?.abort();
    searchRef.current = null;
  }, []);

  const search = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    cancelSearch();
    const controller = new AbortController();
    searchRef.current = controller;
    setState('searching');
    setError(null);
    // Each source has its own request so candidates can be used as they arrive.
    setCandidates([]);
    setFailedSources([]);
    const sources: BookCoverSource[] = ['YES24', 'Open Library'];
    let failure: unknown = null;
    let succeeded = 0;
    await Promise.all(sources.map(async (source) => {
      try {
        const result = await findCoverCandidates(trimmed, controller.signal, source);
        if (controller.signal.aborted) return;
        succeeded += 1;
        // Ordered by title score across the sources received so far; the sort is stable.
        setCandidates((current) => [...current, ...result.candidates].sort((left, right) => right.score - left.score));
        if (result.failedSources.length) setFailedSources((current) => [...new Set([...current, ...result.failedSources])]);
      } catch (reason) {
        if (controller.signal.aborted) return;
        failure = reason;
        setFailedSources((current) => [...new Set([...current, source])]);
      }
    }));
    if (controller.signal.aborted) return;
    searchRef.current = null;
    if (succeeded === 0 && failure) setError(failure instanceof Error ? failure.message : String(failure));
    setState('done');
  }, [cancelSearch]);

  useEffect(() => {
    if (!open) return;
    const initial = coverQueryFromFilename(filename);
    setQuery(initial);
    setState('idle');
    setCandidates([]);
    setFailedSources([]);
    setError(null);
    void search(initial);
    return cancelSearch;
  }, [open, filename, search, cancelSearch]);

  const close = () => {
    if (state === 'applying') return;
    cancelSearch();
    onClose();
  };

  const choose = async (candidate: BookCoverCandidate) => {
    cancelSearch();
    setState('applying');
    setError(null);
    try {
      await applyCover(folder, filename, candidate);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setState('done');
    }
  };

  const restore = async () => {
    setState('applying');
    setError(null);
    try {
      await restoreCover(folder, filename);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setState('done');
    }
  };

  const applying = state === 'applying';
  const busy = state === 'searching' || applying;

  return <Dialog open={open} onClose={close} fullWidth maxWidth="md" aria-labelledby="real-cover-dialog-title" data-testid="real-cover-dialog">
    <DialogTitle id="real-cover-dialog-title">{t('realCover')}</DialogTitle>
    <DialogContent dividers>
      <Typography variant="body2" color="text.secondary" translate="no" sx={{ mb: 1.5, overflowWrap: 'anywhere' }}>{filename}</Typography>
      <Box component="form" role="search" onSubmit={(event) => { event.preventDefault(); if (!busy) void search(query); }} sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <TextField size="small" fullWidth label={t('realCoverQuery')} value={query} onChange={(event) => setQuery(event.target.value)} inputProps={{ maxLength: 200, 'data-testid': 'real-cover-query' }} disabled={applying} />
        <Button type="submit" variant="contained" disabled={busy || !query.trim()} data-testid="real-cover-search" sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('realCoverSearch')}</Button>
      </Box>
      {state === 'searching' ? <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}><CircularProgress size={20} /><Typography variant="body2">{t('realCoverSearching')}</Typography></Box> : null}
      {applying ? <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}><CircularProgress size={20} /><Typography variant="body2">{t('realCoverApplying')}</Typography></Box> : null}
      {error !== null ? <Alert severity="error" sx={{ mb: 2 }}>{t('realCoverError', { reason: error })}</Alert> : null}
      {failedSources.length > 0 && state === 'done' ? <Alert severity="warning" sx={{ mb: 2 }}>{t('realCoverFailedSources', { sources: failedSources.join(', ') })}</Alert> : null}
      {state === 'done' && !error && candidates.length === 0 ? <Typography role="status" variant="body2" color="text.secondary" sx={{ py: 2 }}>{t('realCoverEmpty')}</Typography> : null}
      {candidates.length > 0 ? <Box component="ul" aria-label={t('realCover')} data-testid="real-cover-candidates" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', gap: 1.5 }}>
        {candidates.map((candidate) => {
          const label = t('realCoverApply', { title: candidate.title, source: candidate.source });
          return <Box component="li" key={`${candidate.source}:${candidate.imageUrl}`} data-testid="real-cover-candidate" data-source={candidate.source} sx={{ minWidth: 0 }}>
            <Box component="button" type="button" aria-label={label} title={label} disabled={applying} onClick={() => void choose(candidate)} sx={{ display: 'flex', flexDirection: 'column', gap: .5, width: '100%', p: .75, textAlign: 'left', font: 'inherit', color: 'inherit', bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, cursor: applying ? 'wait' : 'pointer', '&:hover:not(:disabled), &:focus-visible': { borderColor: 'primary.main', outline: 'none' } }}>
              <Box component="img" src={coverPreviewUrl(candidate.imageUrl)} alt="" loading="lazy" sx={{ display: 'block', width: '100%', aspectRatio: '3 / 4', objectFit: 'contain', bgcolor: 'action.hover' }} />
              <Typography variant="caption" sx={{ fontWeight: 700, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>{candidate.title}</Typography>
              {candidate.authors ? <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{candidate.authors}</Typography> : null}
              <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3 }}>{candidate.source} · {t('realCoverMatch', { score: Math.round(candidate.score * 100) })}</Typography>
            </Box>
          </Box>;
        })}
      </Box> : null}
    </DialogContent>
    <DialogActions>
      {replaced ? <Button onClick={() => void restore()} disabled={busy} data-testid="real-cover-restore">{t('realCoverRestore')}</Button> : null}
      <Box sx={{ flex: 1 }} />
      <Button onClick={close} disabled={applying}>{t('close')}</Button>
    </DialogActions>
  </Dialog>;
}

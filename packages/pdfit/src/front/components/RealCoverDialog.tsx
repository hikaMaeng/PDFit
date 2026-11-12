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
  const abortRef = useRef<AbortController | null>(null);
  const replaced = Boolean(coverVersion(folder, filename));

  const search = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState('searching');
    setError(null);
    try {
      const result = await findCoverCandidates(trimmed, controller.signal);
      if (controller.signal.aborted) return;
      setCandidates(result.candidates);
      setFailedSources(result.failedSources);
      setState('done');
    } catch (reason) {
      if (controller.signal.aborted) return;
      setCandidates([]);
      setError(t('realCoverError', { reason: reason instanceof Error ? reason.message : String(reason) }));
      setState('done');
    }
  }, [t]);

  useEffect(() => {
    if (!open) { abortRef.current?.abort(); return; }
    const initial = coverQueryFromFilename(filename);
    setQuery(initial);
    setCandidates([]);
    setFailedSources([]);
    setError(null);
    void search(initial);
    return () => abortRef.current?.abort();
  }, [open, filename, search]);

  const choose = async (candidate: BookCoverCandidate) => {
    setState('applying');
    setError(null);
    try {
      await applyCover(folder, filename, candidate);
      onClose();
    } catch (reason) {
      setError(t('realCoverError', { reason: reason instanceof Error ? reason.message : String(reason) }));
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
      setError(t('realCoverError', { reason: reason instanceof Error ? reason.message : String(reason) }));
      setState('done');
    }
  };

  const busy = state === 'searching' || state === 'applying';

  return <Dialog open={open} onClose={() => { if (state !== 'applying') onClose(); }} fullWidth maxWidth="md" aria-labelledby="real-cover-dialog-title" data-testid="real-cover-dialog">
    <DialogTitle id="real-cover-dialog-title">{t('realCover')}</DialogTitle>
    <DialogContent dividers>
      <Typography variant="body2" color="text.secondary" translate="no" sx={{ mb: 1.5, overflowWrap: 'anywhere' }}>{filename}</Typography>
      <Box component="form" role="search" onSubmit={(event) => { event.preventDefault(); void search(query); }} sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <TextField size="small" fullWidth label={t('realCoverQuery')} value={query} onChange={(event) => setQuery(event.target.value)} inputProps={{ maxLength: 200, 'data-testid': 'real-cover-query' }} disabled={state === 'applying'} />
        <Button type="submit" variant="contained" disabled={busy || !query.trim()} data-testid="real-cover-search" sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('realCoverSearch')}</Button>
      </Box>
      {state === 'searching' ? <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}><CircularProgress size={20} /><Typography variant="body2">{t('realCoverSearching')}</Typography></Box> : null}
      {state === 'applying' ? <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}><CircularProgress size={20} /><Typography variant="body2">{t('realCoverApplying')}</Typography></Box> : null}
      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
      {failedSources.length > 0 && state === 'done' ? <Alert severity="warning" sx={{ mb: 2 }}>{t('realCoverFailedSources', { sources: failedSources.join(', ') })}</Alert> : null}
      {state === 'done' && !error && candidates.length === 0 ? <Typography role="status" variant="body2" color="text.secondary" sx={{ py: 2 }}>{t('realCoverEmpty')}</Typography> : null}
      {candidates.length > 0 && state !== 'searching' ? <Box component="ul" aria-label={t('realCover')} data-testid="real-cover-candidates" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', gap: 1.5 }}>
        {candidates.map((candidate) => {
          const label = t('realCoverApply', { title: candidate.title, source: candidate.source });
          return <Box component="li" key={`${candidate.source}:${candidate.imageUrl}`} data-testid="real-cover-candidate" data-source={candidate.source} sx={{ minWidth: 0 }}>
            <Box component="button" type="button" aria-label={label} title={label} disabled={busy} onClick={() => void choose(candidate)} sx={{ display: 'flex', flexDirection: 'column', gap: .5, width: '100%', p: .75, textAlign: 'left', font: 'inherit', color: 'inherit', bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, cursor: busy ? 'wait' : 'pointer', '&:hover:not(:disabled), &:focus-visible': { borderColor: 'primary.main', outline: 'none' } }}>
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
      <Button onClick={onClose} disabled={state === 'applying'}>{t('close')}</Button>
    </DialogActions>
  </Dialog>;
}

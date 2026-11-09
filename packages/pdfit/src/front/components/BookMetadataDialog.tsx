import { usePdfitI18n } from '../i18n/usePdfitI18n.js';
import { useEffect, useRef, useState } from 'react';
import { Alert, Avatar, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Link, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import { bookMetadataApi, type BookMetadataRecord } from '../api/bookMetadata.js';

export interface BookMetadataTarget { driveFileId: string; filename: string }
type Editable = Omit<BookMetadataRecord, 'driveFileId' | 'updatedAt'>;

const empty = (target: BookMetadataTarget): Editable => ({
  documentType: 'document', title: target.filename.replace(/\.pdf$/i, ''), subtitle: '', authors: [], translator: '', publisher: '', publishedDate: '', isbn: '', language: '', subjects: [], description: '', summary: '', tableOfContents: '', coverUrl: '', sources: [], provenance: 'manual',
});
const editable = ({ driveFileId: _driveFileId, updatedAt: _updatedAt, ...metadata }: BookMetadataRecord): Editable => metadata;
const hasBookFields = (metadata: Editable): boolean => Boolean(metadata.isbn || metadata.translator || metadata.tableOfContents || metadata.coverUrl || metadata.sources.length);
const resolveDocumentType = (metadata: Editable): 'document' | 'book' => metadata.documentType === 'book' ? 'book' : metadata.documentType === 'document' ? 'document' : metadata.provenance === 'ai' || hasBookFields(metadata) ? 'book' : 'document';

export default function BookMetadataDialog({ target, onClose, onCoverChanged, canUseAiResearch, onUpgrade }: { target: BookMetadataTarget | null; onClose: () => void; onCoverChanged: (driveFileId: string) => void; canUseAiResearch: boolean; onUpgrade: () => void }) {
  const { t, ui } = usePdfitI18n();
  const [form, setForm] = useState<Editable | null>(null);
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState<'save' | 'research' | null>(null);
  const [autoCoverStatus, setAutoCoverStatus] = useState<'idle' | 'applying' | 'applied' | 'skipped' | 'failed'>('idle');
  const [notice, setNotice] = useState<{ severity: 'success' | 'error' | 'info'; text: string } | null>(null);
  const savedValue = useRef('');
  const pendingEdits = useRef<Partial<Editable>>({});
  const fetching = useRef(false);
  const researchAbort = useRef<AbortController | null>(null);
  const autoCoverAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!target) { setForm(null); savedValue.current = ''; pendingEdits.current = {}; fetching.current = false; return; }
    let active = true;
    const initial = empty(target);
    setForm(initial); savedValue.current = JSON.stringify(initial);
    pendingEdits.current = {}; fetching.current = true;
    setLoading(true); setNotice(null); setTab(0); setAutoCoverStatus('idle');
    void bookMetadataApi.get(target.driveFileId)
      .then((metadata) => { if (!active) return; const next = metadata ? editable(metadata) : empty(target); next.documentType = resolveDocumentType(next); setForm({ ...next, ...pendingEdits.current }); savedValue.current = JSON.stringify(next); })
      .catch((error) => { if (!active) return; const next = empty(target); setForm({ ...next, ...pendingEdits.current }); savedValue.current = JSON.stringify(next); setNotice({ severity: 'error', text: error instanceof Error ? error.message : String(error) }); })
      .finally(() => { if (active) { fetching.current = false; pendingEdits.current = {}; setLoading(false); } });
    return () => { active = false; researchAbort.current?.abort(); researchAbort.current = null; autoCoverAbort.current?.abort(); autoCoverAbort.current = null; };
  }, [target?.driveFileId, target?.filename]);

  const value = <K extends keyof Editable>(key: K, next: Editable[K]) => {
    if (fetching.current) pendingEdits.current[key] = next;
    setForm((current) => current ? { ...current, [key]: next } : current);
  };
  const cancelResearch = () => {
    researchAbort.current?.abort();
    researchAbort.current = null;
    setWorking(null);
    setNotice({ severity: 'info', text: ui("도서 정보 찾기를 중단했습니다.") });
  };
  const research = async () => {
    if (!target || !form || researchAbort.current) return;
    autoCoverAbort.current?.abort(); autoCoverAbort.current = null; setAutoCoverStatus('idle');
    const controller = new AbortController();
    researchAbort.current = controller;
    const timeout = window.setTimeout(() => controller.abort(new DOMException(ui("도서 정보 조회 시간이 지났습니다."), 'TimeoutError')), 30_000);
    setWorking('research'); setNotice({ severity: 'info', text: ui("공개 도서 데이터에서 정보를 찾고 있습니다.") });
    try {
      const result = editable(await bookMetadataApi.research(target.driveFileId, form.title, controller.signal));
      if (researchAbort.current !== controller) return;
      setForm({ ...result, documentType: 'book' }); setNotice({ severity: 'success', text: ui("도서 정보를 불러왔습니다. 내용을 확인한 뒤 변경사항을 저장하세요.") });
      if (result.coverUrl) {
        const coverController = new AbortController();
        autoCoverAbort.current = coverController;
        setAutoCoverStatus('applying');
        void bookMetadataApi.autoCover(target.driveFileId, result.title, result.coverUrl, coverController.signal)
          .then(({ applied }) => {
            if (autoCoverAbort.current !== coverController) return;
            setAutoCoverStatus(applied ? 'applied' : 'skipped');
            if (applied) { onCoverChanged(target.driveFileId); setNotice({ severity: 'success', text: ui("도서 정보와 표지를 자동으로 연결했습니다. 내용을 확인한 뒤 저장하세요.") }); }
          })
          .catch(() => { if (autoCoverAbort.current === coverController) setAutoCoverStatus('failed'); })
          .finally(() => { if (autoCoverAbort.current === coverController) autoCoverAbort.current = null; });
      }
    } catch (error) {
      if (researchAbort.current !== controller) return;
      setNotice({ severity: 'error', text: controller.signal.reason instanceof DOMException && controller.signal.reason.name === 'TimeoutError'
        ? ui("도서 정보 조회 시간이 지났습니다. 다시 시도하거나 직접 입력해 주세요.")
        : error instanceof Error ? error.message : String(error) });
    } finally {
      window.clearTimeout(timeout);
      if (researchAbort.current === controller) { researchAbort.current = null; setWorking(null); }
    }
  };
  const save = async () => {
    if (!target || !form) return;
    setWorking('save'); setNotice(null);
    try { const saved = editable(await bookMetadataApi.save(target.driveFileId, { ...form, driveFileId: target.driveFileId, updatedAt: new Date().toISOString() })); setForm(saved); savedValue.current = JSON.stringify(saved); setNotice({ severity: 'success', text: ui("문서 정보를 저장했습니다.") }); }
    catch (error) { setNotice({ severity: 'error', text: error instanceof Error ? error.message : String(error) }); }
    finally { setWorking(null); }
  };
  const dirty = Boolean(form) && JSON.stringify(form) !== savedValue.current;
  const bookMode = form?.documentType === 'book';
  const requestClose = () => {
    if (dirty && !window.confirm(ui("변경사항을 저장하지 않고 닫을까요?"))) return;
    if (working === 'research') { researchAbort.current?.abort(); researchAbort.current = null; setWorking(null); }
    autoCoverAbort.current?.abort(); autoCoverAbort.current = null;
    onClose();
  };

  return <Dialog open={Boolean(target)} onClose={working && working !== 'research' ? undefined : requestClose} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 3, minHeight: { sm: bookMode ? 650 : 420 } } }}>
    <DialogTitle sx={{ pb: 1 }}><Stack direction="row" alignItems="center" spacing={1.5}><Avatar sx={{ bgcolor: 'primary.main' }}><MenuBookOutlinedIcon /></Avatar><Box minWidth={0}><Typography component="div" variant="h6" fontWeight={850}>{ui("파일정보")}</Typography><Typography variant="caption" color="text.secondary" noWrap>{ui("파일명")}: <Box component="span" translate="no">{target?.filename}</Box></Typography></Box></Stack></DialogTitle>
    <Box sx={{ px: 3, borderBottom: 1, borderColor: 'divider' }}><Tabs value={tab} onChange={(_event, next) => setTab(next)} variant="scrollable"><Tab label={ui("기본 정보")} /><Tab label={ui("설명·요약")} />{bookMode ? <Tab label={ui("목차")} /> : null}{bookMode ? <Tab label={ui("출처 {p0}", { p0: form?.sources.length ?? 0 })} /> : null}</Tabs></Box>
    <DialogContent sx={{ pt: 2.5 }}>
      {!form ? <Box sx={{ minHeight: 360, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box> : <Stack spacing={2.25} aria-busy={loading}>
        {loading ? <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary', fontSize: 12 }}><CircularProgress size={16} />{t('loading')}</Box> : null}
        {notice ? <Alert severity={notice.severity} onClose={() => setNotice(null)}>{ui(notice.text)}</Alert> : null}
        {tab === 0 ? <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: bookMode ? 'minmax(0,1fr) 220px' : '1fr' }, gap: 3 }}>
          <Stack spacing={1.75}>
            <TextField label={ui("제목")} value={form.title} onChange={(event) => value('title', event.target.value)} />
            <TextField label={ui("부제·보조 제목")} value={form.subtitle} onChange={(event) => value('subtitle', event.target.value)} />
            {bookMode ? <>
              <TextField label={ui("저자")} value={form.authors.join(', ')} onChange={(event) => value('authors', event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} helperText={ui("여러 명은 쉼표로 구분")} />
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}><TextField label={ui("역자")} value={form.translator} onChange={(event) => value('translator', event.target.value)} /><TextField label={ui("출판사")} value={form.publisher} onChange={(event) => value('publisher', event.target.value)} /></Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}><TextField label={ui("출간일")} value={form.publishedDate} onChange={(event) => value('publishedDate', event.target.value)} /><TextField label="ISBN" value={form.isbn} onChange={(event) => value('isbn', event.target.value)} /></Box>
            </> : null}
            <TextField label={ui("키워드")} value={form.subjects.join(', ')} onChange={(event) => value('subjects', event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} />
          </Stack>
          {bookMode ? <Stack spacing={1.5}>
            <Box sx={{ aspectRatio: '3 / 4', border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', display: 'grid', placeItems: 'center', bgcolor: 'action.hover' }}>{form.coverUrl ? <Box component="img" src={form.coverUrl} alt={ui("검색된 도서 표지")} sx={{ width: '100%', height: '100%', objectFit: 'contain', bgcolor: '#fff' }} /> : <MenuBookOutlinedIcon sx={{ fontSize: 56, color: 'text.disabled' }} />}</Box>
            {autoCoverStatus === 'applying' ? <Typography role="status" variant="caption" color="text.secondary">{ui("표지 자동 연결 중…")}</Typography> : null}
            {autoCoverStatus === 'applied' ? <Typography role="status" variant="caption" color="success.main">{ui("표지가 자동으로 연결되었습니다.")}</Typography> : null}
          </Stack> : null}
        </Box> : null}
        {tab === 1 ? <Stack spacing={2}><TextField label={bookMode ? ui("책 소개") : ui("문서 설명")} multiline minRows={5} value={form.description} onChange={(event) => value('description', event.target.value)} /><TextField label={ui("요약")} multiline minRows={7} value={form.summary} onChange={(event) => value('summary', event.target.value)} /></Stack> : null}
        {tab === 2 ? <TextField label={ui("목차")} multiline minRows={18} value={form.tableOfContents} onChange={(event) => value('tableOfContents', event.target.value)} /> : null}
        {tab === 3 ? <Stack spacing={1}>{form.sources.length === 0 ? <Alert severity="info">{ui("저장된 웹 출처가 없습니다.")}</Alert> : form.sources.map((source) => <Paper key={source.url} variant="outlined" sx={{ p: 1.5 }}><Link href={source.url} target="_blank" rel="noreferrer" underline="hover">{source.title}</Link><Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: .5, overflowWrap: 'anywhere' }}>{source.url}</Typography></Paper>)}</Stack> : null}
      </Stack>}
    </DialogContent>
    <Divider />
    <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>{canUseAiResearch
        ? <Button variant="outlined" color={working === 'research' ? 'warning' : 'primary'} startIcon={working === 'research' ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />} onClick={working === 'research' ? cancelResearch : () => void research()} disabled={loading || !form || (Boolean(working) && working !== 'research')}>{working === 'research' ? ui("검색 중단") : ui("파일정보 찾기")}</Button>
        : <Stack spacing={1} alignItems="flex-start"><Typography variant="body2" color="text.secondary">{ui("AI 파일정보 찾기는 유료 이용권에서 사용할 수 있습니다.")}</Typography><Button variant="outlined" color="warning" startIcon={<AutoAwesomeIcon />} onClick={onUpgrade} disabled={loading || Boolean(working)}>{ui("유료 이용권 안내")}</Button></Stack>}</Stack>
      <Stack direction="row" spacing={1}><Button onClick={requestClose} disabled={Boolean(working) && working !== 'research'}>{ui("닫기")}</Button><Button variant="contained" startIcon={working === 'save' ? <CircularProgress color="inherit" size={17} /> : <SaveOutlinedIcon />} onClick={() => void save()} disabled={loading || !form || !dirty || Boolean(working)}>{ui("변경사항 저장")}</Button></Stack>
    </DialogActions>
  </Dialog>;
}

import { useEffect, useState } from 'react';
import { Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import { tagsApi } from '../api/tags.js';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';
import TagColorPicker, { lastTagInputColor, rememberTagInputColor } from './TagColorPicker.js';

type Document = { folder: string; filename: string; driveFileId?: string };
/** 전체 선택한 문서의 태그 추가는 docs/internals.md를 따른다. */
export default function BulkManualTagDialog({ documents, onClose, onAdded }: { documents: Document[] | null; onClose: () => void; onAdded: (document: Document, tag: string, color?: string) => void }) {
  const { t, ui } = usePdfitI18n();
  const [input, setInput] = useState('');
  const [options, setOptions] = useState<string[]>([]);
  const [color, setColor] = useState(lastTagInputColor);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => { if (documents) { setInput(''); setNotice(''); void tagsApi.list().then(setOptions).catch(() => setOptions([])); } }, [documents]);
  const add = async () => {
    const tag = input.trim();
    if (!tag || !documents || busy) return;
    setBusy(true); setNotice(''); setFailed(false);
    let added = 0;
    const newTag = !options.includes(tag);
    let savedColor = false;
    try {
      for (const document of documents) {
        const existing = await tagsApi.listForBook(document.folder, document.filename, document.driveFileId);
        if (existing.includes(tag)) continue;
        await tagsApi.addTag(document.folder, document.filename, tag, document.driveFileId);
        onAdded(document, tag);
        added++;
      }
      if (newTag && added > 0) { await tagsApi.updateColor(tag, color); savedColor = true; }
      if (savedColor) for (const document of documents) onAdded(document, tag, color);
      setOptions(previous => previous.includes(tag) ? previous : [...previous, tag]);
      setInput('');
      setNotice(ui('{p0}개 파일에 태그를 추가했습니다. 이미 있는 태그는 유지했습니다.', { p0: String(added) }));
    } catch {
      setFailed(true);
      setNotice(ui('{p0}개 파일까지 추가했습니다. 나머지 파일은 다시 시도해 주세요.', { p0: String(added) }));
    } finally { setBusy(false); window.dispatchEvent(new Event('tags-changed')); }
  };
  return <Dialog open={documents !== null} disableAutoFocus onClose={() => { if (!busy) onClose(); }} maxWidth="xs" fullWidth>
    <DialogTitle>{t('manageTags')}</DialogTitle>
    <DialogContent>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{ui('선택한 {p0}개 파일에 태그를 일괄 추가합니다.', { p0: String(documents?.length ?? 0) })}</Typography>
      {notice && <Alert severity={failed ? 'error' : 'success'} sx={{ mb: 2 }}>{notice}</Alert>}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Autocomplete freeSolo options={options} inputValue={input} onInputChange={(_, value) => setInput(value)} disabled={busy} sx={{ flex: 1 }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { (event as typeof event & { defaultMuiPrevented: boolean }).defaultMuiPrevented = true; event.preventDefault(); void add(); } }} renderInput={params => <TextField {...params} size="small" label={t('addTag')} InputLabelProps={{ shrink: true }} placeholder={ui('태그 추가 또는 목록에서 선택')} sx={{ '& .MuiInputLabel-root': { color: 'text.secondary' }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'text.secondary' }, '&:hover .MuiInputLabel-root, &:hover .MuiOutlinedInput-notchedOutline': { color: 'primary.main', borderColor: 'primary.main' } }} />} />
        <TagColorPicker color={color} onChange={value => { setColor(value); rememberTagInputColor(value); }} />
        <Button variant="contained" disabled={busy || !input.trim()} onClick={() => void add()}>{busy ? ui('추가 중') : ui('추가')}</Button>
      </Box>
    </DialogContent>
    <DialogActions><Button disabled={busy} onClick={onClose}>{t('close')}</Button></DialogActions>
  </Dialog>;
}

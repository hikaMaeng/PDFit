import { useState } from 'react';
import { Box, InputBase, List, ListItemButton, ListItemIcon, ListItemText, Radio, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import { usePdfitI18n, useTranslatedDisplayText } from '../i18n/usePdfitI18n.js';

function FolderName({ name }: { name: string }) { return <>{useTranslatedDisplayText(name)}</>; }

/** 폴더 이동 선택 UI는 docs/internals.md를 따른다. */
export default function FolderDestinationPicker({ folders, value, onChange, disabled }: { folders: { name: string; color?: string }[]; value: string; onChange: (name: string) => void; disabled: boolean }) {
  const { t, ui, language } = usePdfitI18n();
  const [query, setQuery] = useState('');
  const visibleFolders = folders.filter(folder => folder.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => a.name.localeCompare(b.name, language, { numeric: true, sensitivity: 'base' }));
  return <Box>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{t('targetFolder')}</Typography>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: .75, bgcolor: 'action.hover', borderRadius: 1, mb: 1 }}>
      <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
      <InputBase value={query} onChange={event => setQuery(event.target.value)} disabled={disabled} placeholder={ui('폴더 검색')} inputProps={{ 'aria-label': ui('폴더 검색') }} sx={{ flex: 1, fontSize: 14 }} />
    </Box>
    <List data-testid="folder-destination-list" role="radiogroup" aria-label={t('targetFolder')} disablePadding sx={{ maxHeight: 202, overflowY: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, scrollSnapType: 'y proximity' }}>
      {visibleFolders.map((folder) => <ListItemButton key={folder.name} role="radio" aria-checked={value === folder.name} selected={value === folder.name} disabled={disabled} onClick={() => onChange(folder.name)} sx={{ height: 40, minHeight: 40, borderRadius: 0, py: .5, scrollSnapAlign: 'start', borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 0 }, '&.Mui-selected': { bgcolor: 'action.selected', boxShadow: 'inset 3px 0 #3b82f6' } }}>
        <ListItemIcon sx={{ minWidth: 36 }}><FolderOutlinedIcon sx={{ color: folder.color ?? 'primary.main' }} /></ListItemIcon>
        <ListItemText title={folder.name} primary={<FolderName name={folder.name} />} primaryTypographyProps={{ variant: 'body2', noWrap: true }} sx={{ minWidth: 0 }} />
        <Radio checked={value === folder.name} tabIndex={-1} disableRipple sx={{ p: .25, ml: 1 }} inputProps={{ 'aria-hidden': true }} />
      </ListItemButton>)}
      {visibleFolders.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>{folders.length === 0 ? ui('이동할 수 있는 폴더가 없습니다.') : ui('일치하는 폴더가 없습니다.')}</Typography>}
    </List>
    {value && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{ui('선택한 폴더')} : <FolderName name={value} /></Typography>}
  </Box>;
}

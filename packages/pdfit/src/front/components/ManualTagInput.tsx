import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Autocomplete, Box, Button, TextField, Typography } from '@mui/material';
import { pdfitMetadataScope } from '../cache/metadataCache.js';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';
import { recentTagsForScope } from '../model/recentTags.js';
import { RSC } from './resource.js';

interface Props {
  tags: string[];
  assignedTags?: string[];
  value: string;
  disabled: boolean;
  onInputChange: (value: string) => void;
  onAdd: (tag: string) => void;
  onSelect?: (tag: string) => void;
  children: ReactNode;
}

export default function ManualTagInput({ tags, assignedTags, value, disabled, onInputChange, onAdd, onSelect = onAdd, children }: Props) {
  const { t } = usePdfitI18n();
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const history = recentTagsForScope(pdfitMetadataScope());
  const recent = useSyncExternalStore(history.subscribe, history.getSnapshot, history.getSnapshot)
    .filter((tag) => tags.includes(tag));
  const recentLabel = t(RSC.TAG_MANAGE_RECENT_LABEL);

  return (
    <Box ref={setAnchor}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Autocomplete
          freeSolo
          fullWidth
          value={null}
          disabled={disabled}
          options={tags.filter((tag) => !assignedTags?.includes(tag))}
          inputValue={value}
          onInputChange={(_event, input, reason) => {
            if (reason === 'input' || reason === 'clear') onInputChange(input);
          }}
          onChange={(_event, tag) => { if (tag) onSelect(tag); }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            const muiEvent = event as typeof event & { defaultMuiPrevented?: boolean };
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
              muiEvent.defaultMuiPrevented = true;
              return;
            }
            const input = event.target as HTMLInputElement;
            if (input.getAttribute('aria-activedescendant')) return;
            event.preventDefault();
            muiEvent.defaultMuiPrevented = true;
            if (input.value.trim()) onAdd(input.value);
          }}
          slotProps={{
            popper: {
              anchorEl: anchor,
              placement: 'bottom-start',
              modifiers: [{ name: 'offset', options: { offset: [0, 4] } }],
              // Matches the xs dialog body after its horizontal margins and padding.
              style: { width: 'min(396px, calc(100vw - 112px))' },
            },
            paper: {
              translate: 'no',
              sx: {
                '& .MuiAutocomplete-listbox': {
                  display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                  gridAutoFlow: 'row', direction: 'ltr', gap: 0.25, p: 0.5,
                  maxHeight: 'min(280px, 40dvh)',
                  '& .MuiAutocomplete-option': { minWidth: 0, minHeight: 36, px: { xs: 0.5, sm: 1 }, borderRadius: 1, fontSize: '0.875rem' },
                },
              },
            },
          }}
          renderOption={({ key, ...props }, tag) => (
            <li key={key} {...props} title={tag}>
              <Box component="span" dir="auto" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</Box>
            </li>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              label={t('addTag')}
              InputLabelProps={{ shrink: true }}
              size="small"
              placeholder={t('addTagPlaceholder')}
              sx={{
                '& .MuiOutlinedInput-root fieldset': { borderColor: 'text.secondary' },
                '& .MuiInputLabel-root': { color: 'text.secondary' },
                '& input::placeholder': { color: 'text.secondary', opacity: 1 },
                '&:hover .MuiOutlinedInput-root:not(.Mui-disabled) fieldset, & .MuiOutlinedInput-root.Mui-focused fieldset': { borderColor: '#3b82f6' },
                '&:hover .MuiInputLabel-root:not(.Mui-disabled), & .MuiInputLabel-root.Mui-focused': { color: '#3b82f6' },
              }}
            />
          )}
        />
        {children}
      </Box>
      {recent.length > 0 && (
        <Box role="group" aria-label={recentLabel} sx={{ mt: 0.75 }}>
          <Typography variant="caption" color="text.secondary">{recentLabel}</Typography>
          <Box translate="no" sx={{ display: 'flex', gap: 0.5, mt: 0.25 }}>
            {recent.map((tag) => (
              <Button key={tag} type="button" variant="outlined" size="small" title={tag}
                disabled={disabled || assignedTags?.includes(tag)} onClick={() => onAdd(tag)}
                sx={{ minWidth: 0, px: 1, py: 0.25, borderRadius: 4, textTransform: 'none' }}>
                <Box component="span" dir="auto" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</Box>
              </Button>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

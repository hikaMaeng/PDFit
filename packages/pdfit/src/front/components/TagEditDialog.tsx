import { useId, useState, type FormEvent } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, ToggleButton, Tooltip, Typography } from '@mui/material';
import { DEFAULT_TAG_ICON, isEditableTagName, TAG_ICONS, type TagDetailsPatch } from '../../shared/tagDetails.js';
import { tagsApi, type TagSummary } from '../api/tags.js';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';
import { publishTagDetailsChange } from '../model/tagDetailsEvents.js';
import { RSC } from './resource.js';
import TagColorPicker from './TagColorPicker.js';
import TagGlyph from './TagGlyph.js';

const iconLabels = {
  tag: RSC.TAG_ICON_TAG_LABEL,
  book: RSC.TAG_ICON_BOOK_LABEL,
  code: RSC.TAG_ICON_CODE_LABEL,
  science: RSC.TAG_ICON_SCIENCE_LABEL,
  school: RSC.TAG_ICON_SCHOOL_LABEL,
  work: RSC.TAG_ICON_WORK_LABEL,
  star: RSC.TAG_ICON_STAR_LABEL,
  lightbulb: RSC.TAG_ICON_LIGHTBULB_LABEL,
  language: RSC.TAG_ICON_LANGUAGE_LABEL,
  palette: RSC.TAG_ICON_PALETTE_LABEL,
  music: RSC.TAG_ICON_MUSIC_LABEL,
  build: RSC.TAG_ICON_BUILD_LABEL,
};

export default function TagEditDialog({ tag, onClose }: { tag: TagSummary & { id: string }; onClose: () => void }) {
  const { t } = usePdfitI18n();
  const titleId = useId();
  const formId = useId();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const initialIcon = tag.icon ?? DEFAULT_TAG_ICON;
  const [icon, setIcon] = useState(initialIcon);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<RSC | null>(null);
  const nextName = name === tag.name ? tag.name : name.trim();
  const nameChanged = nextName !== tag.name;
  const nameInvalid = nameChanged && !isEditableTagName(nextName);
  const changed = nameChanged || color !== tag.color || icon !== initialIcon;

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !changed || nameInvalid) return;
    setSaving(true);
    setError(null);
    const patch: TagDetailsPatch = { previousName: tag.name };
    if (nameChanged) patch.name = nextName;
    if (color !== tag.color) patch.color = color;
    if (icon !== initialIcon) patch.icon = icon;
    let saved;
    try {
      saved = await tagsApi.updateDetails(tag.id, patch);
    } catch (caught) {
      const status = (caught as { status?: number }).status;
      setError(status === 409 ? RSC.TAG_EDITOR_DUPLICATE_ALERT
        : status === 404 || status === 412 ? RSC.TAG_EDITOR_STALE_ALERT
          : RSC.TAG_EDITOR_FAILED_ALERT);
      setSaving(false);
      return;
    }
    publishTagDetailsChange({ previousName: tag.name, name: saved.name });
    onClose();
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId}>{t(RSC.TAG_EDITOR_TITLE_TEXT)}</DialogTitle>
      <DialogContent>
        <Box id={formId} component="form" onSubmit={save} aria-busy={saving} sx={{ display: 'grid', gap: 2, pt: 1 }}>
          <TextField autoFocus fullWidth size="small" label={t(RSC.TAG_EDITOR_NAME_LABEL)} value={name}
            error={nameInvalid || error === RSC.TAG_EDITOR_DUPLICATE_ALERT}
            helperText={nameInvalid ? t(RSC.TAG_EDITOR_INVALID_ALERT) : undefined}
            disabled={saving} onChange={(event) => { setName(event.target.value); setError(null); }} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2">{t(RSC.TAG_EDITOR_COLOR_LABEL)}</Typography>
            <TagColorPicker color={color} onChange={setColor} label={t(RSC.TAG_EDITOR_COLOR_LABEL)} variant="swatch" disabled={saving} />
            <Typography variant="body2" color="text.secondary" dir="ltr">{color}</Typography>
          </Box>
          <Box component="fieldset" disabled={saving} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
            <Typography component="legend" variant="body2" sx={{ mb: 0.75, p: 0 }}>{t(RSC.TAG_EDITOR_ICON_LABEL)}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(38px, 1fr))', gap: 0.5 }}>
              {TAG_ICONS.map((option) => (
                <Tooltip key={option} title={t(iconLabels[option])}>
                  <ToggleButton type="button" value={option} selected={option === icon} aria-label={t(iconLabels[option])}
                    size="small" onClick={() => setIcon(option)} sx={{ minHeight: 38 }}>
                    <TagGlyph icon={option} fontSize="small" sx={{ color: option === icon ? color : undefined }} />
                  </ToggleButton>
                </Tooltip>
              ))}
            </Box>
          </Box>
          {error && <Alert severity="error">{t(error)}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('cancel')}</Button>
        <Button type="submit" form={formId} variant="contained" disabled={!changed || nameInvalid || saving}>
          {saving ? t(RSC.TAG_EDITOR_SAVING_STATUS) : t('save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

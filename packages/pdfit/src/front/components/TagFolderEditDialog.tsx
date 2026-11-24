import { useId, useState, type FormEvent } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import { normalizeTagFolderName, TAG_FOLDER_NAME_MAX, type EditTagFolderRequest, type TagFolder } from '../../common/protocol/tagFolders/index.js';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';
import { tagFoldersModel } from '../model/tagFoldersModel.js';
import TagColorPicker from './TagColorPicker.js';
import { RSC } from './resource.js';

export default function TagFolderEditDialog({ folder, defaultColor, onClose }: {
  folder: TagFolder;
  defaultColor: string;
  onClose: () => void;
}) {
  const { t } = usePdfitI18n();
  const titleId = useId();
  const formId = useId();
  const [name, setName] = useState(folder.name);
  const [color, setColor] = useState(folder.color);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'tagFolderDuplicate' | RSC.TAGFOLDER_EDITOR_FAILED_ALERT | null>(null);
  const nextName = name === folder.name ? name : normalizeTagFolderName(name);
  const changed = nextName !== folder.name || color !== folder.color;
  const colorLabel = t(RSC.TAGFOLDER_EDITOR_COLOR_LABEL);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !changed || nextName === null) return;
    setSaving(true);
    setError(null);
    const patch: EditTagFolderRequest = {};
    if (nextName !== folder.name) patch.name = nextName;
    if (color !== folder.color) patch.color = color;
    try {
      await tagFoldersModel.edit(folder.id, patch);
      onClose();
    } catch (caught) {
      setError((caught as { status?: number }).status === 409 ? 'tagFolderDuplicate' : RSC.TAGFOLDER_EDITOR_FAILED_ALERT);
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId}>{t(RSC.TAGFOLDER_EDITOR_TITLE_TEXT)}</DialogTitle>
      <DialogContent>
        <Box component="form" id={formId} onSubmit={save} aria-busy={saving} sx={{ display: 'grid', gap: 2, pt: 1 }}>
          <TextField autoFocus fullWidth size="small" label={t('tagFolderName')} value={name} disabled={saving}
            error={nextName === null || error === 'tagFolderDuplicate'}
            helperText={nextName === null ? t(RSC.TAGFOLDER_EDITOR_INVALID_ALERT) : undefined}
            inputProps={{ maxLength: TAG_FOLDER_NAME_MAX }}
            onChange={(event) => { setName(event.target.value); setError(null); }} />
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="body2">{colorLabel}</Typography>
            <TagColorPicker color={color ?? defaultColor} label={colorLabel} onChange={setColor} disabled={saving}
              icon={<FolderOutlinedIcon sx={{ color: color ?? defaultColor }} />} />
            <Button type="button" size="small" onClick={() => setColor(null)} disabled={saving || color === null}>
              {t(RSC.TAGFOLDER_EDITOR_DEFAULT_BUTTON)}
            </Button>
          </Box>
          {error && <Alert severity="error">{t(error)}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('cancel')}</Button>
        <Button type="submit" form={formId} variant="contained" disabled={saving || !changed || nextName === null}>
          {saving ? t(RSC.TAG_EDITOR_SAVING_STATUS) : t('save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

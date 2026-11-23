import { useId, useState, type FormEvent } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, ToggleButton, Tooltip, Typography } from '@mui/material';
import { DEFAULT_TAG_ICON, isEditableTagName, TAG_ICON_GROUPS, type TagDetailsPatch, type TagIconGroup, type TagIconName } from '../../shared/tagDetails.js';
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
  robot: RSC.TAG_ICON_ROBOT_LABEL,
  terminal: RSC.TAG_ICON_TERMINAL_LABEL,
  database: RSC.TAG_ICON_DATABASE_LABEL,
  cloud: RSC.TAG_ICON_CLOUD_LABEL,
  network: RSC.TAG_ICON_NETWORK_LABEL,
  security: RSC.TAG_ICON_SECURITY_LABEL,
  lock: RSC.TAG_ICON_LOCK_LABEL,
  chip: RSC.TAG_ICON_CHIP_LABEL,
  devices: RSC.TAG_ICON_DEVICES_LABEL,
  phone: RSC.TAG_ICON_PHONE_LABEL,
  chart: RSC.TAG_ICON_CHART_LABEL,
  math: RSC.TAG_ICON_MATH_LABEL,
  biotech: RSC.TAG_ICON_BIOTECH_LABEL,
  medicine: RSC.TAG_ICON_MEDICINE_LABEL,
  health: RSC.TAG_ICON_HEALTH_LABEL,
  psychology: RSC.TAG_ICON_PSYCHOLOGY_LABEL,
  finance: RSC.TAG_ICON_FINANCE_LABEL,
  commerce: RSC.TAG_ICON_COMMERCE_LABEL,
  factory: RSC.TAG_ICON_FACTORY_LABEL,
  architecture: RSC.TAG_ICON_ARCHITECTURE_LABEL,
  travel: RSC.TAG_ICON_TRAVEL_LABEL,
  map: RSC.TAG_ICON_MAP_LABEL,
  history: RSC.TAG_ICON_HISTORY_LABEL,
  law: RSC.TAG_ICON_LAW_LABEL,
  people: RSC.TAG_ICON_PEOPLE_LABEL,
  chat: RSC.TAG_ICON_CHAT_LABEL,
  writing: RSC.TAG_ICON_WRITING_LABEL,
  image: RSC.TAG_ICON_IMAGE_LABEL,
  video: RSC.TAG_ICON_VIDEO_LABEL,
  audio: RSC.TAG_ICON_AUDIO_LABEL,
  sports: RSC.TAG_ICON_SPORTS_LABEL,
  nature: RSC.TAG_ICON_NATURE_LABEL,
  animals: RSC.TAG_ICON_ANIMALS_LABEL,
  food: RSC.TAG_ICON_FOOD_LABEL,
  home: RSC.TAG_ICON_HOME_LABEL,
  space: RSC.TAG_ICON_SPACE_LABEL,
  generative: RSC.TAG_ICON_GENERATIVE_LABEL,
  model: RSC.TAG_ICON_MODEL_LABEL,
  neural: RSC.TAG_ICON_NEURAL_LABEL,
  prompt: RSC.TAG_ICON_PROMPT_LABEL,
  agent: RSC.TAG_ICON_AGENT_LABEL,
  rag: RSC.TAG_ICON_RAG_LABEL,
  vision: RSC.TAG_ICON_VISION_LABEL,
  speech: RSC.TAG_ICON_SPEECH_LABEL,
  training: RSC.TAG_ICON_TRAINING_LABEL,
  evaluation: RSC.TAG_ICON_EVALUATION_LABEL,
  automation: RSC.TAG_ICON_AUTOMATION_LABEL,
  ocr: RSC.TAG_ICON_OCR_LABEL,
  relational: RSC.TAG_ICON_RELATIONAL_LABEL,
  query: RSC.TAG_ICON_QUERY_LABEL,
  schema: RSC.TAG_ICON_SCHEMA_LABEL,
  tables: RSC.TAG_ICON_TABLES_LABEL,
  index: RSC.TAG_ICON_INDEX_LABEL,
  vector: RSC.TAG_ICON_VECTOR_LABEL,
  warehouse: RSC.TAG_ICON_WAREHOUSE_LABEL,
  pipeline: RSC.TAG_ICON_PIPELINE_LABEL,
  cache: RSC.TAG_ICON_CACHE_LABEL,
  backup: RSC.TAG_ICON_BACKUP_LABEL,
  container: RSC.TAG_ICON_CONTAINER_LABEL,
  cluster: RSC.TAG_ICON_CLUSTER_LABEL,
  server: RSC.TAG_ICON_SERVER_LABEL,
  virtualization: RSC.TAG_ICON_VIRTUALIZATION_LABEL,
  deployment: RSC.TAG_ICON_DEPLOYMENT_LABEL,
  monitoring: RSC.TAG_ICON_MONITORING_LABEL,
  logs: RSC.TAG_ICON_LOGS_LABEL,
  key: RSC.TAG_ICON_KEY_LABEL,
  firewall: RSC.TAG_ICON_FIREWALL_LABEL,
  loadbalancer: RSC.TAG_ICON_LOADBALANCER_LABEL,
  gpu: RSC.TAG_ICON_GPU_LABEL,
  orchestration: RSC.TAG_ICON_ORCHESTRATION_LABEL,
  api: RSC.TAG_ICON_API_LABEL,
  git: RSC.TAG_ICON_GIT_LABEL,
  test: RSC.TAG_ICON_TEST_LABEL,
  debug: RSC.TAG_ICON_DEBUG_LABEL,
  cicd: RSC.TAG_ICON_CICD_LABEL,
  package: RSC.TAG_ICON_PACKAGE_LABEL,
  web: RSC.TAG_ICON_WEB_LABEL,
  frontend: RSC.TAG_ICON_FRONTEND_LABEL,
  backend: RSC.TAG_ICON_BACKEND_LABEL,
  ide: RSC.TAG_ICON_IDE_LABEL,
  review: RSC.TAG_ICON_REVIEW_LABEL,
} satisfies Record<TagIconName, RSC>;

const groupLabels = {
  ai: RSC.TAG_ICON_GROUP_AI_LABEL,
  data: RSC.TAG_ICON_GROUP_DATA_LABEL,
  infra: RSC.TAG_ICON_GROUP_INFRA_LABEL,
  development: RSC.TAG_ICON_GROUP_DEVELOPMENT_LABEL,
  general: RSC.TAG_ICON_GROUP_GENERAL_LABEL,
} satisfies Record<TagIconGroup, RSC>;

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
    <Dialog open onClose={saving ? undefined : onClose} aria-labelledby={titleId} maxWidth="sm" fullWidth>
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
            <Box sx={{ display: 'grid', gap: 1.5 }}>
              {TAG_ICON_GROUPS.map((group) => (
                <Box key={group.id} role="group" aria-labelledby={`${formId}-${group.id}`}>
                  <Typography id={`${formId}-${group.id}`} variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                    {t(groupLabels[group.id])}
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))', gap: 0.5 }}>
                    {group.icons.map((option) => (
                      <Tooltip key={option} title={t(iconLabels[option])}>
                        <ToggleButton type="button" value={option} selected={option === icon} aria-label={t(iconLabels[option])}
                          size="small" onClick={() => setIcon(option)} sx={{ minHeight: 40 }}>
                          <TagGlyph icon={option} fontSize="small" sx={{ color: option === icon ? color : undefined }} />
                        </ToggleButton>
                      </Tooltip>
                    ))}
                  </Box>
                </Box>
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

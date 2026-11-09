import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import {
  createAiServer,
  deleteAiServer,
  listAiServers,
  type AiServer,
  type AiServerInput,
  type AiServerType,
  updateAiServer,
} from '../../api/settings';
import { usePdfitI18n } from '@pdfit/pdfit/client/service';

interface HeadersEditorProps {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}

function HeadersEditor({ value, onChange }: HeadersEditorProps) {
  const { t } = usePdfitI18n();
  const pairs = Object.entries(value);

  function update(index: number, key: string, nextValue: string) {
    const next = [...pairs];
    next[index] = [key, nextValue];
    onChange(Object.fromEntries(next));
  }

  function remove(index: number) {
    onChange(Object.fromEntries(pairs.filter((_, currentIndex) => currentIndex !== index)));
  }

  function add() {
    onChange({ ...value, '': '' });
  }

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
        {t('additionalHeaders')}
      </Typography>
      <Stack spacing={1}>
        {pairs.map(([key, entryValue], index) => (
          <Stack key={`${key}-${index}`} direction="row" spacing={1} alignItems="center">
            <TextField
              size="small"
              placeholder={t('header')}
              value={key}
              onChange={(event) => update(index, event.target.value, entryValue)}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              placeholder={t('value')}
              value={entryValue}
              onChange={(event) => update(index, key, event.target.value)}
              sx={{ flex: 2 }}
            />
            <IconButton size="small" onClick={() => remove(index)}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
        <Button size="small" startIcon={<AddIcon />} onClick={add} sx={{ alignSelf: 'flex-start' }}>
          {t('addHeader')}
        </Button>
      </Stack>
    </Box>
  );
}

const EMPTY_INPUT: AiServerInput = {
  name: '',
  type: 'openai-compat',
  url: '',
  headers: {},
  models: { vision: '', llm: '', embedding: '' },
};

interface ServerDialogProps {
  open: boolean;
  initial?: AiServer | null;
  onClose: () => void;
  onSave: (input: AiServerInput, id?: number) => Promise<void>;
}

function ServerDialog({ open, initial, onClose, onSave }: ServerDialogProps) {
  const { t } = usePdfitI18n();
  const [form, setForm] = useState<AiServerInput>(EMPTY_INPUT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      return;
    }

    setForm(
      initial
        ? {
            name: initial.name,
            type: initial.type,
            url: initial.url,
            headers: { ...initial.headers },
            models: { ...initial.models },
          }
        : {
            ...EMPTY_INPUT,
            headers: {},
            models: { vision: '', llm: '', embedding: '' },
          },
    );
    setError('');
  }, [initial, open]);

  function setField<K extends keyof AiServerInput>(key: K, value: AiServerInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setModel(role: keyof NonNullable<AiServerInput['models']>, value: string) {
    setForm((current) => ({
      ...current,
      models: { ...current.models, [role]: value },
    }));
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError(t('serverNameRequired'));
      return;
    }
    if (!form.url.trim()) {
      setError(t('serverUrlRequired'));
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onSave(form, initial?.id);
      onClose();
    } catch (caught) {
      setError(String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{initial ? t('editAiServer') : t('addAiServer')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label={t('serverName')}
            value={form.name}
            onChange={(event) => setField('name', event.target.value)}
            fullWidth
            size="small"
          />
          <Select
            value={form.type}
            onChange={(event) => setField('type', event.target.value as AiServerType)}
            size="small"
            fullWidth
          >
            <MenuItem value="openai-compat">OpenAI compatible</MenuItem>
            <MenuItem value="lm-studio">LM Studio</MenuItem>
          </Select>
          <TextField
            label={t('serverUrl')}
            placeholder="http://localhost:1234/v1"
            value={form.url}
            onChange={(event) => setField('url', event.target.value)}
            fullWidth
            size="small"
          />

          <Divider />

          <HeadersEditor value={form.headers ?? {}} onChange={(headers) => setField('headers', headers)} />

          <Divider />

          <Typography variant="caption" color="text.secondary">
            {t('modelMapping')}
          </Typography>
          <TextField
            label={t('visionModel')}
            placeholder="llava:7b"
            value={form.models?.vision ?? ''}
            onChange={(event) => setModel('vision', event.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label={t('llmModel')}
            placeholder="mistral:7b"
            value={form.models?.llm ?? ''}
            onChange={(event) => setModel('llm', event.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label={t('embeddingModel')}
            placeholder="nomic-embed-text"
            value={form.models?.embedding ?? ''}
            onChange={(event) => setModel('embedding', event.target.value)}
            fullWidth
            size="small"
          />

          {error ? (
            <Typography color="error" variant="caption">
              {error}
            </Typography>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('cancel')}
        </Button>
        <Button onClick={() => void handleSave()} variant="contained" disabled={saving}>
          {saving ? t('saving') : t('save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function AIServersTab() {
  const { t } = usePdfitI18n();
  const [servers, setServers] = useState<AiServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AiServer | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      setServers(await listAiServers());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSave(input: AiServerInput, id?: number) {
    if (id !== undefined) {
      await updateAiServer(id, input);
    } else {
      await createAiServer(input);
    }
    await load();
  }

  async function handleDelete() {
    if (deleteId === null) return;
    const id = deleteId;
    setDeleteId(null);
    await deleteAiServer(id);
    await load();
  }

  const serverTypeLabel: Record<string, string> = {
    'openai-compat': 'OpenAI compatible',
    'lm-studio': 'LM Studio',
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t('aiServers')}
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          {t('addServer')}
        </Button>
      </Stack>

      {loading ? (
        <Typography color="text.secondary" variant="body2">
          {t('loading')}
        </Typography>
      ) : servers.length === 0 ? (
        <Typography color="text.secondary" variant="body2">
          {t('noAiServers')}
        </Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('name')}</TableCell>
                <TableCell>{t('type')}</TableCell>
                <TableCell>URL</TableCell>
                <TableCell>{t('models')}</TableCell>
                <TableCell align="right">{t('actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {servers.map((server) => (
                <TableRow key={server.id} hover>
                  <TableCell>{server.name}</TableCell>
                  <TableCell>
                    <Chip label={serverTypeLabel[server.type] ?? server.type} size="small" />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                      {server.url}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap">
                      {server.models.vision ? <Chip label={`Vision: ${server.models.vision}`} size="small" variant="outlined" /> : null}
                      {server.models.llm ? <Chip label={`LLM: ${server.models.llm}`} size="small" variant="outlined" /> : null}
                      {server.models.embedding ? (
                        <Chip label={`Embedding: ${server.models.embedding}`} size="small" variant="outlined" />
                      ) : null}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={t('edit')}>
                      <IconButton
                        size="small"
                        onClick={() => {
                          setEditing(server);
                          setDialogOpen(true);
                        }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('delete')}>
                      <IconButton size="small" color="error" onClick={() => setDeleteId(server.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <ServerDialog
        open={dialogOpen}
        initial={editing}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
      />
      <Dialog open={deleteId !== null} onClose={() => setDeleteId(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('deleteAiServer')}</DialogTitle>
        <DialogContent>
          <Typography>{t('deleteAiServerQuestion')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)}>{t('cancel')}</Button>
          <Button color="error" variant="contained" onClick={() => void handleDelete()}>{t('delete')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

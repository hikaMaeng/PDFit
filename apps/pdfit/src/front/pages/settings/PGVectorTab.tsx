import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import StorageIcon from '@mui/icons-material/Storage';
import { getPgVectorConfig, savePgVectorConfig, type PgVectorConfig } from '../../api/settings';

const VOLUME_PATH = 'apps/pdfit/docker/volumes/data/pgvector -> /app/data/pgvector';

export default function PGVectorTab() {
  const [config, setConfig] = useState<PgVectorConfig>({ user: '', password: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    getPgVectorConfig()
      .then((value) => setConfig({ user: value.user ?? '', password: value.password ?? '' }))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setStatus(null);
    try {
      await savePgVectorConfig(config);
      setStatus({ type: 'success', message: 'Saved PostgreSQL runtime settings.' });
    } catch (caught) {
      setStatus({ type: 'error', message: String(caught) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" mb={2}>
        <StorageIcon color="primary" />
        <Typography variant="subtitle1" fontWeight={600}>
          PGVector runtime
        </Typography>
      </Stack>

      <Typography variant="body2" color="text.secondary" mb={3}>
        These settings are stored in the embedded PostgreSQL runtime.
      </Typography>

      {loading ? (
        <Typography variant="body2" color="text.secondary">
          Loading...
        </Typography>
      ) : (
        <Stack spacing={2} maxWidth={480}>
          <TextField
            label="POSTGRES_USER"
            value={config.user ?? ''}
            onChange={(event) => setConfig((current) => ({ ...current, user: event.target.value }))}
            size="small"
            fullWidth
            placeholder="books"
          />
          <TextField
            label="POSTGRES_PASSWORD"
            type="password"
            value={config.password ?? ''}
            onChange={(event) => setConfig((current) => ({ ...current, password: event.target.value }))}
            size="small"
            fullWidth
            placeholder="books"
          />
          <TextField label="PGDATA volume" value={VOLUME_PATH} size="small" fullWidth InputProps={{ readOnly: true }} />

          {status ? (
            <Alert severity={status.type} onClose={() => setStatus(null)}>
              {status.message}
            </Alert>
          ) : null}

          <Button variant="contained" onClick={() => void handleSave()} disabled={saving} sx={{ alignSelf: 'flex-start' }}>
            {saving ? 'Saving...' : 'Save settings'}
          </Button>
        </Stack>
      )}
    </Box>
  );
}

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, MenuItem, Stack, TextField } from '@mui/material';
import { usePdfitI18n } from '@pdfit/pdfit/client/service';
import type { EmbeddingModel, ModelChoice } from '@pdfit/pdfit/common/protocol/embedding-search';
import type { AiServer } from '../../api/settings';
import { CandidateDraft, DefaultModelsModel } from './aiModelSettingsModel';
import { settingsKeys as keys } from './resource';

const choiceValue = (choice: ModelChoice | null) => choice ? `${choice.serverId}:${choice.modelId}` : '';

export function DefaultModelSelects({ servers }: { servers: AiServer[] }) {
  const { t } = usePdfitI18n();
  const [model] = useState(() => new DefaultModelsModel());
  useSyncExternalStore(model.subscribe, model.getVersion);
  useEffect(() => { void model.load(); }, [model]);
  return <Stack spacing={1.5} sx={{ mb: 2 }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
      {(['llm', 'embedding'] as const).map((role) => {
        const options = servers.flatMap((server) => (role === 'llm' ? server.llmCandidates : server.embeddingCandidates)
          .flatMap((candidate) => candidate.id ? [{ name: `${server.name} · ${candidate.name}`, serverId: server.id, modelId: candidate.id }] : []));
        const settings = model.defaults;
        const selected = choiceValue(settings?.[role] ?? null);
        const legacy = role === 'llm' && settings && !settings.llmExplicit;
        const value = legacy ? 'legacy' : options.some((option) => choiceValue(option) === selected) ? selected : '';
        return <TextField key={role} select fullWidth size="small" label={t(role === 'llm' ? keys.defaultLlm : keys.defaultEmbedding)}
          value={value} disabled={model.pending || !settings} onChange={(event) => {
            const option = options.find((item) => choiceValue(item) === event.target.value);
            void model.select(role, option ? { serverId: option.serverId, modelId: option.modelId } : null);
          }}>
          {legacy && <MenuItem value="legacy" disabled>{t(keys.legacyDefault)}{options[0] ? ` · ${options[0].name}` : ''}</MenuItem>}
          <MenuItem value="">{t(keys.noDefaultModel)}</MenuItem>
          {options.map((option) => <MenuItem key={choiceValue(option)} value={choiceValue(option)}>{option.name}</MenuItem>)}
        </TextField>;
      })}
    </Stack>
    {model.error && <Alert severity="error">{t(keys.modelError)}</Alert>}
  </Stack>;
}

const NUMBERS = [ ['dimensions', keys.dimensions], ['indexDimensions', keys.indexDimensions],
  ['embeddingConcurrency', keys.batchWidth], ['maxInputTokens', keys.maxInput] ] as const;
const TEXT = [ ['revision', keys.revision], ['documentPrefix', keys.documentPrefix], ['queryPrefix', keys.queryPrefix] ] as const;

export function ModelCandidatesEditor({ draft }: { draft: CandidateDraft }) {
  const { t } = usePdfitI18n();
  useSyncExternalStore(draft.subscribe, draft.getVersion);
  return <Stack spacing={1.5}>
    {draft.llm.map((model, index) => <Stack direction="row" spacing={1} key={index}>
      <TextField fullWidth size="small" label={t('llmModel')} value={model.name} onChange={(event) => draft.setLlm(index, event.target.value)} />
      <Button onClick={() => draft.removeLlm(index)}>{t('delete')}</Button>
    </Stack>)}
    <Button size="small" sx={{ alignSelf: 'flex-start' }} onClick={() => draft.addLlm()}>{t(keys.addLlm)}</Button>
    {draft.embedding.map((model, index) => <Stack key={index} spacing={1.5} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Stack direction="row" spacing={1}>
        <TextField fullWidth size="small" label={t('embeddingModel')} value={model.name}
          onChange={(event) => draft.setEmbedding(index, { name: event.target.value })} />
        <Button onClick={() => draft.removeEmbedding(index)}>{t('delete')}</Button>
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
        {NUMBERS.map(([field, key]) => <TextField key={field} fullWidth size="small" type="number" inputProps={{ min: 1, step: 1 }}
          label={t(key)} value={model[field] || ''} onChange={(event) => draft.setEmbedding(index, { [field]: Number(event.target.value) })} />)}
      </Box>
      <FormControlLabel label={t(keys.mr)} control={<Checkbox checked={model.matryoshka}
        onChange={(event) => draft.setEmbedding(index, { matryoshka: event.target.checked })} />} />
      {TEXT.map(([field, key]) => <TextField key={field} fullWidth size="small" label={t(key)} value={model[field]}
        onChange={(event) => draft.setEmbedding(index, { [field]: event.target.value } satisfies Partial<EmbeddingModel>)} />)}
    </Stack>)}
    {draft.embedding.length > 0 && <Alert severity="info">{t(keys.modelNotice)}</Alert>}
    <Button size="small" sx={{ alignSelf: 'flex-start' }} onClick={() => draft.addEmbedding()}>{t(keys.addEmbedding)}</Button>
  </Stack>;
}

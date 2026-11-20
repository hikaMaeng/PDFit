import { useId } from 'react';
import { Box, Button, FormControlLabel, Popover, Slider, Stack, Switch, Typography } from '@mui/material';
import { DEFAULT_COLOR_ADJUSTMENTS, sameColorAdjustments, type PdfGpuColorAdjustments, type PdfGpuColorAdjustmentState } from '@pdfgpu/core';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';

const presets = [
  { label: 'imageNight', colors: { ...DEFAULT_COLOR_ADJUSTMENTS, invert: true, brightness: -0.08, saturation: 0.75 } },
  { label: 'imageGrayscale', colors: { ...DEFAULT_COLOR_ADJUSTMENTS, saturation: 0 } },
  { label: 'imageHighContrast', colors: { ...DEFAULT_COLOR_ADJUSTMENTS, contrast: 1.4 } },
] as const;

const sliders = [
  { key: 'brightness', label: 'imageBrightness', min: -100, max: 100 },
  { key: 'contrast', label: 'imageContrast', min: 0, max: 200 },
  { key: 'saturation', label: 'imageSaturation', min: 0, max: 200 },
] as const;

type Props = {
  anchor: HTMLElement | null;
  colors: PdfGpuColorAdjustmentState;
  onChange: (adjustments: PdfGpuColorAdjustments) => void;
  onClose: () => void;
};

export function ImageAdjustmentPopover({ anchor, colors, onChange, onClose }: Props) {
  const { t, language } = usePdfitI18n();
  const titleId = useId();
  const percent = new Intl.NumberFormat(language, { style: 'percent' });
  const formatValue = (value: number) => percent.format(value / 100);
  const atDefaults = sameColorAdjustments(colors, DEFAULT_COLOR_ADJUSTMENTS);

  return <Popover
    open={anchor !== null}
    anchorEl={anchor}
    onClose={onClose}
    marginThreshold={12}
    anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
    PaperProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': titleId, sx: { width: 'min(320px, calc(100vw - 24px))', mt: 0.5, p: 2 } }}
  >
    <Stack spacing={1.25}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
        <Typography id={titleId} component="h2" variant="subtitle2">{t('imageAdjustments')}</Typography>
        <Button
          size="small"
          aria-disabled={atDefaults}
          onClick={() => { if (!atDefaults) onChange(DEFAULT_COLOR_ADJUSTMENTS); }}
          sx={{ textTransform: 'none', '&[aria-disabled="true"]': { color: 'text.disabled', cursor: 'default', '&:hover': { bgcolor: 'transparent' } } }}
        >
          {t('resetImageAdjustments')}
        </Button>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        {presets.map((preset) => {
          const selected = sameColorAdjustments(colors, preset.colors);
          return <Button key={preset.label} size="small" variant={selected ? 'contained' : 'outlined'} aria-pressed={selected} onClick={() => onChange(preset.colors)} sx={{ textTransform: 'none' }}>
            {t(preset.label)}
          </Button>;
        })}
      </Box>
      <FormControlLabel label={t('invertColors')} sx={{ justifyContent: 'space-between', m: 0 }} labelPlacement="start" control={
        <Switch size="small" checked={colors.invert} inputProps={{ role: 'switch' }} onChange={(_, invert) => onChange({ invert })} />
      } />
      {sliders.map(({ key, label, min, max }) => {
        const name = t(label);
        const value = Math.round(colors[key] * 100);
        return <Box key={key}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
            <Typography variant="body2">{name}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatValue(value)}</Typography>
          </Box>
          <Slider size="small" min={min} max={max} value={value} aria-label={name} getAriaValueText={formatValue} onChange={(_, next) => {
            if (typeof next === 'number') onChange({ [key]: next / 100 });
          }} />
        </Box>;
      })}
    </Stack>
  </Popover>;
}
